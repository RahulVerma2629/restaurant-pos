# Integration Status (checked 25 Oct 2026)

Result of reviewing the full repository from the Fifth Member role.

## A. Problems found and fixed by this module
| # | Problem | Fix |
|---|---|---|
| 1 | `backend/package.json` was **invalid JSON** (two files pasted together). `npm install` failed for everyone. | One merged valid file: all scripts and dependencies of both modules, Express 4 (security module is built on it). |
| 2 | `backend/package-lock.json` did not match | Regenerated from the merged `package.json`. |
| 3 | No health checks, no retry safety, no offline sync | `backend/src/modules/reliability/` added and mounted in `src/routes/index.js`. |
| 4 | No backup/restore | `scripts/backup/*.sh` |
| 5 | No CI | `.github/workflows/ci.yml` |

Verified after the fix: `npm run test:reliability` 13/13 pass, billing `npm test` 19/19 pass, `npm run typecheck` no errors, migration `002_reliability.sql` runs twice without error on PostgreSQL.

## B. Open items for other owners (not changed by me)
| Owner | Item | How |
|---|---|---|
| Rahul (Billing) | Billing is not served. `npm run dev` runs `src/server.js` → `app.js`, but billing is mounted only in `app.ts`/`server.ts`. | Mount billing in `src/routes/index.js` under `/billing` and `/cash-shifts`; run the server with `tsx` so `.ts` files load; then delete `app.ts`/`server.ts`. |
| Rahul | Billing routes have no login or permission check | Add `...guard(PERMISSIONS.PAYMENTS_PROCESS)` |
| Rahul | Payments/refunds/void/shift routes are not retry-safe | Add `idempotentRoute()` before the handler (see `idempotency-concurrency.md`) |
| Rahul | Billing tables use raw SQL (`001_billing.sql`), security uses Prisma | Keep both; run `001` and `002` with `psql` after `prisma migrate dev` |
| Prashant (Orders) | Orders runs separately on port 8000 with SQLite | Frontend calls it directly or via a reverse proxy; plan the move to PostgreSQL in `scalability-and-nfr.md` |
| Prashant | Register offline handlers | `registerSyncHandler('order.create', …)` etc. (see `offline-sync.md`) |
| Tia (Inventory) | Modules folders are empty | Use the same pattern: router under `src/routes/index.js`, `guard()`, `idempotentRoute()` |
| Somil (Security) | Permission codes | Add `sync.push` only if you want sync restricted by role (today any logged-in user can sync) |
| Everyone | Same `If-Match` / error shape / headers | `api-architecture.md` |

## C. Files changed in other people's areas (small, reviewed)
- `backend/package.json`, `backend/package-lock.json` – repaired (see A1, A2)
- `backend/src/routes/index.js` – 3 lines added to mount the reliability router
- `backend/.env.example` – `RELIABILITY_STORE=memory` added

## D. Start-up order (new developer)
```bash
docker compose up -d db
cd backend && cp .env.example .env && npm install
npx prisma migrate dev --name security_init
psql "postgresql://pos:pos@localhost:5432/pos" -f ../database/migrations/001_billing.sql
psql "postgresql://pos:pos@localhost:5432/pos" -f ../database/migrations/002_reliability.sql
npm run db:triggers && npm run seed
npm run dev     # http://localhost:3000/api/v1/health/ready
npm run test:reliability
```
For production set `RELIABILITY_STORE=pg`.
