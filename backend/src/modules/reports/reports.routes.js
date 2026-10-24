import { Router } from 'express';
import { prisma } from '../../config/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { HttpError, notFound } from '../../utils/errors.js';
import { scopeWhere, hasPermission } from '../rbac/access.js';

const router = Router();

const R = (code, group, permission, source, title) => ({ code, group, permission, source, title });
export const REPORTS = [
  ...['daily', 'weekly', 'monthly', 'hourly', 'item-wise', 'category-wise', 'branch-wise'].map((k) => R(`sales.${k}`, 'sales', 'sales.view', 'billing', `Sales (${k})`)),
  ...['by-method', 'failed', 'refunds', 'discrepancies'].map((k) => R(`payments.${k}`, 'payments', 'sales.view', 'billing', `Payments (${k})`)),
  ...['summary', 'cancelled', 'average-value', 'by-type', 'peak-time'].map((k) => R(`orders.${k}`, 'orders', 'reports.view', 'orders', `Orders (${k})`)),
  ...['stock', 'low-stock', 'consumption', 'wastage', 'adjustments'].map((k) => R(`inventory.${k}`, 'inventory', 'reports.view', 'inventory', `Inventory (${k})`)),
  R('staff.activity', 'staff', 'reports.view', 'security', 'Staff activity (from audit log)'),
  R('security.login-activity', 'security', 'audit.view', 'security', 'Login activity'),
];

// To make a report real: add its code here and a function in `builders`. Other modules' reports
// (sales, orders, inventory...) need their tables first; they return 501 until then.
const builders = {
  'staff.activity': (req, scope, range) => staffActivity(req, scope, range),
  'security.login-activity': (req, scope, range) => loginActivity(req, scope, range),
};

const dateRange = (q) => {
  const r = {};
  if (q.from) r.gte = new Date(q.from);
  if (q.to) r.lte = new Date(q.to);
  return Object.keys(r).length ? { createdAt: r } : {};
};

export async function staffActivity(req, scope, query = {}) {
  const rows = await prisma.auditLog.groupBy({
    by: ['userId', 'action'],
    where: { AND: [scopeWhere(req, scope), { userId: { not: null } }, dateRange(query)] },
    _count: { _all: true },
    orderBy: [{ userId: 'asc' }, { action: 'asc' }],
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } });
  return rows.map((r) => ({ userId: r.userId, name: users.find((u) => u.id === r.userId)?.name ?? null, action: r.action, count: r._count._all }));
}

async function loginActivity(req, scope, query = {}) {
  const where = { AND: [dateRange(query)] };
  if (scope === 'branch') {
    const ids = (await prisma.user.findMany({ where: { branchId: req.user.branchId }, select: { id: true } })).map((u) => u.id);
    where.AND.push({ userId: { in: ids } });
  } else if (scope === 'own') where.AND.push({ userId: req.user.id });
  const rows = await prisma.loginActivity.findMany({ where });
  const by = new Map();
  for (const r of rows) {
    const k = r.username ?? '(unknown)';
    const e = by.get(k) ?? { username: k, successes: 0, failures: 0, lastAttempt: null };
    r.success ? e.successes++ : e.failures++;
    if (!e.lastAttempt || r.createdAt > e.lastAttempt) e.lastAttempt = r.createdAt;
    by.set(k, e);
  }
  return [...by.values()].sort((a, b) => b.failures - a.failures);
}

router.get('/reports', authenticate, (req, res) => {
  res.json({ data: REPORTS.filter((r) => hasPermission(req, r.permission)).map((r) => ({ ...r, implemented: r.code in builders })) });
});

router.get('/reports/:code', authenticate, asyncHandler(async (req, res) => {
  const def = REPORTS.find((r) => r.code === req.params.code);
  if (!def) throw notFound('Report');
  const grant = req.perms.get(def.permission);
  if (!grant) throw new HttpError(403, 'FORBIDDEN', `Missing permission: ${def.permission}`);
  const build = builders[def.code];
  if (!build) throw new HttpError(501, 'NOT_IMPLEMENTED', `Needs data from the ${def.source} module`);
  res.json({ data: { report: def.code, from: req.query.from ?? null, to: req.query.to ?? null,
    rows: await build(req, grant.scope, req.query) } });
}));

export default router;
