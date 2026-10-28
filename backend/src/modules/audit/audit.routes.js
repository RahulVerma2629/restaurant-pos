import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { guard } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { HttpError } from '../../utils/errors.js';
import { env } from '../../config/env.js';
import { PERMISSIONS } from '../../../../shared/constants/permissions.js';
import { AUDIT_EVENTS } from '../../../../shared/constants/audit-events.js';
import { audit, searchAudit } from './audit.service.js';

const router = Router();

// GET /api/v1/audit-logs?userId=&action=&entityType=&entityId=&from=&to=&limit=&offset=
router.get('/audit-logs', ...guard(PERMISSIONS.AUDIT_VIEW), asyncHandler(async (req, res) => {
  res.json({ data: await searchAudit(req, req.access.scope, req.query) });
}));

const sameKey = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

const ingestBody = z.object({
  action: z.enum(Object.values(AUDIT_EVENTS)),
  userId: z.number().int().positive().optional(),
  role: z.string().max(100).optional(),
  branchId: z.number().int().positive().optional(),
  terminalId: z.string().max(100).optional(),
  entityType: z.string().max(50).optional(),
  entityId: z.union([z.string(), z.number()]).optional(),
  oldValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
  reason: z.string().max(500).optional(),
  approvedBy: z.number().int().positive().optional(),
  source: z.string().max(50).optional(),
});

// Service-to-service: modules written in another language (Orders / Python) send their audit events here.
// Header:  X-Integration-Key: <INTEGRATION_API_KEY>
router.post('/audit-logs/ingest', asyncHandler(async (req, res) => {
  if (!env.integrationKey) throw new HttpError(503, 'INTEGRATION_DISABLED', 'INTEGRATION_API_KEY is not set on the server');
  if (!sameKey(req.get('X-Integration-Key'), env.integrationKey))
    throw new HttpError(401, 'INVALID_INTEGRATION_KEY', 'Invalid or missing X-Integration-Key');
  const b = ingestBody.parse(req.body);
  // No logged-in user here: the event names the user itself. The row is stored exactly like in-process events.
  const pseudoReq = { user: null, roles: [], terminalId: b.terminalId ?? null, ip: req.ip };
  await audit(pseudoReq, { ...b, newValue: b.source ? { ...(b.newValue && typeof b.newValue === 'object' ? b.newValue : { value: b.newValue }), source: b.source } : b.newValue });
  res.status(201).json({ data: { stored: true } });
}));

export default router;
