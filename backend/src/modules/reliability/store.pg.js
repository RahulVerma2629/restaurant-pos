// PostgreSQL stores (tables come from database/migrations/002_reliability.sql).
// `pg` is imported lazily so memory-mode and tests never need a database.

async function getPool() {
  const { default: pg } = await import('pg');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required when RELIABILITY_STORE=pg');
  // Prisma-style URLs may end with ?schema=public, which node-postgres does not understand.
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete('schema');
  return new pg.Pool({ connectionString: url.toString(), max: 5 });
}

// Pass { pool } to reuse an existing pg Pool (or a test double); otherwise one is created from DATABASE_URL.
export async function createPgStores({ pool: injected } = {}) {
  const pool = injected || (await getPool());

  const idempotency = {
    async begin(scopeKey, hash, ttlMs) {
      await pool.query('DELETE FROM idempotency_keys WHERE scope_key = $1 AND expires_at <= now()', [scopeKey]);
      const ins = await pool.query(
        `INSERT INTO idempotency_keys (scope_key, request_hash, state, expires_at)
         VALUES ($1, $2, 'in_progress', now() + ($3 || ' milliseconds')::interval)
         ON CONFLICT (scope_key) DO NOTHING RETURNING scope_key`,
        [scopeKey, hash, String(ttlMs)],
      );
      if (ins.rowCount === 1) return { state: 'new' };
      const { rows } = await pool.query(
        'SELECT request_hash, state, response_status, response_body FROM idempotency_keys WHERE scope_key = $1',
        [scopeKey],
      );
      const r = rows[0];
      if (!r) return { state: 'inflight' };
      if (r.request_hash !== hash) return { state: 'mismatch' };
      if (r.state === 'in_progress') return { state: 'inflight' };
      return { state: 'replay', record: { status: r.response_status, body: r.response_body } };
    },
    async complete(scopeKey, status, body) {
      await pool.query(
        "UPDATE idempotency_keys SET state = 'done', response_status = $2, response_body = $3 WHERE scope_key = $1",
        [scopeKey, status, JSON.stringify(body)],
      );
    },
    async release(scopeKey) {
      await pool.query('DELETE FROM idempotency_keys WHERE scope_key = $1', [scopeKey]);
    },
  };

  const changeLog = {
    async append({ entity, entityId, op, data, branchId = null }) {
      const { rows } = await pool.query(
        `INSERT INTO sync_changes (entity, entity_id, op, data, branch_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING seq, entity, entity_id, op, data, branch_id, created_at`,
        [entity, String(entityId), op, JSON.stringify(data ?? null), branchId],
      );
      const r = rows[0];
      return { seq: Number(r.seq), entity: r.entity, entityId: r.entity_id, op: r.op, data: r.data, branchId: r.branch_id, at: r.created_at.toISOString() };
    },
    async changesSince(cursor, { branchId = null, limit = 200 } = {}) {
      const { rows } = await pool.query(
        `SELECT seq, entity, entity_id, op, data, branch_id, created_at FROM sync_changes
         WHERE seq > $1 AND ($2::text IS NULL OR branch_id IS NULL OR branch_id = $2)
         ORDER BY seq ASC LIMIT $3`,
        [cursor, branchId, limit + 1],
      );
      const page = rows.slice(0, limit).map((r) => ({
        seq: Number(r.seq), entity: r.entity, entityId: r.entity_id, op: r.op, data: r.data, branchId: r.branch_id, at: r.created_at.toISOString(),
      }));
      return { events: page, nextCursor: page.length ? page[page.length - 1].seq : cursor, hasMore: rows.length > limit };
    },
    async getOp(opId) {
      const { rows } = await pool.query('SELECT result FROM sync_ops WHERE op_id = $1', [opId]);
      return rows[0]?.result || null;
    },
    async saveOp(opId, result) {
      await pool.query('INSERT INTO sync_ops (op_id, result) VALUES ($1, $2) ON CONFLICT (op_id) DO NOTHING', [opId, JSON.stringify(result)]);
    },
  };

  async function ping() {
    await pool.query('SELECT 1');
  }

  return { idempotency, changeLog, ping, close: () => (pool.end ? pool.end() : undefined) };
}
