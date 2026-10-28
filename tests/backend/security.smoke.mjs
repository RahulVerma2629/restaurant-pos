// End-to-end check of the security module against a RUNNING server and seeded database.
//   1) docker compose up -d db   2) npx prisma migrate dev   3) npm run seed   4) npm run dev
//   5) in another terminal:  npm run smoke        (login limiter allows 20 logins/min: wait a minute to re-run)
const BASE = process.env.API || 'http://localhost:3000/api/v1';
let passed = 0, failed = 0;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method, body: body && JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
  });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
function check(name, ok, extra = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.log(`  FAIL ${name} ${extra}`); }
}
const login = async (username) =>
  (await call('POST', '/auth/login', { body: { username, password: 'Passw0rd!', terminalId: 'SMOKE' } })).data?.token;

const health = await call('GET', '/health');
check('server is up', health.status === 200, `(is the server running at ${BASE}?)`);
if (health.status !== 200) process.exit(1);

const cashier = await login('cashier'), manager = await login('manager');
const waiter = await login('waiter'), admin = await login('admin');
check('demo users can log in (did you run npm run seed?)', cashier && manager && waiter && admin);

console.log('Authentication');
const me = await call('GET', '/auth/me', { token: cashier });
check('/auth/me shows cashier discount limit 10', me.data?.permissions?.some((p) => p.code === 'discounts.apply' && p.limit === 10));
check('no token -> 401', (await call('GET', '/auth/me')).status === 401);
check('bad token -> 401', (await call('GET', '/auth/me', { token: 'nope' })).status === 401);

console.log('Authorization');
check('waiter refund -> 403', (await call('POST', '/refunds/check', { token: waiter, body: { amount: 10 } })).status === 403);
check('waiter list users -> 403', (await call('GET', '/users', { token: waiter })).status === 403);

console.log('Discount approval flow');
const over = await call('POST', '/discounts/check', { token: cashier, body: { percent: 20 } });
check('20% by cashier -> APPROVAL_REQUIRED', over.status === 403 && over.error?.code === 'APPROVAL_REQUIRED');
check('8% by cashier -> allowed', (await call('POST', '/discounts/check', { token: cashier, body: { percent: 8 } })).status === 200);
const req = await call('POST', '/approvals', { token: cashier, body: { action: 'DISCOUNT', value: 20, reason: 'Regular guest' } });
check('approval request created', req.status === 201);
check('cannot approve own request', (await call('POST', `/approvals/${req.data?.id}/decide`, { token: cashier, body: { approve: true } })).status === 403);
check('manager approves', (await call('POST', `/approvals/${req.data?.id}/decide`, { token: manager, body: { approve: true } })).status === 200);
const used = await call('POST', '/discounts/check', { token: cashier, body: { percent: 20, approvalId: req.data?.id } });
check('20% allowed with approval', used.status === 200 && used.data?.approvedBy);
check('approval cannot be reused', (await call('POST', '/discounts/check', { token: cashier, body: { percent: 20, approvalId: req.data?.id } })).status === 403);

console.log('Integration with Billing and Orders');
const refundOver = await call('POST', '/refunds/check', { token: cashier, body: { amountPaise: 60000, billId: 'b1' } });
check('refund of Rs 600 by cashier (limit Rs 500) needs approval', refundOver.status === 403 && refundOver.error?.code === 'APPROVAL_REQUIRED');
check('refund of Rs 400 (sent as paise) is allowed', (await call('POST', '/refunds/check', { token: cashier, body: { amountPaise: 40000, billId: 'b1' } })).status === 200);
const cancelReq = await call('POST', '/approvals', { token: cashier, body: { action: 'ORDER_CANCEL', entityId: 5, reason: 'Guest left after KOT' } });
check('cashier can request an ORDER_CANCEL approval', cancelReq.status === 201);
check('manager approves it', (await call('POST', `/approvals/${cancelReq.data?.id}/decide`, { token: manager, body: { approve: true } })).status === 200);
check('approval for another order is refused', (await call('POST', `/approvals/${cancelReq.data?.id}/consume`, { token: cashier, body: { action: 'ORDER_CANCEL', entityId: 6 } })).status === 403);
check('orders module can use the approval once', (await call('POST', `/approvals/${cancelReq.data?.id}/consume`, { token: cashier, body: { action: 'ORDER_CANCEL', entityId: 5 } })).status === 200);
check('approval cannot be used twice', (await call('POST', `/approvals/${cancelReq.data?.id}/consume`, { token: cashier, body: { action: 'ORDER_CANCEL', entityId: 5 } })).status === 403);
const ingest = await call('POST', '/audit-logs/ingest', { body: { action: 'ORDER_CREATED' } });
check('audit ingest without the integration key is refused', ingest.status === 401 || ingest.status === 503);

