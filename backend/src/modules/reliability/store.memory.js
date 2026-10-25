// In-memory stores. Used in tests and local dev (RELIABILITY_STORE=memory, the default).
// For production use store.pg.js (RELIABILITY_STORE=pg) so state survives restarts and is shared by all instances.

export function createMemoryIdempotencyStore({ now = () => Date.now() } = {}) {
  const records = new Map(); // scopeKey -> { hash, state, status, body, expiresAt }

  return {
    // Try to claim a key. Returns { state: 'new' | 'replay' | 'inflight' | 'mismatch', record? }
    async begin(scopeKey, hash, ttlMs) {
      const existing = records.get(scopeKey);
      if (existing && existing.expiresAt <= now()) records.delete(scopeKey);
      const current = records.get(scopeKey);
      if (!current) {
        records.set(scopeKey, { hash, state: 'in_progress', status: null, body: null, expiresAt: now() + ttlMs });
        return { state: 'new' };
      }
      if (current.hash !== hash) return { state: 'mismatch' };
      if (current.state === 'in_progress') return { state: 'inflight' };
      return { state: 'replay', record: { status: current.status, body: current.body } };
    },
    async complete(scopeKey, status, body) {
      const r = records.get(scopeKey);
      if (r) Object.assign(r, { state: 'done', status, body });
    },
    async release(scopeKey) {
      records.delete(scopeKey);
    },
  };
}

export function createMemoryChangeLog() {
  const events = []; // { seq, entity, entityId, op, data, branchId, at }
  const seenOps = new Map(); // opId -> stored result
  let seq = 0;

  return {
    async append({ entity, entityId, op, data, branchId = null }) {
      seq += 1;
      const event = { seq, entity, entityId, op, data, branchId, at: new Date().toISOString() };
      events.push(event);
      return event;
    },
    async changesSince(cursor, { branchId = null, limit = 200 } = {}) {
      const rows = events.filter((e) => e.seq > cursor && (branchId == null || e.branchId == null || e.branchId === branchId));
      const page = rows.slice(0, limit);
      return { events: page, nextCursor: page.length ? page[page.length - 1].seq : cursor, hasMore: rows.length > page.length };
    },
    async getOp(opId) {
      return seenOps.get(opId) || null;
    },
    async saveOp(opId, result) {
      seenOps.set(opId, result);
    },
  };
}
