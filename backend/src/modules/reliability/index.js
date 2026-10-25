import { createMemoryIdempotencyStore, createMemoryChangeLog } from './store.memory.js';
import { registerReadinessCheck } from './health.js';
import { createReliabilityRouter } from './reliability.routes.js';
import { idempotent } from './idempotency.js';

export { idempotent } from './idempotency.js';
export { expectedVersion, assertVersion, versionConflict } from './optimisticLock.js';
export { registerSyncHandler } from './sync.service.js';
export { registerReadinessCheck } from './health.js';

let built = null;

// The shared stores, available after buildReliability() has run (routes/index.js does this at startup).
export function getStores() {
  if (!built) throw new Error('Reliability module is not initialised yet');
  return built.stores;
}

// Use this in other modules' routers (works even if the router file is imported before startup finishes):
//   router.post('/:id/payments', ...guard(PERMISSIONS.PAYMENTS_PROCESS), idempotentRoute(), handler)
export function idempotentRoute(options) {
  let mw;
  return (req, res, next) => {
    try {
      mw = mw || idempotent(getStores().idempotency, options);
    } catch (e) {
      return next(e);
    }
    return mw(req, res, next);
  };
}

// Builds the router once (later calls return the same instance). RELIABILITY_STORE=memory (default) or pg.
export async function buildReliability({ authMiddleware = [] } = {}) {
  if (built) return built;
  let stores;
  if ((process.env.RELIABILITY_STORE || 'memory') === 'pg') {
    const { createPgStores } = await import('./store.pg.js');
    const pgStores = await createPgStores();
    stores = { idempotency: pgStores.idempotency, changeLog: pgStores.changeLog };
    registerReadinessCheck('database', pgStores.ping);
  } else {
    stores = { idempotency: createMemoryIdempotencyStore(), changeLog: createMemoryChangeLog() };
  }
  built = { stores, router: createReliabilityRouter({ authMiddleware, stores }) };
  return built;
}
