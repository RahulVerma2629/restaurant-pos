import { prisma } from '../../config/prisma.js';
import { HttpError, bad, forbidden } from '../../utils/errors.js';
import { audit } from '../audit/audit.service.js';
import { AUDIT_EVENTS as EV } from '../../../../shared/constants/audit-events.js';

// Which permission governs each overridable action.
export const OVERRIDE_ACTIONS = { DISCOUNT: 'discounts.apply', REFUND: 'refunds.process' };

export async function rolePermissions(roleId) {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId }, include: { permission: true }, orderBy: { permission: { code: 'asc' } },
  });
  return rows.map((r) => ({ code: r.permission.code, scope: r.scope, limit: r.limitValue === null ? null : r.limitValue.toNumber() }));
}

// Enforces a numeric limit (discount % or refund amount). Billing calls this before applying the action.
// Above the limit a manager-approved request is required, and it can be used only once.
export async function checkLimit(req, { permission, action, value, entityType, entityId }) {
  if (typeof value !== 'number' || !(value >= 0)) throw bad('A non-negative numeric value is required');
  const p = req.perms.get(permission);
  if (!p) throw forbidden(`Missing permission: ${permission}`);

  let approvedBy = null;
  if (p.limit !== null && value > p.limit) {
    const approvalId = req.body?.approvalId;
    if (!approvalId) throw new HttpError(403, 'APPROVAL_REQUIRED', `Above your limit of ${p.limit}; manager approval required`, { limit: p.limit });
    const a = await prisma.approval.findUnique({ where: { id: Number(approvalId) } });
    if (!a || a.requestedBy !== req.user.id || a.action !== action || a.status !== 'approved' || a.payload.value < value)
      throw new HttpError(403, 'APPROVAL_INVALID', 'Approval is missing, not approved, already used, or does not cover this value');
    // single use: only one request can flip approved -> used
    const used = await prisma.approval.updateMany({ where: { id: a.id, status: 'approved' }, data: { status: 'used' } });
    if (used.count !== 1) throw new HttpError(403, 'APPROVAL_INVALID', 'Approval already used');
    approvedBy = a.decidedBy;
  }
  await audit(req, { action: action === 'DISCOUNT' ? EV.DISCOUNT_APPLIED : EV.REFUND_AUTHORIZED,
    entityType, entityId, newValue: { value }, approvedBy, reason: req.body?.reason });
  return { allowed: true, approvedBy: approvedBy, limit: p.limit };
}
