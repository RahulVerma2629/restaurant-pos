import { HttpError } from '../../utils/errors.js';

// Offline-first sync. Each terminal queues operations while offline and pushes them in order when back online.
// Every operation has a client-generated opId (UUID), so a retried push never applies twice.
// Other modules register how to apply their operation types:
//   registerSyncHandler('order.create', async (op, ctx) => ({ entityId, data }))

const MAX_BATCH = 100;
const handlers = new Map();

export function registerSyncHandler(type, fn) {
  if (typeof fn !== 'function') throw new Error(`Sync handler for ${type} must be a function`);
  handlers.set(type, fn);
}
export const clearSyncHandlers = () => handlers.clear();
export const listSyncHandlers = () => [...handlers.keys()];

function validateOp(op, index) {
  const bad = (m) => new HttpError(400, 'VALIDATION_ERROR', `operations[${index}]: ${m}`);
  if (!op || typeof op !== 'object') throw bad('must be an object');
  if (typeof op.opId !== 'string' || op.opId.length < 8 || op.opId.length > 128) throw bad('opId must be a string of 8-128 characters');
  if (typeof op.type !== 'string' || !op.type) throw bad('type is required');
  if (op.payload !== undefined && (op.payload === null || typeof op.payload !== 'object')) throw bad('payload must be an object');
}

export function createSyncService({ changeLog }) {
  return {
    // Applies a batch in order. Returns one result per operation; one failing op does not stop the rest.
    async push({ deviceId, user, operations }) {
      if (!Array.isArray(operations) || operations.length === 0) throw new HttpError(400, 'VALIDATION_ERROR', 'operations must be a non-empty array');
      if (operations.length > MAX_BATCH) throw new HttpError(413, 'BATCH_TOO_LARGE', `Maximum ${MAX_BATCH} operations per push`);
      operations.forEach(validateOp);

      const results = [];
      for (const op of operations) {
        const previous = await changeLog.getOp(op.opId);
        if (previous) {
          results.push({ opId: op.opId, ...previous, status: 'duplicate' });
          continue;
        }
        const handler = handlers.get(op.type);
        if (!handler) {
          results.push({ opId: op.opId, status: 'rejected', code: 'UNKNOWN_OPERATION', message: `No handler for ${op.type}` });
          continue;
        }
        let result;
        try {
          const out = (await handler(op, { deviceId, user })) || {};
          const event = await changeLog.append({
            entity: op.type.split('.')[0],
            entityId: out.entityId ?? op.opId,
            op: op.type,
            data: out.data ?? null,
            branchId: user?.branchId != null ? String(user.branchId) : null,
          });
          result = { status: 'applied', entityId: out.entityId ?? null, seq: event.seq };
        } catch (err) {
          if (err instanceof HttpError && err.status === 409) {
            result = { status: 'conflict', code: err.code, message: err.message, details: err.details ?? null };
          } else if (err instanceof HttpError && err.status < 500) {
            result = { status: 'rejected', code: err.code, message: err.message };
          } else {
            // Unexpected failure: do NOT remember it, so the client can retry the same opId.
            console.error('sync handler failed', op.type, err);
            results.push({ opId: op.opId, status: 'retry', code: 'INTERNAL_ERROR', message: 'Temporary failure, retry later' });
            continue;
          }
        }
        await changeLog.saveOp(op.opId, result);
        results.push({ opId: op.opId, ...result });
      }
      return { deviceId, results };
    },

    async pull({ cursor, branchId, limit }) {
      const c = Number(cursor ?? 0);
      if (!Number.isInteger(c) || c < 0) throw new HttpError(400, 'VALIDATION_ERROR', 'cursor must be a non-negative integer');
      const l = Math.min(Math.max(Number(limit ?? 200) || 200, 1), 500);
      return changeLog.changesSince(c, { branchId, limit: l });
    },
  };
}
