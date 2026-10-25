import { Router } from 'express';
import { HttpError } from '../../utils/errors.js';
import { runReadiness, uptimeSeconds } from './health.js';
import { createSyncService } from './sync.service.js';
import { idempotent } from './idempotency.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// authMiddleware: array of middleware that sets req.user (use `authenticate` from middleware/authenticate.js).
export function createReliabilityRouter({ authMiddleware = [], stores }) {
  const router = Router();
  const sync = createSyncService({ changeLog: stores.changeLog });

  // Public: used by load balancers, Docker and uptime monitors.
  router.get('/health/live', (req, res) => res.json({ data: { status: 'ok', uptimeSeconds: uptimeSeconds() } }));
  router.get(
    '/health/ready',
    wrap(async (req, res) => {
      const r = await runReadiness();
      res.status(r.ok ? 200 : 503).json({ data: { status: r.ok ? 'ready' : 'degraded', checks: r.checks } });
    }),
  );

  // Terminal pushes queued offline operations.
  router.post(
    '/sync/push',
    ...authMiddleware,
    idempotent(stores.idempotency, { required: true }),
    wrap(async (req, res) => {
      const deviceId = req.get('X-Device-Id') || req.body?.deviceId;
      if (!deviceId || typeof deviceId !== 'string') throw new HttpError(400, 'VALIDATION_ERROR', 'X-Device-Id header (or deviceId) is required');
      const out = await sync.push({ deviceId, user: req.user, operations: req.body?.operations });
      res.json({ data: out });
    }),
  );

  // Terminal pulls everything that changed after its cursor.
  router.get(
    '/sync/changes',
    ...authMiddleware,
    wrap(async (req, res) => {
      const out = await sync.pull({
        cursor: req.query.cursor,
        limit: req.query.limit,
        branchId: req.user?.branchId != null ? String(req.user.branchId) : null,
      });
      res.json({ data: out });
    }),
  );

  return router;
}
