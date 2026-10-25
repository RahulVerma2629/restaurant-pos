// Run:  cd backend && npm run test:reliability      (no database needed)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const express = require('express');

const { createReliabilityRouter } = await import('../../backend/src/modules/reliability/reliability.routes.js');
const { createMemoryIdempotencyStore, createMemoryChangeLog } = await import('../../backend/src/modules/reliability/store.memory.js');
const { idempotent } = await import('../../backend/src/modules/reliability/idempotency.js');
const { registerSyncHandler, clearSyncHandlers } = await import('../../backend/src/modules/reliability/sync.service.js');
const { registerReadinessCheck, clearReadinessChecks } = await import('../../backend/src/modules/reliability/health.js');
const { expectedVersion, assertVersion } = await import('../../backend/src/modules/reliability/optimisticLock.js');
const { errorHandler, notFoundHandler } = await import('../../backend/src/middleware/errorHandler.js');
const { HttpError } = await import('../../backend/src/utils/errors.js');

let chargeCount = 0;
async function startServer() {
  const stores = { idempotency: createMemoryIdempotencyStore(), changeLog: createMemoryChangeLog() };
  const fakeAuth = (req, res, next) => {
    req.user = { id: 1, branchId: 1 };
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createReliabilityRouter({ authMiddleware: [fakeAuth], stores }));
  app.post('/api/v1/pay', fakeAuth, idempotent(stores.idempotency), async (req, res) => {
    chargeCount += 1;
    await new Promise((r) => setTimeout(r, 50));
    res.status(201).json({ data: { charged: req.body.amount, n: chargeCount } });
  });
  app.post('/api/v1/boom', fakeAuth, idempotent(stores.idempotency), (req, res, next) => next(new Error('db down')));
  app.use(notFoundHandler);
  app.use(errorHandler);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { server, base: `http://127.0.0.1:${server.address().port}/api/v1` };
}

