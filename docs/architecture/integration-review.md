# Integration review: all modules against the work plan

Reviewed: Security (Intern 4), Orders (Intern 1, Python), Billing (Intern 2, TypeScript), Reliability (Intern 5, JavaScript).
Inventory and customers (Intern 3) are not in the repository yet.

## How the modules were found to fit together

```
Browser / React ──Bearer token──► Security + Billing + Reliability (Node, :3000, /api/v1)
                └─ /orders-api ─► Orders (Python, :8000, /api/v1)   asks Security "who is this token?"
Billing ──(same token)──► Orders   reads the served order, sets billed / paid / closed
Orders ──(service key)──► Security  audit events (order status history)
```

## What was verified by running it

| Check | Result |
|---|---|
| Billing unit tests (19 existing) | pass |
| Billing new unit tests (split payments, equal split, wallet/bank, cash drawer, shift review) | 11 pass |
| Billing router integration tests (login, permission, branch scope, limits, cash drawer, order sync, audit) | 13 pass |
| Type check of billing with the repo's strict tsconfig | clean |
| Whole Node app boots; billing, cash-shifts, reliability and security routes are mounted and protected | yes |
| Orders to Security bridge logic (token to user, permission rules, approvals, audit mapping) | pass |
| Python syntax of the whole orders module | clean |

Not run here (no database, no packages, no network): PostgreSQL and Prisma migrations, the security smoke test, the
orders module's own 33 tests, the React app, the reliability tests. Run them on your machine; see "How to verify".

## Findings and what was done

| # | Severity | Module | Finding | Status |
|---|---|---|---|---|
| 1 | Critical | Orders | Login was two headers anyone can type (`X-User-Role: admin`); manager approval accepted any text | Fixed: `AUTH_MODE=security` checks the real token; approvals are real, single-use, bound to the order |
| 2 | Critical | Orders | No permission checks: any caller could create tables, edit the menu, cancel orders | Fixed: one rule table in `app/deps.py` applied to every endpoint (security mode) |
| 3 | Critical | Billing | Not mounted: `npm run dev` ran `server.js`, which never loaded the billing code (`app.ts` was a second, separate server) | Fixed: mounted at `/api/v1/billing` and `/api/v1/cash-shifts`; `app.ts` and `server.ts` deleted; `npm run dev/start` use `tsx` |
| 4 | Critical | Billing | No login, no permission, no audit; cashier id and prices were taken from the request body | Fixed: identity from the token, bill built from the real order, audit written |
| 5 | High | Billing | Discount limit and refund limit not enforced; no manager approval | Fixed: uses the security module's limits and approvals |
| 6 | High | Billing / Security | Unit mismatch: billing works in paise, role refund limits are in rupees | Fixed: `/refunds/check` accepts `amountPaise` and converts |
| 7 | High | Billing | Cash payments never reached the cash drawer, so expected cash and variance were wrong | Fixed: cash sales and cash refunds update the open shift; cash needs an open shift |
| 8 | High | Billing / Orders | Billing never told Orders the order was billed / paid / closed (Orders waits for it) | Fixed: `orderSync` result on bill and payment responses; failure does not undo a payment |
| 9 | High | Billing | Split bills could not be paid per split; `amountPaidPaise` of a split never changed | Fixed: `splitId` on payments, equal split added |
| 10 | High | Billing | Wallet and bank transfer missing (work plan lists them) | Fixed (+ migration `003`) |
| 11 | High | Security | Kitchen, tables, delivery, shifts had no permission codes (kitchen had none at all) | Fixed: 6 new codes with default grants; `npm run seed` tops up existing databases |
| 12 | High | Orders to Security | Audit log never received order events | Fixed: `app/audit_forwarder.py` + `POST /audit-logs/ingest` (service key) |
| 13 | Medium | Shift | A shift closing with a cash difference needed no review (plan says manager review) | Fixed: `reviewStatus` + `/cash-shifts/:id/review` |
| 14 | Medium | All | Three JSON styles: Billing camelCase and string ids, Security camelCase and int ids, Orders snake_case and int ids | Handled in Billing's `orders-client.ts`; the React frontend must map Orders' snake_case |
| 15 | Medium | CI | Billing tests were `continue-on-error`; no Python tests; typecheck not run | Fixed in `ci.yml` |
| 16 | Medium | Frontend | No pages for orders, kitchen, billing, inventory (security pages only); Orders has its own demo UI | Open |
| 17 | Medium | Reliability | Sync endpoint has no registered handlers, so offline sync does nothing yet | Open (Intern 5 with Interns 1 and 2) |

## Still open (not fixable by review alone)

1. **Billing data is in memory.** Bills, payments, refunds and shifts are lost when the server restarts. `001_billing.sql` exists
   and `pool.ts` exists, but the service never writes to PostgreSQL. Intern 2 needs a repository class per table.
2. **Merge bills** (several orders on one bill) is not built; one bill per order only.
3. **Payment reconciliation** (POS record vs provider settlement) and **duplicate payment from lost confirmation** have no code yet.
4. **Scope `own` in Orders**: a waiter's "modify own orders" is not enforced (needs `created_by` comparison); branch scope is not
   checked on order creation in Orders. Security mode only checks the permission, not the scope, on Orders endpoints.
5. **Inventory** (Intern 3): recipes, stock consumption on sale, menu availability from stock. Hooks already exist: permission
   `inventory.manage`, Orders' availability endpoints, and the audit events `INVENTORY_ADJUSTED`, `WASTAGE_RECORDED`.
6. **Frontend screens** for orders, KDS, billing and shifts.
7. Dashboard widgets and reports for sales, payments, orders and inventory stay "waiting for module" until the owners publish data.

## How to verify on your machine

```bash
# Node side
cd backend && npm ci && npm run test:reliability && npm run test:billing && npm run typecheck
cp .env.example .env        # set INTEGRATION_API_KEY, ORDERS_API_URL
npx prisma migrate dev --name security_init && npm run db:triggers && npm run seed   # seed again after this update
npm run dev                  # in a second terminal: npm run smoke

# Python side
cd backend/orders-module && python -m pytest -q
AUTH_MODE=security AUDIT_FORWARD=1 INTEGRATION_API_KEY=<same key> python -m uvicorn app.main:app --port 8000
```

End-to-end by hand: log in as `waiter` (security), create an order in Orders with that token, confirm, kitchen marks served,
log in as `cashier`, open a shift, `POST /billing/from-order/<id>` (header `Idempotency-Key`), pay, and watch the order become
paid and closed and every step appear in `GET /audit-logs`.
