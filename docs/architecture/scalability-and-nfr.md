# Scalability & Non-Functional Requirements

## 1. Targets (single branch, one restaurant)
| ID | Requirement | Target | How it is checked |
|---|---|---|---|
| NFR-01 | Availability during service hours | 99.5 % per month | Uptime monitor on `/health/live` |
| NFR-02 | API response time (p95) for create order / payment | < 300 ms on LAN | Load test (k6) before release |
| NFR-03 | Concurrent terminals | 20 per branch without errors | Load test |
| NFR-04 | Orders per hour | 600 peak | Load test |
| NFR-05 | Data loss after crash (RPO) | ≤ 24 h with nightly backup; ≤ 5 min with WAL archiving | Restore drill |
| NFR-06 | Time to restore (RTO) | ≤ 60 min | Restore drill |
| NFR-07 | No double charge on retry | 0 cases | Idempotency tests |
| NFR-08 | Offline tolerance | Terminal usable for ≥ 8 h offline | Offline test |
| NFR-09 | Security | Passwords hashed (bcrypt), audit log append-only, HTTPS in production | Security review |
| NFR-10 | Browser/device support | Latest Chrome/Edge/Safari, tablets ≥ 8" | Manual test |
| NFR-11 | Maintainability | CI green on every PR, one module per folder | GitHub Actions |
| NFR-12 | Observability | Health endpoints, structured error codes, audit trail | Dashboard check |

## 2. Scaling plan
| Stage | Change |
|---|---|
| Now | One Node process + one Orders process + PostgreSQL |
| Stage 1 | Run Node API with several processes behind Nginx (stateless; sessions and idempotency are in the DB when `RELIABILITY_STORE=pg`) |
| Stage 2 | Move Orders from SQLite to PostgreSQL (set `DATABASE_URL` to a Postgres URL; remove the global write lock, use row versions) |
| Stage 3 | Read replica for reports/dashboards so heavy reports do not slow billing |
| Stage 4 | Multi-branch cloud: partition by `branch_id`, offline queue on each branch |

Rules that keep scaling possible: no in-process state except caches, every list is paginated, all writes are idempotent, reports read from replicas or summary tables.

## 3. Database hygiene
- Index every foreign key and every `branch_id + created_at` filter.
- Run `SELECT reliability_cleanup();` daily.
- Connection pool: `max 10` per process (see `database/pool.ts`); total must stay below PostgreSQL `max_connections`.

## 4. Load test (before go-live)
Use k6 or autocannon against `/api/v1/health/ready`, create order, and payment (with unique `Idempotency-Key`). Pass criteria: NFR-02, NFR-03, NFR-04 and zero 5xx.
