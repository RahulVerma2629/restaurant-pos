# Reliability API Contract

Base: `/api/v1`. Errors: `{ "error": { "code", "message", "details" } }`. Success: `{ "data": … }`.

## Public
| Method | Path | Success | Notes |
|---|---|---|---|
| GET | `/health/live` | 200 `{ status:"ok", uptimeSeconds }` | Process alive |
| GET | `/health/ready` | 200 `{ status:"ready", checks }` or **503** `{ status:"degraded", checks }` | Dependencies |

## Authenticated (Bearer token)
### POST `/sync/push`
Headers: `X-Device-Id` (required), `Idempotency-Key` (required, 8–128 chars `A-Za-z0-9_-:.`).
Body: `{ "operations": [ { "opId": string(8-128), "type": "entity.action", "payload": object } ] }` (1–100 items)
200: `{ "data": { "deviceId", "results": [ { "opId", "status": "applied|duplicate|conflict|rejected|retry", "seq?", "entityId?", "code?", "message?", "details?" } ] } }`
Errors: 400 `VALIDATION_ERROR`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID`; 409 `REQUEST_IN_PROGRESS`; 413 `BATCH_TOO_LARGE`; 422 `IDEMPOTENCY_KEY_REUSED`.

### GET `/sync/changes?cursor=0&limit=200`
200: `{ "data": { "events": [ { "seq", "entity", "entityId", "op", "data", "branchId", "at" } ], "nextCursor": number, "hasMore": boolean } }`
`limit` 1–500. 400 `VALIDATION_ERROR` if cursor is not a non-negative integer.

## For module developers (Node)
```js
import { idempotentRoute, expectedVersion, assertVersion, versionConflict,
         registerSyncHandler, registerReadinessCheck } from '../reliability/index.js';
```
| Helper | Use |
|---|---|
| `idempotentRoute({ required, ttlMs })` | Route middleware, retry-safe POST/PUT/PATCH/DELETE |
| `expectedVersion(req)` | Reads `If-Match`; 428 if missing, 400 if invalid |
| `assertVersion(expected, current)` | Throws 409 `VERSION_CONFLICT` |
| `versionConflict()` | Error to throw when `UPDATE … WHERE version = $n` changed 0 rows |
| `registerSyncHandler(type, async (op, {deviceId,user}) => ({ entityId, data }))` | Make an operation work offline |
| `registerReadinessCheck(name, async () => {})` | Add a dependency check to `/health/ready` (throw = unhealthy) |
