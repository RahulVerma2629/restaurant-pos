import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { HttpError, bad } from '../../utils/errors.js';
import { verifySecret, hashSecret, newToken, sha256, passwordProblem, pinProblem } from '../../utils/crypto.js';
import { audit } from '../audit/audit.service.js';
import { loadAccess } from '../rbac/access.js';
import { AUDIT_EVENTS as EV } from '../../../../shared/constants/audit-events.js';

const loginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1).optional(),
  pin: z.string().min(1).optional(),
  terminalId: z.string().optional(),
});

export const permList = (perms) => [...perms].map(([code, v]) => ({ code, scope: v.scope, limit: v.limit }));

export async function login(req, method) {
  const body = loginBody.parse(req.body);
  const secret = method === 'pin' ? body.pin : body.password;
  if (!secret) throw bad(`${method === 'pin' ? 'pin' : 'password'} is required`);
  const username = body.username;
  req.terminalId = body.terminalId ?? null;

  const user = await prisma.user.findUnique({ where: { username } });

  const fail = async (reason, status, code, message) => {
    await prisma.loginActivity.create({ data: { userId: user?.id ?? null, username, terminalId: req.terminalId,
      ip: req.ip, method, success: false, reason } });
    await audit(req, { action: EV.LOGIN_FAILED, entityType: 'user', entityId: user?.id, userId: user?.id,
      branchId: user?.branchId, newValue: { username, method, reason } });
    throw new HttpError(status, code, message);
  };

  if (!user) await fail('unknown_user', 401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  if (user.status === 'locked') await fail('locked', 423, 'ACCOUNT_LOCKED', 'Account is locked. Ask a manager to unlock it');

  const ok = await verifySecret(secret, method === 'pin' ? user.pinHash : user.passwordHash);
  if (!ok) {
    const updated = await prisma.user.update({ where: { id: user.id }, data: { failedAttempts: { increment: 1 } } });
    if (updated.failedAttempts >= env.maxFailed) {
      await prisma.user.update({ where: { id: user.id }, data: { status: 'locked' } });
      await audit(req, { action: EV.ACCOUNT_LOCKED, entityType: 'user', entityId: user.id, userId: user.id,
        branchId: user.branchId, reason: `${updated.failedAttempts} failed attempts` });
    }
    await fail('bad_credentials', 401, 'INVALID_CREDENTIALS', 'Invalid credentials');
  }
  if (user.status !== 'active') await fail('not_active', 403, 'ACCOUNT_INACTIVE', 'Account is not active');

  const token = newToken();
  const expiresAt = new Date(Date.now() + env.maxHours * 3_600_000);
  await prisma.$transaction([
    // one active session per user: older logins are ended
    prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lastLoginAt: new Date() } }),
    prisma.session.create({ data: { userId: user.id, terminalId: req.terminalId, tokenHash: sha256(token), expiresAt } }),
    prisma.loginActivity.create({ data: { userId: user.id, username, terminalId: req.terminalId, ip: req.ip, method, success: true } }),
  ]);

  const access = await loadAccess(user.id);
  req.user = user;
  req.roles = access.roles;
  await audit(req, { action: EV.LOGIN, entityType: 'user', entityId: user.id, newValue: { method } });

  return {
    token, expiresAt: expiresAt, mustChange: user.mustChange,
    user: { id: user.id, name: user.name, username: user.username, branchId: user.branchId },
    roles: access.roles, permissions: permList(access.perms),
  };
}

export async function logout(req) {
  await prisma.session.update({ where: { id: req.session.id }, data: { revokedAt: new Date() } });
  await audit(req, { action: EV.LOGOUT, entityType: 'user', entityId: req.user.id });
}

const changeBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().optional(),
  newPin: z.string().optional(),
});

export async function changeCredentials(req) {
  const b = changeBody.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!(await verifySecret(b.currentPassword, user.passwordHash)))
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Current password is wrong');
  if (b.newPassword === undefined && b.newPin === undefined) throw bad('Provide newPassword and/or newPin');
  if (b.newPassword !== undefined) { const p = passwordProblem(b.newPassword); if (p) throw bad(p); }
  if (b.newPin !== undefined) { const p = pinProblem(b.newPin); if (p) throw bad(p); }
  await prisma.user.update({ where: { id: user.id }, data: {
    passwordHash: b.newPassword !== undefined ? await hashSecret(b.newPassword) : user.passwordHash,
    pinHash: b.newPin !== undefined ? await hashSecret(b.newPin) : user.pinHash,
    mustChange: false,
  } });
  await audit(req, { action: EV.CREDENTIALS_CHANGED, entityType: 'user', entityId: user.id,
    newValue: { password: b.newPassword !== undefined, pin: b.newPin !== undefined } });
}
