# Security API contract

Base path `/api/v1`. JSON, field names in camelCase. `Authorization: Bearer <token>` on everything except login.
Success `{ "data": ... }`. Error `{ "error": { "code", "message", "details" } }`.

## What other modules need from Security

| Need | How |
|---|---|
| Know who is calling | `authenticate` middleware sets `req.user` (`id`, `branchId`, `username`), `req.roles`, `req.permissions` |
| Protect a route | `requirePermission(PERMISSIONS.X)` (codes in `shared/constants/permissions.js`) |
| Respect scope | `req.permissions.get(code).scope` is `own`, `branch` or `all`; filter queries accordingly |
| Respect limits | Before a discount or refund call `POST /discounts/check` or `/refunds/check`; on `403 APPROVAL_REQUIRED` ask for a manager approval and retry with `approvalId` |
| Write an audit record | `audit({ action, entityType, entityId, oldValue, newValue, reason })` with a name from `shared/constants/audit-events.js` |

## Endpoints

| Method | Path | Permission |
|---|---|---|
| POST | `/auth/login` `{username,password,terminalId}` | public |
| POST | `/auth/pin-login` `{username,pin,terminalId}` | public |
| POST | `/auth/logout` | logged in |
| GET | `/auth/me` | logged in |
| POST | `/auth/change-credentials` | logged in |
| GET, POST | `/users` | `users.manage` |
| GET, PATCH | `/users/:id` | `users.manage` |
| POST | `/users/:id/deactivate` `{reason}` | `users.manage` |
| POST | `/users/:id/activate`, `/unlock`, `/reset-credentials` | `users.manage` |
| GET | `/roles`, `/permissions` | logged in |
| POST | `/roles` | `roles.manage` |
| GET, PUT | `/roles/:id/permissions` | `roles.manage` |
| POST | `/approvals` `{action,value,entityId,reason}` | logged in |
| GET | `/approvals?status=pending` | `approvals.decide` |
| POST | `/approvals/:id/decide` `{approve,reason}` | `approvals.decide` |
| POST | `/discounts/check` `{percent,orderId,approvalId?}` | `discounts.apply` |
| POST | `/refunds/check` `{amount,billId,approvalId?}` | `refunds.process` |
| GET | `/audit-logs?userId&action&entityType&entityId&from&to&limit&offset` | `audit.view` |
| GET | `/dashboards/me` | logged in |
| GET | `/reports`, `/reports/:code?from&to` | per report |

## Login response

```json
{ "data": { "token": "...", "expiresAt": "...", "mustChange": false,
  "user": { "id": 1, "name": "...", "username": "...", "branchId": 1 },
  "roles": ["cashier"],
  "permissions": [{ "code": "discounts.apply", "scope": "branch", "limit": 10 }] } }
```

## Error codes

`VALIDATION_ERROR` 400 · `UNAUTHENTICATED`, `SESSION_INVALID`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS` 401 ·
`FORBIDDEN`, `APPROVAL_REQUIRED`, `APPROVAL_INVALID`, `PRIVILEGE_ESCALATION`, `SELF_APPROVAL`, `ACCOUNT_INACTIVE` 403 ·
`NOT_FOUND` 404 · `USERNAME_TAKEN`, `LAST_ADMIN`, `ALREADY_DECIDED` 409 · `ACCOUNT_LOCKED` 423 · `RATE_LIMITED` 429 · `NOT_IMPLEMENTED` 501
