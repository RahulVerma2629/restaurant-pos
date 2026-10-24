import { prisma } from '../../config/prisma.js';
import { SCOPE_RANK } from '../../../../shared/constants/permissions.js';

// Loads a user's roles and merged permissions. Called on every request so role changes apply at once.
// Merge rule: highest scope wins; "no limit" (null) beats any number.
export async function loadAccess(userId) {
  const userRoles = await prisma.userRole.findMany({
    where: { userId },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  const roles = userRoles.map((ur) => ur.role.name).sort();
  const perms = new Map();
  for (const ur of userRoles) {
    for (const rp of ur.role.permissions) {
      const code = rp.permission.code;
      const limit = rp.limitValue === null ? null : rp.limitValue.toNumber();
      const cur = perms.get(code);
      if (!cur) { perms.set(code, { scope: rp.scope, limit }); continue; }
      if (SCOPE_RANK[rp.scope] > SCOPE_RANK[cur.scope]) cur.scope = rp.scope;
      cur.limit = cur.limit === null || limit === null ? null : Math.max(cur.limit, limit);
    }
  }
  return { roles, perms };
}

// Prisma "where" fragment that limits rows to what a scope allows.
export function scopeWhere(req, scope, { branchField = 'branchId', userField = 'userId' } = {}) {
  if (scope === 'all') return {};
  if (scope === 'branch') return { [branchField]: req.user.branchId };
  return { [userField]: req.user.id };
}

export const hasPermission = (req, code) => req.perms?.has(code) ?? false;
