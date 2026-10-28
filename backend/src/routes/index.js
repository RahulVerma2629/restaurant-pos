import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import usersRoutes from '../modules/users/users.routes.js';
import rbacRoutes from '../modules/rbac/rbac.routes.js';
import auditRoutes from '../modules/audit/audit.routes.js';
import reportsRoutes from '../modules/reports/reports.routes.js';
import dashboardsRoutes from '../modules/dashboards/dashboards.routes.js';
import { authenticate, guard } from '../middleware/authenticate.js';
import { audit } from '../modules/audit/audit.service.js';
import { checkLimit } from '../modules/rbac/rbac.service.js';
import { buildReliability, idempotentRoute } from '../modules/reliability/index.js';
import { env } from '../config/env.js';
// Billing is TypeScript: run the server with `tsx` (npm run dev / npm start already do).
import { BillingService } from '../modules/billing/billing.service.js';
import { CashShiftService } from '../modules/billing/cash-shift.service.js';
import { createBillingRouter } from '../modules/billing/billing.routes.js';
import { createCashShiftRouter } from '../modules/billing/cash-shift.routes.js';
import { createOrdersClient, disabledOrdersClient } from '../modules/billing/orders-client.js';

// All routes live under /api/v1. Other interns: add your module's router here.
// Reliability (health, offline sync, idempotency). Store comes from RELIABILITY_STORE=memory|pg.
const { router: reliabilityRouter } = await buildReliability({ authMiddleware: [authenticate] });

const router = Router();
router.get('/health', (req, res) => res.json({ data: { status: 'ok' } }));
router.use(reliabilityRouter);
for (const r of [authRoutes, usersRoutes, rbacRoutes, auditRoutes, reportsRoutes, dashboardsRoutes]) router.use(r);

// ---- Billing and cash shifts (login + permission + limits + idempotency + audit come from the other modules) ----
const billing = new BillingService();
const shifts = new CashShiftService();
const orders = env.ordersApiUrl ? createOrdersClient(env.ordersApiUrl) : disabledOrdersClient;
const common = { guard, idempotent: () => idempotentRoute(), audit };

router.use('/billing', createBillingRouter({
  ...common, billing, shifts, orders, defaultTaxBasisPoints: env.defaultTaxBasisPoints,
  // discount limit in percent; refund limit is stored in rupees while billing works in paise
  checkDiscount: (req, percent, orderId) => checkLimit(req, {
    permission: 'discounts.apply', action: 'DISCOUNT', value: percent, entityType: 'order', entityId: orderId }),
  checkRefund: (req, amountPaise, billId) => checkLimit(req, {
    permission: 'refunds.process', action: 'REFUND', value: amountPaise / 100, entityType: 'bill', entityId: billId }),
}));
router.use('/cash-shifts', createCashShiftRouter({ ...common, shifts }));

export default router;
