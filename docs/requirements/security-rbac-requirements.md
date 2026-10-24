# Security, RBAC, Dashboards and Analytics: Requirements

Scope: user management, authentication, authorization, audit, per-role dashboards, reports.
Code constants: `shared/constants/` · Tables: `database/schema/security.sql` · API: `shared/contracts/security-api.md`

## 1. User management

| Capability | Rule |
|---|---|
| Create user | By `users.manage`. Required: name, username, role(s), branch, initial password. Optional: PIN, phone, email. New users must change credentials at first login. |
| Branch | A user belongs to one branch. Manager creates only in own branch; Admin in any. |
| Deactivate | Never delete. Status becomes `inactive`, all sessions end at once, reason required. Blocked if the user is the last active admin. (Also block while a shift or order is open: needs Billing and Orders.) |
| Statuses | `active`, `inactive`, `locked`, `pending` |
| Lockout | 5 failed logins lock the account. A manager or admin unlocks it. |
| Credentials | Password: 8+ chars, letters and digits. PIN: 4-6 digits. Stored hashed (bcrypt or argon2). Reset by manager/admin forces a change at next login. |
| Login activity | Every attempt stored: user, terminal, IP, method, success, reason, time. |
| Sessions | One active session per user (a new login ends the older one). 30 min idle timeout, 12 h maximum. |

## 2. Roles and permissions (RBAC)

Roles: Owner, Manager, Cashier, Waiter, Kitchen, Inventory, Admin. Permissions are configurable per restaurant (stored in the database); the default seed is in `shared/constants/permissions.js`.

Each role-permission link has a **scope** (`own`, `branch`, `all`) and an optional numeric **limit**.

### What "Limited" means (default policy)

| Function | Cashier | Waiter | Inventory |
|---|---|---|---|
| View sales | own shift/user only | none | own only |
| Modify order | own orders, before payment | own orders | none |
| Process payment | full (branch) | own orders only | none |
| Apply discount | up to 10%, more needs approval | up to 5%, more needs approval | none |
| Refund | up to 500, more needs approval | none | none |
| View reports | own figures | own figures | inventory reports (branch) |

Manager limits: discount 30%, refund 5000. Owner and Admin: discount 100%, refund unlimited. Values are defaults for the restaurant owner to change.

### Approvals (manager override)

1. Over-limit action returns `APPROVAL_REQUIRED`.
2. The user creates an approval request with a reason.
3. An approver with `approvals.decide` approves or rejects. Approver cannot be the requester, must be in the same branch (unless scope `all`), and the amount must fit the approver's own limit.
4. An approved request works **once**, for the requester only, for an amount up to the approved value.
5. Every step is audited, and the final record names the approver.

### Safeguards

- Only Owner/Admin can assign the Owner/Admin role.
- Nobody can change their own roles.
- The admin role always keeps `roles.manage`; the last active admin cannot be removed or deactivated.
- Role and permission changes apply on the user's next request (no stale sessions).
- All checks happen on the server. Hiding a button is never enough.

## 3. Security requirements

- Authentication on every endpoint except login; authorization on every protected endpoint.
- HTTPS for all traffic; secure token storage; tokens stored hashed in the database.
- No passwords, PINs or tokens in logs, errors or audit values.
- Rate limiting on login endpoints; generic "invalid credentials" message (no user enumeration).
- Input validation on all requests.
- Immutable audit log (database blocks update and delete).
- No card numbers or full payment credentials stored.

## 4. Audit trail

Fields: who (user, role), where (branch, terminal, IP), when, action, entity type and id, old value, new value, reason, approver.

Events (names in `shared/constants/audit-events.js`): login, logout, failed login, lockout, user create/update/deactivate, role and permission change, order create/modify/cancel, discount, refund, payment modification, menu and price change, inventory adjustment, wastage, shift close, approvals.

Rules: append-only; sensitive actions require a reason; searchable by user, action, entity, date; retention period set by the owner (suggest 1+ years); offline events keep their original timestamp when synced.

## 5. Dashboards (one per role)

| Role | Widgets |
|---|---|
| Owner | Total sales, revenue, branch performance, business trends, inventory overview, staff activity, high-level reports |
| Manager | Active orders, pending KOT, discounts, refunds, staff activity, shift status, daily sales, operational alerts |
| Cashier | Active bills, payments, refunds, cash drawer, shift, payment failures |
| Waiter | Tables and status, active orders, KOT status, order history, customer info |
| Kitchen | Active KOT, priority, preparing, ready, delayed orders, station-wise orders |
| Inventory | Current stock, low stock, consumption, wastage, ingredient usage, stock adjustments |
| Admin | Users, roles, permissions, system configuration, audit, branch configuration |

Rules: a widget shows only if the user holds its permission; data is limited by scope; each widget names its source module.

## 6. Reports

| Group | Reports | Needs data from |
|---|---|---|
| Sales | daily, weekly, monthly, hourly, item-wise, category-wise, branch-wise | Billing, Orders |
| Payment | by method (cash, card, UPI, online), failed, refunds, discrepancies | Billing |
| Orders | total, completed, cancelled, average order value, by type, peak time | Orders |
| Staff | orders handled, sales, discounts, cancellations, refunds | Orders, Billing, Audit |
| Inventory | stock, low stock, consumption, wastage, adjustments | Inventory |
| Management | revenue trends, product performance, customer activity, branch performance, operational efficiency | all |

Each report defines: filters (date range, branch, user, order type), metric formulas, permission, export format. Reports read from a replica or analytics store when available so live POS is not slowed.

## 7. Module NFRs

Login under 2 s; permission check adds negligible time to each request; audit writing never blocks an order or payment (retry on failure, never drop); dashboards load fast at peak hours; works with the offline design (see open questions).

## 8. Open questions for the team

1. **Architecture:** token type (JWT or opaque) and how offline login works (cached credentials, for how long?).
2. **Architecture:** is a user tied to one branch, or can they work in several?
3. **Orders/Billing:** which events must be audited, and their old/new value shape?
4. **Billing:** are discount and refund limits above acceptable for the restaurant?
5. **All:** who initializes the backend `package.json` and Prisma setup, so security code can be added to it?
