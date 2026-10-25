import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import usersRoutes from '../modules/users/users.routes.js';
import rbacRoutes from '../modules/rbac/rbac.routes.js';
import auditRoutes from '../modules/audit/audit.routes.js';
import reportsRoutes from '../modules/reports/reports.routes.js';
import dashboardsRoutes from '../modules/dashboards/dashboards.routes.js';
import { authenticate } from '../middleware/authenticate.js';
import { buildReliability } from '../modules/reliability/index.js';

// All routes live under /api/v1. Other interns: add your module's router here.
// Reliability (health, offline sync, idempotency). Store comes from RELIABILITY_STORE=memory|pg.
const { router: reliabilityRouter } = await buildReliability({ authMiddleware: [authenticate] });

const router = Router();
router.get('/health', (req, res) => res.json({ data: { status: 'ok' } }));
router.use(reliabilityRouter);
for (const r of [authRoutes, usersRoutes, rbacRoutes, auditRoutes, reportsRoutes, dashboardsRoutes]) router.use(r);

export default router;
