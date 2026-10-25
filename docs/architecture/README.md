# Architecture, Integration & Reliability (Fifth Team Member)

Owner: Fifth Team Member. Scope as per `PROJECT-STRUCTURE.md`.

| Document | What it covers |
|---|---|
| [system-architecture.md](system-architecture.md) | Components, data flow, deployment, tech decisions |
| [api-architecture.md](api-architecture.md) | One API standard every module follows (URLs, errors, headers, pagination) |
| [idempotency-concurrency.md](idempotency-concurrency.md) | No double payments, no double orders, no lost updates |
| [offline-sync.md](offline-sync.md) | How terminals keep working without internet and sync later |
| [scalability-and-nfr.md](scalability-and-nfr.md) | Scalability plan and measurable non-functional requirements |
| [integrations-hardware-network.md](integrations-hardware-network.md) | Payment gateway, printers, KDS, network rules |
| [backup-recovery.md](backup-recovery.md) | Backups, restore drills, RPO/RTO, disaster steps |
| [integration-status.md](integration-status.md) | What was found wrong across modules, what was fixed, what each owner must do |

Code delivered by this module:

- `backend/src/modules/reliability/` – health checks, idempotency middleware, optimistic locking, offline sync API
- `database/migrations/002_reliability.sql` – tables for the above
- `scripts/backup/backup.sh`, `scripts/backup/restore.sh` – backup and restore
- `shared/contracts/reliability-api.md` – API contract other modules rely on
- `tests/backend/reliability.test.mjs` – 12 automated checks (`cd backend && npm run test:reliability`)
- `.github/workflows/ci.yml` – runs the tests on every push
