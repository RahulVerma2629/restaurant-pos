import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { HttpError, bad, notFound, forbidden } from '../../utils/errors.js';
import { hashSecret, passwordProblem, pinProblem } from '../../utils/crypto.js';
import { audit } from '../audit/audit.service.js';
import { scopeWhere } from '../rbac/access.js';
import { ROLES, PRIVILEGED_ROLES } from '../../../../shared/constants/roles.js';
import { AUDIT_EVENTS as EV } from '../../../../shared/constants/audit-events.js';

const SELECT = {
  id: true, name: true, username: true, phone: true, email: true, branchId: true, status: true,
  mustChange: true, createdAt: true, lastLoginAt: true,
  roles: { select: { role: { select: { name: true } } } },
};
const shape = (u) => ({ ...u, roles: u.roles.map((r) => r.role.name).sort() });

async function getScoped(req, id) {
  const u = await prisma.user.findUnique({ where: { id: Number(id) }, select: SELECT });
  if (!u) throw notFound('User');
  if (req.access.scope !== 'all' && u.branchId !== req.user.branchId) throw forbidden('User belongs to another branch');
  return shape(u);
}

async function resolveRoles(req, names) {
  if (!Array.isArray(names) || !names.length) throw bad('roles must be a non-empty array');
  const rows = await prisma.role.findMany({ where: { name: { in: names } } });
  const unknown = names.filter((n) => !rows.some((r) => r.name === n));
  if (unknown.length) throw bad(`Unknown roles: ${unknown.join(', ')}`);
  // Privilege-escalation guard: only owner/admin may hand out owner/admin.
  if (names.some((n) => PRIVILEGED_ROLES.includes(n)) && !req.roles.some((n) => PRIVILEGED_ROLES.includes(n)))
    throw forbidden('Only an owner or admin can assign the owner/admin role', 'PRIVILEGE_ESCALATION');
  return rows;
}

const otherActiveAdmins = (excludeId) => prisma.user.count({
  where: { status: 'active', id: { not: excludeId }, roles: { some: { role: { name: ROLES.ADMIN } } } },
});
const isAdmin = async (id) => (await prisma.userRole.count({ where: { userId: id, role: { name: ROLES.ADMIN } } })) > 0;

export async function listUsers(req) {
  const where = scopeWhere(req, req.access.scope, { branchField: 'branchId', userField: 'id' });
  const rows = await prisma.user.findMany({ where, select: SELECT, orderBy: { id: 'asc' } });
  return rows.map(shape);
}

export const getUser = (req) => getScoped(req, req.params.id);

const createBody = z.object({
  name: z.string().min(1), username: z.string().min(3), password: z.string(),
  pin: z.string().optional(), phone: z.string().optional(), email: z.string().email().optional(),
  roles: z.array(z.string()), branchId: z.number().int().optional(),
});

export async function createUser(req) {
  const b = createBody.parse(req.body);
  const pw = passwordProblem(b.password); if (pw) throw bad(pw);
  if (b.pin !== undefined) { const p = pinProblem(b.pin); if (p) throw bad(p); }
  const roleRows = await resolveRoles(req, b.roles);
  const branchId = req.access.scope === 'all' ? (b.branchId ?? req.user.branchId) : req.user.branchId;
  if (!(await prisma.branch.findFirst({ where: { id: branchId, active: true } }))) throw bad('Unknown branch');
  if (await prisma.user.findUnique({ where: { username: b.username } }))
    throw new HttpError(409, 'USERNAME_TAKEN', 'Username already exists');

  const created = await prisma.user.create({
    data: {
      name: b.name, username: b.username, phone: b.phone, email: b.email, branchId, mustChange: true,
      passwordHash: await hashSecret(b.password), pinHash: b.pin ? await hashSecret(b.pin) : null,
      roles: { create: roleRows.map((r) => ({ roleId: r.id })) },
    },
    select: SELECT,
  });
  await audit(req, { action: EV.USER_CREATED, entityType: 'user', entityId: created.id,
    newValue: { name: b.name, username: b.username, roles: b.roles, branchId } });
  return shape(created);
}

const patchBody = z.object({
  name: z.string().min(1).optional(), phone: z.string().optional(), email: z.string().email().optional(),
  roles: z.array(z.string()).optional(), reason: z.string().optional(),
});