console.log('Lockout');
for (let i = 0; i < 5; i++) await call('POST', '/auth/pin-login', { body: { username: 'kitchen', pin: '9999' } });
check('locked after 5 failures (423)', (await call('POST', '/auth/pin-login', { body: { username: 'kitchen', pin: '1234' } })).status === 423);
const users = await call('GET', '/users', { token: manager });
const kitchenId = users.data?.find((u) => u.username === 'kitchen')?.id;
check('manager unlocks user', (await call('POST', `/users/${kitchenId}/unlock`, { token: manager, body: {} })).status === 200);
check('PIN login works again', (await call('POST', '/auth/pin-login', { body: { username: 'kitchen', pin: '1234' } })).status === 200);

console.log('User management safeguards');
const esc = await call('POST', '/users', { token: manager, body: { name: 'X', username: `sneaky${Date.now()}`, password: 'Passw0rd!', roles: ['admin'] } });
check('manager cannot create an admin', esc.status === 403 && esc.error?.code === 'PRIVILEGE_ESCALATION');
const tmpName = `tmp${Date.now()}`;
const tmp = await call('POST', '/users', { token: manager, body: { name: 'Temp', username: tmpName, password: 'Passw0rd!', roles: ['waiter'] } });
check('manager creates a waiter (must change credentials)', tmp.status === 201 && tmp.data?.mustChange === true);
const myId = me.data?.user?.id;
const mgrMe = await call('GET', '/auth/me', { token: manager });
check('manager cannot change own roles', (await call('PATCH', `/users/${mgrMe.data?.user?.id}`, { token: manager, body: { roles: ['owner'] } })).status === 403);

console.log('Deactivation');
const tmpToken = await login(tmpName);
check('new user can log in', !!tmpToken);
check('manager deactivates user', (await call('POST', `/users/${tmp.data?.id}/deactivate`, { token: manager, body: { reason: 'Left the company' } })).status === 200);
check('old session stops working (401)', (await call('GET', '/auth/me', { token: tmpToken })).status === 401);
const logs = await call('GET', '/audit-logs?action=USER_DEACTIVATED&limit=1', { token: admin });
check('audit log records reason', logs.data?.rows?.[0]?.reason === 'Left the company');

console.log('Dashboards and reports');
const dashC = await call('GET', '/dashboards/me', { token: cashier });
const codes = dashC.data?.widgets?.map((w) => w.code) ?? [];
check('cashier sees cash drawer, not users', codes.includes('cash.drawer') && !codes.includes('users.summary'));
const dashA = await call('GET', '/dashboards/me', { token: admin });
check('admin users widget has live data', dashA.data?.widgets?.find((w) => w.code === 'users.summary')?.status === 'live');
check('staff activity report works', (await call('GET', '/reports/staff.activity', { token: manager })).status === 200);
check('sales report not integrated yet -> 501', (await call('GET', '/reports/sales.daily', { token: manager })).status === 501);
check('waiter cannot open sales report -> 403', (await call('GET', '/reports/sales.daily', { token: waiter })).status === 403);

console.log('Editable permission matrix');
const roles = await call('GET', '/roles', { token: admin });
const waiterRole = roles.data?.find((r) => r.name === 'waiter');
const current = (await call('GET', `/roles/${waiterRole.id}/permissions`, { token: admin })).data;
check('waiter can discount before change', (await call('POST', '/discounts/check', { token: waiter, body: { percent: 1 } })).status === 200);
await call('PUT', `/roles/${waiterRole.id}/permissions`, { token: admin, body: { permissions: current.filter((p) => p.code !== 'discounts.apply'), reason: 'smoke test' } });
check('permission removal applies at once', (await call('POST', '/discounts/check', { token: waiter, body: { percent: 1 } })).status === 403);
await call('PUT', `/roles/${waiterRole.id}/permissions`, { token: admin, body: { permissions: current, reason: 'smoke test restore' } });
check('permission restored', (await call('POST', '/discounts/check', { token: waiter, body: { percent: 1 } })).status === 200);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
