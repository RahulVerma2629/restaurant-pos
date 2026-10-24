import { Router } from 'express';
import { guard } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { PERMISSIONS as P } from '../../../../shared/constants/permissions.js';
import * as svc from './users.service.js';

const router = Router();
const manage = guard(P.USERS_MANAGE);

router.get('/users', ...manage, asyncHandler(async (req, res) => res.json({ data: await svc.listUsers(req) })));
router.post('/users', ...manage, asyncHandler(async (req, res) => res.status(201).json({ data: await svc.createUser(req) })));
router.get('/users/:id', ...manage, asyncHandler(async (req, res) => res.json({ data: await svc.getUser(req) })));
router.patch('/users/:id', ...manage, asyncHandler(async (req, res) => res.json({ data: await svc.updateUser(req) })));
router.post('/users/:id/deactivate', ...manage, asyncHandler(async (req, res) => res.json({ data: await svc.deactivateUser(req) })));
router.post('/users/:id/activate', ...manage, asyncHandler(async (req, res) => res.json({ data: await svc.activateUser(req) })));
router.post('/users/:id/unlock', ...manage, asyncHandler(async (req, res) => res.json({ data: await svc.unlockUser(req) })));
router.post('/users/:id/reset-credentials', ...manage, asyncHandler(async (req, res) => {
  await svc.resetCredentials(req);
  res.json({ data: { reset: true } });
}));

export default router;
