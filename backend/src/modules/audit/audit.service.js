import { prisma } from '../../config/prisma.js';
import { scopeWhere } from '../rbac/access.js';

// The one function every module calls to write an audit record.
// Use event names from shared/constants/audit-events.js.
export async function audit(req, e) {
  await prisma.auditLog.create({
    data: {
      userId: e.userId ?? req.user?.id ?? null,
      role: req.user ? req.roles.join(',') : null,
      branchId: e.branchId ?? req.user?.branchId ?? null,
      terminalId: req.terminalId ?? null,
      action: e.action,
      entityType: e.entityType ?? null,
      entityId: e.entityId == null ? null : String(e.entityId),
      oldValue: e.oldValue ?? undefined,   // undefined = leave NULL
      newValue: e.newValue ?? undefined,
      reason: e.reason ?? null,
      approvedBy: e.approvedBy ?? null,
      ip: req.ip ?? null,
    },
  });
}

export async function searchAudit(req, scope, query) {
  const where = { ...scopeWhere(req, scope) };
  if (query.userId) where.userId = Number(query.userId);
  for (const [q, field] of [['action', 'action'], ['entityType', 'entityType'], ['entityId', 'entityId']]) {
    if (query[q]) where[field] = String(query[q]);
  }
  if (query.from || query.to) {
    where.createdAt = {};
    if (query.from) where.createdAt.gte = new Date(query.from);
    if (query.to) where.createdAt.lte = new Date(query.to);
  }
  const limit = Math.min(Number(query.limit) || 50, 200);
  const offset = Number(query.offset) || 0;
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, take: limit, skip: offset }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total, limit, offset };
}
