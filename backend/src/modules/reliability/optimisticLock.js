import { HttpError } from '../../utils/errors.js';

// Optimistic concurrency: every mutable row has an integer `version` (default 1).
// Clients send  If-Match: <version>  when editing; the server rejects stale edits with 409.

export function expectedVersion(req, { required = true } = {}) {
  const raw = req.get('If-Match') ?? req.body?.version;
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new HttpError(428, 'VERSION_REQUIRED', 'If-Match header (current version) is required');
    return null;
  }
  const n = Number(String(raw).replace(/"/g, ''));
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'VERSION_INVALID', 'If-Match must be a positive integer version');
  return n;
}

export function assertVersion(expected, current, what = 'Record') {
  if (expected !== current) {
    throw new HttpError(409, 'VERSION_CONFLICT', `${what} was changed by someone else. Reload and try again.`, {
      expected,
      current,
    });
  }
}

// SQL pattern (use in services): the UPDATE only succeeds if nobody else changed the row.
//   UPDATE orders SET status = $1, version = version + 1 WHERE id = $2 AND version = $3
// If rowCount === 0, throw versionConflict(). Never read-then-write without this guard.
export const versionConflict = (what = 'Record') =>
  new HttpError(409, 'VERSION_CONFLICT', `${what} was changed by someone else. Reload and try again.`);
