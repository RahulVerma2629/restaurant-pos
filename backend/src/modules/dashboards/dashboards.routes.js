import { Router } from 'express';
import { prisma } from '../../config/prisma.js';
import { authenticate } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { hasPermission } from '../rbac/access.js';
import { searchAudit } from '../audit/audit.service.js';
import { staffActivity } from '../reports/reports.routes.js';
import { DASHBOARDS } from './dashboards.definitions.js';

const router = Router();

// Widgets whose data lives in this module. For the rest, the owning module adds a resolver here
// (or exposes its own endpoint and the frontend calls it): until then status = pending_integration.
const resolvers = {
  'users.summary': async () => (await prisma.user.groupBy({ by: ['status'], _count: { _all: true } }))
    .map((r) => ({ status: r.status, count: r._count._all })),
  'roles.summary': async () => (await prisma.role.findMany({ include: { _count: { select: { users: true } } }, orderBy: { id: 'asc' } }))
    .map((r) => ({ name: r.name, users: r._count.users })),
  'audit.recent': async (req) => (await searchAudit(req, req.perms.get('audit.view').scope, { limit: 10 })).rows,
  'staff.activity': async (req) => staffActivity(req, req.perms.get('audit.view').scope,
    { from: new Date(new Date().setHours(0, 0, 0, 0)).toISOString() }),
};

// GET /api/v1/dashboards/me : widgets for the logged-in user's role(s), filtered by permission
router.get('/dashboards/me', authenticate, asyncHandler(async (req, res) => {
  const seen = new Set();
  const widgets = [];
  for (const role of req.roles) {
    for (const w of DASHBOARDS[role] ?? []) {
      if (seen.has(w.code) || (w.permission && !hasPermission(req, w.permission))) continue;
      seen.add(w.code);
      const resolve = resolvers[w.code];
      widgets.push({ ...w, status: resolve ? 'live' : 'pending_integration', data: resolve ? await resolve(req) : null });
    }
  }
  res.json({ data: { roles: req.roles, widgets } });
}));

export default router;
