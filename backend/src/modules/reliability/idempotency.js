import { createHash } from 'node:crypto';
import { HttpError } from '../../utils/errors.js';

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

export const hashRequest = (req) =>
  createHash('sha256').update(`${req.method}|${req.baseUrl}${req.path}|${stable(req.body ?? null)}`).digest('hex');

// Use on any route that creates money or stock effects: orders, KOT, payments, refunds, stock moves.
//   router.post('/payments', authenticate, idempotent(store), handler)
// Header:  Idempotency-Key: <8-128 chars, [A-Za-z0-9_-:.]>  (generate a UUID per user action)
export function idempotent(store, { required = true, ttlMs = DEFAULT_TTL_MS } = {}) {
  return async function idempotencyMiddleware(req, res, next) {
    try {
      const key = req.get('Idempotency-Key');
      if (!key) {
        if (required) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required for this request');
        return next();
      }
      if (!KEY_PATTERN.test(key)) {
        throw new HttpError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be 8-128 characters: letters, digits, _ - : .');
      }

      const scopeKey = `${req.user?.id ?? 'anon'}:${key}`;
      const outcome = await store.begin(scopeKey, hashRequest(req), ttlMs);

      if (outcome.state === 'mismatch') {
        throw new HttpError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request');
      }
      if (outcome.state === 'inflight') {
        res.set('Retry-After', '1');
        throw new HttpError(409, 'REQUEST_IN_PROGRESS', 'A request with this Idempotency-Key is still being processed');
      }
      if (outcome.state === 'replay') {
        res.set('Idempotent-Replayed', 'true');
        return res.status(outcome.record.status).json(outcome.record.body);
      }

      // state === 'new': capture the response so a retry gets the identical answer.
      const originalJson = res.json.bind(res);
      let finished = false;
      res.json = (body) => {
        if (!finished) {
          finished = true;
          const status = res.statusCode;
          const save = status >= 500 ? store.release(scopeKey) : store.complete(scopeKey, status, body);
          Promise.resolve(save).catch((e) => console.error('idempotency store write failed', e));
        }
        return originalJson(body);
      };
      res.on('close', () => {
        // Client dropped or handler threw before responding: free the key so a retry can run.
        if (!finished) {
          finished = true;
          Promise.resolve(store.release(scopeKey)).catch(() => {});
        }
      });
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