const post = (url, body, headers = {}) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('reliability module', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());
  const origError = console.error;
  console.error = () => {}; // keep test output clean for the expected 500 test

  await t.test('health: live is ok, ready reflects checks', async () => {
    assert.equal((await fetch(`${base}/health/live`)).status, 200);
    clearReadinessChecks();
    registerReadinessCheck('db', async () => {});
    assert.equal((await fetch(`${base}/health/ready`)).status, 200);
    registerReadinessCheck('broken', async () => { throw new Error('nope'); });
    const r = await fetch(`${base}/health/ready`);
    assert.equal(r.status, 503);
    assert.equal((await r.json()).data.checks.broken.ok, false);
    clearReadinessChecks();
  });

  await t.test('idempotency: missing key -> 400', async () => {
    const r = await post(`${base}/pay`, { amount: 100 });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  });

  await t.test('idempotency: retry returns same response, handler runs once', async () => {
    chargeCount = 0;
    const key = randomUUID();
    const a = await post(`${base}/pay`, { amount: 100 }, { 'Idempotency-Key': key });
    const b = await post(`${base}/pay`, { amount: 100 }, { 'Idempotency-Key': key });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal(b.headers.get('Idempotent-Replayed'), 'true');
    assert.deepEqual(await a.json(), await b.json());
    assert.equal(chargeCount, 1);
  });

  await t.test('idempotency: same key, different body -> 422', async () => {
    const key = randomUUID();
    await post(`${base}/pay`, { amount: 100 }, { 'Idempotency-Key': key });
    const r = await post(`${base}/pay`, { amount: 999 }, { 'Idempotency-Key': key });
    assert.equal(r.status, 422);
    assert.equal((await r.json()).error.code, 'IDEMPOTENCY_KEY_REUSED');
  });

  await t.test('idempotency: two simultaneous requests -> one runs, one gets 409', async () => {
    chargeCount = 0;
    const key = randomUUID();
    const [a, b] = await Promise.all([
      post(`${base}/pay`, { amount: 5 }, { 'Idempotency-Key': key }),
      post(`${base}/pay`, { amount: 5 }, { 'Idempotency-Key': key }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    assert.equal(chargeCount, 1);
  });

  await t.test('idempotency: 500 frees the key so a retry can run', async () => {
    const key = randomUUID();
    const a = await post(`${base}/boom`, {}, { 'Idempotency-Key': key });
    assert.equal(a.status, 500);
    await new Promise((r) => setTimeout(r, 20));
    const b = await post(`${base}/boom`, {}, { 'Idempotency-Key': key });
    assert.equal(b.status, 500); // ran again (not 409 / not replay)
    assert.equal(b.headers.get('Idempotent-Replayed'), null);
  });

  await t.test('idempotency: bad key format -> 400', async () => {
    const r = await post(`${base}/pay`, { amount: 1 }, { 'Idempotency-Key': 'short' });
    assert.equal(r.status, 400);
  });

  await t.test('sync: push applies, duplicate is not re-applied, pull returns changes', async () => {
    clearSyncHandlers();
    let applied = 0;
    registerSyncHandler('order.create', async (op) => {
      applied += 1;
      return { entityId: op.payload.id, data: { id: op.payload.id } };
    });
    registerSyncHandler('order.cancel', async () => {
      throw new HttpError(409, 'VERSION_CONFLICT', 'Order changed', { current: 3 });
    });
    const headers = { 'X-Device-Id': 'tablet-1' };
    const op1 = { opId: randomUUID(), type: 'order.create', payload: { id: 'o-1' } };
    const op2 = { opId: randomUUID(), type: 'order.cancel', payload: { id: 'o-1' } };
    const op3 = { opId: randomUUID(), type: 'nope.nothing', payload: {} };

    const r1 = await post(`${base}/sync/push`, { operations: [op1, op2, op3] }, { ...headers, 'Idempotency-Key': randomUUID() });
    assert.equal(r1.status, 200);
    const res = (await r1.json()).data.results;
    assert.deepEqual(res.map((x) => x.status), ['applied', 'conflict', 'rejected']);

    // Same operations pushed again under a NEW request key (e.g. app restarted): ops are still de-duplicated by opId.
    const r2 = await post(`${base}/sync/push`, { operations: [op1] }, { ...headers, 'Idempotency-Key': randomUUID() });
    assert.equal((await r2.json()).data.results[0].status, 'duplicate');
    assert.equal(applied, 1);

    const pull = await (await fetch(`${base}/sync/changes?cursor=0`)).json();
    assert.equal(pull.data.events.length, 1);
    assert.equal(pull.data.events[0].entityId, 'o-1');
    const none = await (await fetch(`${base}/sync/changes?cursor=${pull.data.nextCursor}`)).json();
    assert.equal(none.data.events.length, 0);
  });

  await t.test('sync: validation errors', async () => {
    const h = { 'X-Device-Id': 'tablet-1' };
    const empty = await post(`${base}/sync/push`, { operations: [] }, { ...h, 'Idempotency-Key': randomUUID() });
    assert.equal(empty.status, 400);
    const noDevice = await post(`${base}/sync/push`, { operations: [{}] }, { 'Idempotency-Key': randomUUID() });
    assert.equal(noDevice.status, 400);
    const badOp = await post(`${base}/sync/push`, { operations: [{ opId: 'x' }] }, { ...h, 'Idempotency-Key': randomUUID() });
    assert.equal(badOp.status, 400);
    const badCursor = await fetch(`${base}/sync/changes?cursor=abc`);
    assert.equal(badCursor.status, 400);
  });

  await t.test('sync: unexpected handler failure returns retry and is not remembered', async () => {
    clearSyncHandlers();
    let fail = true;
    registerSyncHandler('kot.send', async () => {
      if (fail) throw new Error('db blip');
      return { entityId: 'k1' };
    });
    const op = { opId: randomUUID(), type: 'kot.send', payload: {} };
    const h = { 'X-Device-Id': 'tablet-1' };
    const a = await (await post(`${base}/sync/push`, { operations: [op] }, { ...h, 'Idempotency-Key': randomUUID() })).json();
    assert.equal(a.data.results[0].status, 'retry');
    fail = false;
    const b = await (await post(`${base}/sync/push`, { operations: [op] }, { ...h, 'Idempotency-Key': randomUUID() })).json();
    assert.equal(b.data.results[0].status, 'applied');
  });

  await t.test('index: idempotentRoute works through the shared stores', async () => {
    const mod = await import('../../backend/src/modules/reliability/index.js');
    assert.throws(() => mod.getStores(), /not initialised/);
    const built = await mod.buildReliability({ authMiddleware: [] });
    assert.equal(await mod.buildReliability(), built); // same instance
    const app2 = express();
    app2.use(express.json());
    let runs = 0;
    app2.post('/x', mod.idempotentRoute(), (req, res) => { runs += 1; res.json({ data: { runs } }); });
    app2.use(errorHandler);
    const s2 = await new Promise((resolve) => { const s = app2.listen(0, () => resolve(s)); });
    const url = `http://127.0.0.1:${s2.address().port}/x`;
    const key = randomUUID();
    await post(url, { a: 1 }, { 'Idempotency-Key': key });
    const again = await post(url, { a: 1 }, { 'Idempotency-Key': key });
    assert.equal(again.headers.get('Idempotent-Replayed'), 'true');
    assert.equal(runs, 1);
    s2.close();
  });

  await t.test('optimistic lock helpers', () => {
    assert.equal(expectedVersion({ get: () => '"3"', body: {} }), 3);
    assert.throws(() => expectedVersion({ get: () => undefined, body: {} }), (e) => e.status === 428);
    assert.throws(() => expectedVersion({ get: () => 'abc', body: {} }), (e) => e.status === 400);
    assert.doesNotThrow(() => assertVersion(2, 2));
    assert.throws(() => assertVersion(1, 2), (e) => e.status === 409 && e.code === 'VERSION_CONFLICT');
  });

  console.error = origError;
});
