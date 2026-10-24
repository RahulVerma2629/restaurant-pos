import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import usersRoutes from '../modules/users/users.routes.js';
import rbacRoutes from '../modules/rbac/rbac.routes.js';
import auditRoutes from '../modules/audit/audit.routes.js';
import reportsRoutes from '../modules/reports/reports.routes.js';
import dashboardsRoutes from '../modules/dashboards/dashboards.routes.js';

// All routes live under /api/v1. Other interns: add your module's router here.
const router = Router();
router.get('/health', (req, res) => res.json({ data: { status: 'ok' } }));
for (const r of [authRoutes, usersRoutes, rbacRoutes, auditRoutes, reportsRoutes, dashboardsRoutes]) router.use(r);

export default router;
