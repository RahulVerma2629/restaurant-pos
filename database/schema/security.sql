-- REFERENCE ONLY. The real tables are created by Prisma (backend/prisma/schema.prisma + `npx prisma migrate dev`).
-- Kept for documentation and for DBAs. Do not run it on a database that Prisma manages.
-- Security module tables (PostgreSQL). Owner: Security/RBAC.
-- Assumes a `branches` table from the restaurants/branches module. Until it exists, use this stub:
--   CREATE TABLE IF NOT EXISTS branches (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE);
-- Convert to Prisma models once the backend Prisma setup exists; keep names and constraints the same.

CREATE TABLE users (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name             TEXT NOT NULL,
  username         TEXT NOT NULL UNIQUE,
  password_hash    TEXT,
  pin_hash         TEXT,
  phone            TEXT,
  email            TEXT,
  branch_id        BIGINT NOT NULL REFERENCES branches(id),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','locked','pending')),
  failed_attempts  INTEGER NOT NULL DEFAULT 0,
  must_change      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at    TIMESTAMPTZ
);

CREATE TABLE roles (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE permissions (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,          -- e.g. 'refunds.process'
  module      TEXT NOT NULL,
  description TEXT
);

CREATE TABLE role_permissions (
  role_id       BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id BIGINT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL DEFAULT 'branch' CHECK (scope IN ('own','branch','all')),
  limit_value   NUMERIC(12,2),               -- NULL = unlimited
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES roles(id),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sessions (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id),
  terminal_id  TEXT,
  token_hash   TEXT NOT NULL UNIQUE,         -- never store the raw token
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_activity (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id),
  username    TEXT,
  terminal_id TEXT,
  ip          TEXT,
  method      TEXT CHECK (method IN ('password','pin')),
  success     BOOLEAN NOT NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE approvals (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action       TEXT NOT NULL,                -- 'DISCOUNT' | 'REFUND'
  requested_by BIGINT NOT NULL REFERENCES users(id),
  payload      JSONB NOT NULL,               -- { value, entity_id }
  reason       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','used')),
  decided_by   BIGINT REFERENCES users(id),
  decided_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     BIGINT REFERENCES users(id),
  role        TEXT,
  branch_id   BIGINT REFERENCES branches(id),
  terminal_id TEXT,
  action      TEXT NOT NULL,                 -- see shared/constants/audit-events.js
  entity_type TEXT,
  entity_id   TEXT,
  old_value   JSONB,
  new_value   JSONB,
  reason      TEXT,
  approved_by BIGINT REFERENCES users(id),
  ip          TEXT
);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_user   ON audit_logs(user_id);
CREATE INDEX idx_audit_time   ON audit_logs(created_at);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);

-- Audit log is append-only: the database refuses UPDATE, DELETE and TRUNCATE.
CREATE FUNCTION audit_logs_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_change();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_block_change();
