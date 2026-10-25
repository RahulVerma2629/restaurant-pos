-- 002_reliability.sql  (Architecture, Integration & Reliability module)
-- Safe to run more than once. Run after the security (Prisma) migration and 001_billing.sql.
--   psql "$DATABASE_URL_PLAIN" -f database/migrations/002_reliability.sql

-- 1) Idempotency: remembers the answer to a request so a retry never repeats money/stock effects.
CREATE TABLE IF NOT EXISTS idempotency_keys (
    scope_key       TEXT PRIMARY KEY,                 -- "<userId>:<Idempotency-Key>"
    request_hash    TEXT NOT NULL,                    -- sha256 of method + path + body
    state           TEXT NOT NULL CHECK (state IN ('in_progress', 'done')),
    response_status INTEGER,
    response_body   JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at);

-- 2) Change log: every applied change gets an increasing seq; terminals pull "everything after my cursor".
CREATE TABLE IF NOT EXISTS sync_changes (
    seq         BIGSERIAL PRIMARY KEY,
    entity      TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    op          TEXT NOT NULL,
    data        JSONB,
    branch_id   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_changes_branch ON sync_changes (branch_id, seq);

-- 3) Offline operations already applied (opId -> result), so a re-pushed operation is never applied twice.
CREATE TABLE IF NOT EXISTS sync_ops (
    op_id       TEXT PRIMARY KEY,
    result      JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4) Registered terminals (tablets, POS, printers, KDS screens) and last time they synced.
CREATE TABLE IF NOT EXISTS devices (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL CHECK (kind IN ('pos', 'tablet', 'kds', 'printer', 'other')),
    branch_id     TEXT,
    last_seen_at  TIMESTAMPTZ,
    last_cursor   BIGINT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5) Backup log: filled by scripts/backup/backup.sh so recovery drills can be audited.
CREATE TABLE IF NOT EXISTS backup_runs (
    id            BIGSERIAL PRIMARY KEY,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ,
    file_name     TEXT,
    size_bytes    BIGINT,
    sha256        TEXT,
    status        TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
    note          TEXT
);

-- Housekeeping function: call daily (cron / pg_cron).
CREATE OR REPLACE FUNCTION reliability_cleanup() RETURNS void AS $$
BEGIN
    DELETE FROM idempotency_keys WHERE expires_at < now();
    DELETE FROM sync_ops WHERE created_at < now() - INTERVAL '30 days';
    DELETE FROM sync_changes WHERE created_at < now() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;
