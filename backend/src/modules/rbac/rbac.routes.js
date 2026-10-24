import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { authenticate, guard } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { HttpError, bad, notFound, forbidden } from '../../utils/errors.js';
import { audit } from '../audit/audit.service.js';
import { rolePermissions, checkLimit, OVERRIDE_ACTIONS } from './rbac.service.js';
import { PERMISSIONS as P } from '../../../../shared/constants/permissions.js';
import { AUDIT_EVENTS as EV } from '../../../../shared/constants/audit-events.js';

const router = Router();

const getRole = async (id) => {
  const role = await prisma.role.findUnique({ where: { id: Number(id) } });
  if (!role) throw notFound('Role');
  return role;
};

// ---------- Roles and the permission matrix ----------
router.get('/roles', authenticate, asyncHandler(async (req, res) =>
  res.json({ data: await prisma.role.findMany({ orderBy: { id: 'asc' } }) })));

router.get('/permissions', authenticate, asyncHandler(async (req, res) =>
  res.json({ data: await prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] }) })));

router.post('/roles', ...guard(P.ROLES_MANAGE), asyncHandler(async (req, res) => {
  const b = z.object({ name: z.string().regex(/^[a-z][a-z0-9_-]{1,30}$/), description: z.string().optional() }).parse(req.body);
  if (await prisma.role.findUnique({ where: { name: b.name } })) throw new HttpError(409, 'ROLE_EXISTS', 'Role already exists');
  const role = await prisma.role.create({ data: { name: b.name, description: b.description } });
  await audit(req, { action: EV.ROLE_CREATED, entityType: 'role', entityId: role.id, newValue: b });
  res.status(201).json({ data: role });
}));

router.get('/roles/:id/permissions', ...guard(P.ROLES_MANAGE), asyncHandler(async (req, res) =>
  res.json({ data: await rolePermissions((await getRole(req.params.id)).id) })));

// Replaces a role's whole permission set (this is the editable RBAC matrix).
router.put('/roles/:id/permissions', ...guard(P.ROLES_MANAGE), asyncHandler(async (req, res) => {
  const role = await getRole(req.params.id);
  const b = z.object({
    permissions: z.array(z.object({
      code: z.string(), scope: z.enum(['own', 'branch', 'all']), limit: z.number().min(0).nullable().optional(),
    })),
    reason: z.string().optional(),
  }).parse(req.body);

  const known = await prisma.permission.findMany({ where: { code: { in: b.permissions.map((p) => p.code) } } });
  const missing = b.permissions.filter((p) => !known.some((k) => k.code === p.code));
  if (missing.length) throw bad(`Unknown permission: ${missing.map((m) => m.code).join(', ')}`);
  if (role.name === 'admin' && !b.permissions.some((p) => p.code === P.ROLES_MANAGE))
    throw new HttpError(409, 'LOCKOUT_GUARD', 'The admin role must keep roles.manage');

  const old = await rolePermissions(role.id);
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
    prisma.rolePermission.createMany({ data: b.permissions.map((p) => ({
      roleId: role.id, permissionId: known.find((k) => k.code === p.code).id, scope: p.scope, limitValue: p.limit ?? null })) }),
  ]);
  const next = await rolePermissions(role.id);
  await audit(req, { action: EV.PERMISSION_CHANGED, entityType: 'role', entityId: role.id, oldValue: old, newValue: next, reason: b.reason });
  res.json({ data: next });
}));

// ---------- Approvals (manager override) ----------
router.post('/approvals', authenticate, asyncHandler(async (req, res) => {
  const b = z.object({
    action: z.enum(['DISCOUNT', 'REFUND']), value: z.number().positive(),
    entityId: z.union([z.string(), z.number()]).optional(), reason: z.string().min(1),
  }).parse(req.body);
  if (!req.perms.has(OVERRIDE_ACTIONS[b.action])) throw forbidden(`Missing permission: ${OVERRIDE_ACTIONS[b.action]}`);
  const a = await prisma.approval.create({ data: { action: b.action, requestedBy: req.user.id,
    payload: { value: b.value, entityId: b.entityId ?? null }, reason: b.reason } });
  await audit(req, { action: EV.APPROVAL_REQUESTED, entityType: 'approval', entityId: a.id,
    newValue: { action: b.action, value: b.value, entityId: b.entityId }, reason: b.reason });
  res.status(201).json({ data: { id: a.id, status: a.status } });
}));

router.get('/approvals', ...guard(P.APPROVALS_DECIDE), asyncHandler(async (req, res) => {
  const where = { status: req.query.status || 'pending' };
  if (req.access.scope !== 'all') where.requester = { branchId: req.user.branchId };
  res.json({ data: await prisma.approval.findMany({ where, orderBy: { id: 'asc' },
    include: { requester: { select: { id: true, name: true } } } }) });
}));

router.post('/approvals/:id/decide', ...guard(P.APPROVALS_DECIDE), asyncHandler(async (req, res) => {
  const b = z.object({ approve: z.boolean(), reason: z.string().optional() }).parse(req.body);
  const a = await prisma.approval.findUnique({ where: { id: Number(req.params.id) }, include: { requester: true } });
  if (!a) throw notFound('Approval');
  if (a.status !== 'pending') throw new HttpError(409, 'ALREADY_DECIDED', `Approval is already ${a.status}`);
  if (a.requestedBy === req.user.id) throw forbidden('You cannot approve your own request', 'SELF_APPROVAL');
  if (req.access.scope !== 'all' && a.requester.branchId !== req.user.branchId) throw forbidden('Request belongs to another branch');
  if (b.approve) { // the approver's own limit must cover the amount
    const own = req.perms.get(OVERRIDE_ACTIONS[a.action]);
    if (!own || (own.limit !== null && a.payload.value > own.limit))
      throw forbidden('Value exceeds your own approval limit; escalate to a higher role', 'ABOVE_APPROVER_LIMIT');
  }
  // only a still-pending request can be decided (protects against two approvers at once)
  const done = await prisma.approval.updateMany({ where: { id: a.id, status: 'pending' },
    data: { status: b.approve ? 'approved' : 'rejected', decidedBy: req.user.id, decidedAt: new Date() } });
  if (done.count !== 1) throw new HttpError(409, 'ALREADY_DECIDED', 'Approval was just decided by someone else');
  await audit(req, { action: b.approve ? EV.APPROVAL_GRANTED : EV.APPROVAL_REJECTED, entityType: 'approval', entityId: a.id,
    newValue: { requestedBy: a.requestedBy, action: a.action, value: a.payload.value }, reason: b.reason });
  res.json({ data: { id: a.id, status: b.approve ? 'approved' : 'rejected' } });
}));

// ---------- Limit checks (Billing calls these before applying a discount or refund) ----------
router.post('/discounts/check', authenticate, asyncHandler(async (req, res) => {
  res.json({ data: await checkLimit(req, { permission: P.DISCOUNTS_APPLY, action: 'DISCOUNT',
    value: req.body?.percent, entityType: 'order', entityId: req.body?.orderId }) });
}));

router.post('/refunds/check', authenticate, asyncHandler(async (req, res) => {
  res.json({ data: await checkLimit(req, { permission: P.REFUNDS_PROCESS, action: 'REFUND',
    value: req.body?.amount, entityType: 'bill', entityId: req.body?.billId }) });
}));

export default router;