export async function updateUser(req) {
  const before = await getScoped(req, req.params.id);
  const b = patchBody.parse(req.body);
  let roleRows;
  if (b.roles !== undefined) {
    if (before.id === req.user.id) throw forbidden('You cannot change your own roles', 'PRIVILEGE_ESCALATION');
    roleRows = await resolveRoles(req, b.roles);
    if ((await isAdmin(before.id)) && !b.roles.includes(ROLES.ADMIN) && (await otherActiveAdmins(before.id)) === 0)
      throw new HttpError(409, 'LAST_ADMIN', 'Cannot remove the last active admin');
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: before.id }, data: {
      name: b.name ?? before.name, phone: b.phone ?? before.phone, email: b.email ?? before.email } });
    if (roleRows) {
      await tx.userRole.deleteMany({ where: { userId: before.id } });
      await tx.userRole.createMany({ data: roleRows.map((r) => ({ userId: before.id, roleId: r.id })) });
    }
  });
  const after = await getScoped(req, before.id);
  await audit(req, { action: b.roles !== undefined ? EV.ROLE_CHANGED : EV.USER_UPDATED, entityType: 'user', entityId: before.id,
    oldValue: { name: before.name, phone: before.phone, email: before.email, roles: before.roles },
    newValue: { name: after.name, phone: after.phone, email: after.email, roles: after.roles }, reason: b.reason });
  return after;
}

const revokeSessions = (userId) => prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });

export async function deactivateUser(req) {
  const u = await getScoped(req, req.params.id);
  const reason = req.body?.reason;
  if (!reason) throw bad('reason is required');
  if (u.id === req.user.id) throw forbidden('You cannot deactivate yourself');
  if ((await isAdmin(u.id)) && (await otherActiveAdmins(u.id)) === 0)
    throw new HttpError(409, 'LAST_ADMIN', 'Cannot deactivate the last active admin');
  // TODO(integration): refuse while the user has an open shift or open orders (Billing and Orders modules).
  await prisma.$transaction([
    prisma.user.update({ where: { id: u.id }, data: { status: 'inactive' } }),
    prisma.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await audit(req, { action: EV.USER_DEACTIVATED, entityType: 'user', entityId: u.id,
    oldValue: { status: u.status }, newValue: { status: 'inactive' }, reason });
  return getScoped(req, u.id);
}

export async function activateUser(req) {
  const u = await getScoped(req, req.params.id);
  await prisma.user.update({ where: { id: u.id }, data: { status: 'active', failedAttempts: 0 } });
  await audit(req, { action: EV.USER_ACTIVATED, entityType: 'user', entityId: u.id,
    oldValue: { status: u.status }, newValue: { status: 'active' }, reason: req.body?.reason });
  return getScoped(req, u.id);
}

export async function unlockUser(req) {
  const u = await getScoped(req, req.params.id);
  if (u.status !== 'locked') throw new HttpError(409, 'NOT_LOCKED', 'User is not locked');
  await prisma.user.update({ where: { id: u.id }, data: { status: 'active', failedAttempts: 0 } });
  await audit(req, { action: EV.USER_UNLOCKED, entityType: 'user', entityId: u.id, reason: req.body?.reason });
  return getScoped(req, u.id);
}

const resetBody = z.object({ password: z.string().optional(), pin: z.string().optional(), reason: z.string().optional() });

export async function resetCredentials(req) {
  const u = await getScoped(req, req.params.id);
  const b = resetBody.parse(req.body);
  if (b.password === undefined && b.pin === undefined) throw bad('Provide password and/or pin');
  if (b.password !== undefined) { const p = passwordProblem(b.password); if (p) throw bad(p); }
  if (b.pin !== undefined) { const p = pinProblem(b.pin); if (p) throw bad(p); }
  const data = { mustChange: true, failedAttempts: 0 };
  if (b.password !== undefined) data.passwordHash = await hashSecret(b.password);
  if (b.pin !== undefined) data.pinHash = await hashSecret(b.pin);
  await prisma.$transaction([prisma.user.update({ where: { id: u.id }, data }), revokeSessions(u.id)]);
  await audit(req, { action: EV.CREDENTIALS_RESET, entityType: 'user', entityId: u.id,
    newValue: { password: b.password !== undefined, pin: b.pin !== undefined }, reason: b.reason });
}
