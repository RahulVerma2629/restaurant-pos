import { Router } from 'express';
import { guard } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { PERMISSIONS } from '../../../../shared/constants/permissions.js';
import { searchAudit } from './audit.service.js';

const router = Router();

// GET /api/v1/audit-logs?userId=&action=&entityType=&entityId=&from=&to=&limit=&offset=
router.get('/audit-logs', ...guard(PERMISSIONS.AUDIT_VIEW), asyncHandler(async (req, res) => {
  res.json({ data: await searchAudit(req, req.access.scope, req.query) });
}));

export default router;
