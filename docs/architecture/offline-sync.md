# Offline Support & Synchronisation

## Principle
A terminal never blocks the waiter because the network is slow. It saves each action in a local queue and sends it when possible. The server guarantees each action is applied once.

## Client side (frontend responsibility)
1. Give each action a client-generated `opId` (UUID) and keep them in order in IndexedDB/localStorage.
2. Show an "Offline – n pending" badge when the queue is not empty.
3. When online, send the queue in order (max 100 per request) to `POST /api/v1/sync/push`.
4. Remove an operation from the queue when its result is `applied`, `duplicate`, `conflict` or `rejected`. Keep it and retry later when the result is `retry` or the request failed.
5. After pushing, call `GET /api/v1/sync/changes?cursor=<last cursor>` and merge the events into local data. Save `nextCursor`.

## Server side (this module)
`POST /api/v1/sync/push`
```http
Authorization: Bearer <token>
X-Device-Id: tablet-1
Idempotency-Key: <uuid for this request>
{ "operations": [ { "opId": "…uuid…", "type": "order.create", "payload": { } } ] }
```
Response `data.results[]` – one per operation:

| status | Meaning | Client action |
|---|---|---|
| `applied` | Done, `seq` = change number | Drop from queue |
| `duplicate` | Already applied before | Drop from queue |
| `conflict` | Someone changed the record (`details.current`) | Show to user, reload |
| `rejected` | Invalid or unknown type (`code`, `message`) | Show error, drop |
| `retry` | Temporary server failure | Keep and retry the same `opId` |

`GET /api/v1/sync/changes?cursor=0&limit=200` returns `{ events: [{ seq, entity, entityId, op, data, branchId, at }], nextCursor, hasMore }`. Events for the user's branch (and global events) only.

## How other modules plug in
```js
import { registerSyncHandler } from '../reliability/index.js';
registerSyncHandler('order.create', async (op, { deviceId, user }) => {
  const order = await ordersService.create(op.payload, user);   // may throw HttpError
  return { entityId: order.id, data: order };
});
```
Throw `HttpError(409, ...)` for a conflict, any other `HttpError` (<500) for a rejection. Any other error is treated as temporary (`retry`).

## Conflict rules
| Data | Rule |
|---|---|
| Orders / tables | Version check; conflict is shown to the user |
| Payments | Never merged; the idempotency key makes sure it happens once |
| Menu / prices | Server value wins |
| Stock | Server applies as deltas, never absolute numbers |

## Limits and retention
Batch ≤ 100 ops, pull page ≤ 500 events, change log and processed-op records kept 30 days (`reliability_cleanup()`), idempotency answers 24 h. A device offline longer than 30 days must do a full reload.

## Tables
`sync_changes`, `sync_ops`, `devices` in `database/migrations/002_reliability.sql`.
