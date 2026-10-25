# Idempotency & Concurrency

## Problem
- A cashier taps "Pay" twice, or the Wi-Fi drops after the server charged but before the tablet got the answer. Without protection the customer is charged twice.
- Two waiters edit the same table at once. The last save silently erases the first.

## 1. Idempotency (`idempotent()` middleware)

File: `backend/src/modules/reliability/idempotency.js`

```js
import { idempotentRoute } from '../reliability/index.js';
router.post("/:id/payments", ...guard(PERMISSIONS.PAYMENTS_PROCESS), idempotentRoute(), handler);
```
Use `idempotentRoute()` from `modules/reliability/index.js` inside other modules; it connects to the shared store automatically.

| Situation | Result |
|---|---|
| First request with a new key | Runs, answer stored (24 h) |
| Same key + same body again | Stored answer returned, `Idempotent-Replayed: true`, handler NOT run |
| Same key + different body | `422 IDEMPOTENCY_KEY_REUSED` |
| Same key while first still running | `409 REQUEST_IN_PROGRESS` + `Retry-After: 1` |
| First request ended with 5xx or dropped connection | Key released, retry runs normally |
| No key on a protected route | `400 IDEMPOTENCY_KEY_REQUIRED` |

Keys are scoped per user (`userId:key`). Client rule: create one UUID per user action and reuse it for every retry of that action.

Apply to: create order, send KOT, payments, refunds, void, stock movements, cash-shift open/close.

## 2. Optimistic locking (`If-Match` + `version`)

File: `backend/src/modules/reliability/optimisticLock.js`. The Orders module already does this in Python (`check_version`); this is the same contract for Node modules.

1. Every mutable table has `version INTEGER NOT NULL DEFAULT 1`.
2. Client sends `If-Match: <version it last saw>`.
3. Service updates with a guard and bumps the version in one statement:
   ```sql
   UPDATE bills SET status = $1, version = version + 1 WHERE id = $2 AND version = $3;
   ```
4. `rowCount = 0` → throw `versionConflict()` → client gets `409 VERSION_CONFLICT`, reloads, user re-applies the change.

## 3. Other concurrency rules
- Money-moving code runs inside a database transaction; never read-then-write without the version guard.
- Take row locks (`SELECT ... FOR UPDATE`) only when you must read several rows and write one (e.g. stock deduction), always in the same order (by id) to avoid deadlocks.
- Orders module uses a single write lock because SQLite allows one writer; moving to PostgreSQL removes this limit (see `scalability-and-nfr.md`).
- Background jobs that read events (`/events?after_id=`) must be idempotent: store the last processed id and ignore repeats.

## 4. How it is tested
`tests/backend/reliability.test.mjs` covers retry, mismatch, simultaneous requests, 500-release, bad key, and version helpers.
