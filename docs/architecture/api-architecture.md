# API Architecture Standard

All modules follow these rules so the frontend can treat the whole system as one API.

## URLs and versions
- Base path: `/api/v1`. Resource names are plural nouns in kebab-case: `/orders`, `/cash-shifts`.
- Breaking change = new version (`/api/v2`); the old one stays for one release.
- Billing is currently mounted at `/api/billing` and `/api/cash-shifts` in `src/app.ts`; when merged into `src/routes/index.js` it must move to `/api/v1/billing` and `/api/v1/cash-shifts`.

## Success and error shape
```json
{ "data": { } }
{ "error": { "code": "VERSION_CONFLICT", "message": "Order was changed by someone else.", "details": { } } }
```
- Field names are camelCase in JSON (team standard).
- Errors use the shared handler `middleware/errorHandler.js`; throw `HttpError(status, code, message, details)`.
- `code` is UPPER_SNAKE_CASE and stable (clients switch on it, not on `message`).

## Standard status codes
| Status | Use |
|---|---|
| 200 / 201 | OK / created |
| 400 | Validation error, missing header |
| 401 / 403 | Not logged in / no permission |
| 404 | Not found |
| 409 | `VERSION_CONFLICT`, `REQUEST_IN_PROGRESS`, business conflict |
| 422 | `IDEMPOTENCY_KEY_REUSED` (same key, different body) |
| 428 | `VERSION_REQUIRED` (missing `If-Match`) |
| 503 | Not ready (dependency down) |

## Standard headers
| Header | Direction | Meaning |
|---|---|---|
| `Authorization: Bearer <token>` | request | Session token from `/auth/login` |
| `Idempotency-Key` | request | Required on POST/PUT/PATCH/DELETE that create money, stock or order effects |
| `If-Match: <version>` | request | Required when editing an existing row |
| `X-Device-Id` | request | Terminal id (required for `/sync/push`) |
| `Idempotent-Replayed: true` | response | This is a stored answer to a retry |
| `Retry-After` | response | Seconds to wait on 409 `REQUEST_IN_PROGRESS` |

## Pagination and filtering
- Lists accept `limit` (default 50, max 200) and `cursor` (opaque id) – no `OFFSET` on large tables.
- Dates are ISO 8601 UTC (`2026-10-25T09:30:00Z`). Money is integer paise (`totalPaise`).

## Security baseline
- `helmet`, CORS allow-list (`CORS_ORIGIN`), JSON body limit 1 MB, rate limiting on login.
- Every route that changes data must use `guard(PERMISSIONS.X)` from `middleware/authenticate.js`.
- Sensitive actions write an audit record (`audit(req, {...})`).

## Health endpoints (public)
- `GET /api/v1/health/live` – process is up.
- `GET /api/v1/health/ready` – dependencies OK, else 503.
