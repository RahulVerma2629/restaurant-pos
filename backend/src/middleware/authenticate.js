import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { sha256 } from '../utils/crypto.js';
import { HttpError, forbidden } from '../utils/errors.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { loadAccess } from '../modules/rbac/access.js';

// Validates "Authorization: Bearer <token>" and fills req.user, req.roles, req.perms.
export const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Login required');

  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.revokedAt) throw new HttpError(401, 'SESSION_INVALID', 'Session is not valid');

  const now = Date.now();
  const idleLimit = session.lastSeenAt.getTime() + env.idleMinutes * 60_000;
  if (session.expiresAt.getTime() < now || idleLimit < now) {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    throw new HttpError(401, 'SESSION_EXPIRED', 'Session expired, please log in again');
  }
  if (session.user.status !== 'active') throw new HttpError(401, 'SESSION_INVALID', 'Account is not active');

  await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  const { id, name, username, branchId, status, mustChange } = session.user;
  const access = await loadAccess(id);
  req.user = { id, name, username, branchId, status, mustChange };
  req.session = session;
  req.terminalId = session.terminalId;
  req.roles = access.roles;
  req.perms = access.perms;
  next();
});

// Use after authenticate:  router.get('/', authenticate, requirePermission(PERMISSIONS.USERS_MANAGE), handler)
// Sets req.access = { scope, limit } for that permission.
export const requirePermission = (code) => (req, res, next) => {
  const p = req.perms?.get(code);
  if (!p) return next(forbidden(`Missing permission: ${code}`));
  req.access = p;
  next();
};

// Shortcut for the two together: router.get('/', ...guard(PERMISSIONS.USERS_MANAGE), handler)
export const guard = (code) => [authenticate, requirePermission(code)];
