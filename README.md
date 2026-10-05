# Restaurant POS: Restaurant Management System

A modular Point-of-Sale system for restaurants, built by a team of five interns. It covers the whole operational flow: tables and orders, kitchen (KOT/KDS), billing and payments, inventory, customers, security, dashboards, reports, and the architecture that ties it together.

```
Customer → Table/Order → POS → KOT → Kitchen → Preparation → Serving
        → Billing → Payment → Inventory → Reporting
(with separate Takeaway and Delivery flows)
```

The system is designed to grow from **one POS terminal → multiple terminals → one branch → multiple branches** without a major redesign.

---

## Table of contents

1. [Team and ownership](#1-team-and-ownership)
2. [Tech stack](#2-tech-stack)
3. [Architecture](#3-architecture)
4. [Repository structure](#4-repository-structure)
5. [Getting started](#5-getting-started)
6. [Environment variables](#6-environment-variables)
7. [Scripts](#7-scripts)
8. [Module guide](#8-module-guide)
9. [API standards](#9-api-standards)
10. [Roles and permissions](#10-roles-and-permissions)
11. [Core state models](#11-core-state-models)
12. [Offline mode, sync and idempotency](#12-offline-mode-sync-and-idempotency)
13. [Non-functional requirements](#13-non-functional-requirements)
14. [Git workflow](#14-git-workflow)
15. [Definition of done](#15-definition-of-done)
16. [Testing](#16-testing)
17. [Troubleshooting](#17-troubleshooting)
18. [Roadmap](#18-roadmap)
19. [License](#19-license)

---

## 1. Team and ownership

| # | Role | Owns | Docs folder |
|---|---|---|---|
| 1 | **Order and Front-of-House Operations Lead** | Tables, menu, modifiers, orders, order lifecycle, KOT, kitchen/KDS, dine-in, takeaway, delivery | `docs/01-orders-front-of-house/` |
| 2 | **Billing, Payment and Financial Operations Lead** | Billing, split/merge bills, payments, reconciliation, discounts, tax, refunds, shifts, cash drawer | `docs/02-billing-payments/` |
| 3 | **Inventory, Recipe and Customer Operations Lead** | Inventory, stock, recipe/BOM, wastage, menu availability, customers, loyalty, reservations, notifications | `docs/03-inventory-customers/` |
| 4 | **Security, RBAC, Dashboard and Analytics Lead** | Users, login/PIN, roles and permissions, approvals, audit log, per-role dashboards, reports | `docs/04-security-rbac-analytics/` |
| 5 | **Architecture, Integration and Reliability Lead** | Architecture, scalability, API standard, offline/sync, idempotency, concurrency, integrations, hardware, NFRs, backup and recovery | `docs/05-architecture/` |

Each lead owns their module end to end: workflow, business rules, database entities, APIs, edge cases and acceptance criteria. Cross-module changes need review from every owner affected.

### Who depends on whom

| Needs from | Orders (1) | Billing (2) | Inventory (3) | Security (4) | Architecture (5) |
|---|---|---|---|---|---|
| **Orders (1)** | — | order totals, status | menu items, availability | permissions, audit | API standard, events |
| **Billing (2)** | closed/served orders | — | — | discount/refund limits, approvals | idempotency, reconciliation design |
| **Inventory (3)** | sold items, order events | — | — | permissions, audit | events, sync |
| **Security (4)** | action events | payment/discount events | adjustment events | — | auth tokens, API standard |
| **Architecture (5)** | all module APIs | all module APIs | all module APIs | auth design | — |

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend (POS, KDS, dashboards) | **React + Vite**, **Tailwind CSS** | Large community and plenty of tutorials. Works well on touchscreens, and one codebase covers the POS, kitchen screen and admin dashboards. |
| Backend | **Node.js + Express** (or **NestJS** if the team wants more structure) | Same language as the frontend, so interns can help each other. NestJS has built-in modules and guards, which suit RBAC and the module split. |
| Database | **PostgreSQL** with **Prisma** | Restaurant data is relational (orders, bills, payments, stock) and needs transactions to avoid duplicate payments. Prisma gives readable schemas and migrations. |
| Real-time | **WebSockets (Socket.IO)** | KOT to the kitchen screen and live table status. |
| Offline | **PWA + IndexedDB**, with a sync queue | Local-first order entry that syncs when the connection returns. A local branch server can come later. |
| Auth | **JWT or opaque tokens** + **bcrypt / argon2** | Standard and well understood. Passwords and PINs are always hashed. |
| API docs | **OpenAPI / Swagger** | One place for the common API standard and every module's endpoints. |
| Optional | **Redis** (cache, rate limiting), **Docker Compose** | Docker makes everyone's setup identical. Add Redis only when needed. |

---

## 3. Architecture

```
┌───────────────────────────────┐
│          CLIENT LAYER         │
│   POS  |  KDS  |  Dashboards  │   React + Vite (PWA)
└──────────────┬────────────────┘
               ↓
┌───────────────────────────────┐
│    EDGE / LOCAL (planned)     │
│  Offline cache + Sync queue   │   IndexedDB, retry, conflict handling
└──────────────┬────────────────┘
               ↓
┌───────────────────────────────┐
│         BACKEND API           │
│  Express modules + Socket.IO  │   REST /api/v1 + real-time events
└──────────────┬────────────────┘
               ↓
┌───────────────────────────────┐
│          DATA LAYER           │
│   PostgreSQL (Prisma)         │
│   Redis (optional)            │
└───────────────────────────────┘
```

**Modular monolith first.** One backend, one folder per module. Modules talk through service functions and events, never by reading each other's tables directly, so they can be split into separate services later.

**Multi-branch from day one.** Most tables carry a `branchId`. Restaurants, branches, terminals and users are first-class records.

---

## 4. Repository structure

```
restaurant-pos/
├── README.md
├── CONTRIBUTING.md
├── docker-compose.yml
├── .github/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── CODEOWNERS
├── docs/
│   ├── 00-overview/              # requirements PDF, glossary, assumptions
│   ├── 01-orders-front-of-house/
│   ├── 02-billing-payments/
│   ├── 03-inventory-customers/
│   ├── 04-security-rbac-analytics/
│   └── 05-architecture/
├── server/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.js
│   ├── src/
│   │   ├── app.js
│   │   ├── server.js
│   │   ├── config/
│   │   ├── middleware/           # authenticate, requirePermission, idempotency, errorHandler
│   │   ├── realtime/             # Socket.IO setup and events
│   │   ├── openapi/              # Swagger spec
│   │   └── modules/
│   │       ├── auth/  users/  rbac/  audit/  reports/      # Intern 4
│   │       ├── tables/  menu/  orders/  kot/               # Intern 1
│   │       ├── bills/  payments/  refunds/  shifts/        # Intern 2
│   │       └── inventory/  customers/  notifications/      # Intern 3
│   └── tests/
└── client/
    ├── public/                   # PWA manifest, icons
    └── src/
        ├── app/                  # routing, providers
        ├── features/             # pos, kds, tables, billing, inventory, admin
        ├── pages/dashboards/     # owner, manager, cashier, waiter, kitchen, inventory, admin
        ├── components/
        ├── offline/              # IndexedDB, sync queue
        └── services/             # API client, socket client
```

Each module folder holds its own `routes`, `controller`, `service` and `validation` files.

---

## 5. Getting started

### Prerequisites

- **Node.js 20 LTS or newer** (`node --version`)
- **npm**
- **Docker Desktop** (for PostgreSQL), or a local PostgreSQL 15+
- **Git**

### Setup

```bash
# 1. Clone and install
git clone <repository-url>
cd restaurant-pos
cd server && npm install
cd ../client && npm install
cd ..

# 2. Start the database (and Redis if you use it)
docker compose up -d db

# 3. Configure environment
cp server/.env.example server/.env
cp client/.env.example client/.env

# 4. Create tables and seed data
cd server
npx prisma migrate dev
npm run seed

# 5. Run (two terminals)
cd server && npm run dev      # API    → http://localhost:3000
cd client && npm run dev      # App    → http://localhost:5173
```

The seed creates one branch, the standard roles, the permission matrix and demo users (`owner`, `manager`, `cashier`, `waiter`, `kitchen`, `inventory`, `admin`). The demo password is in `server/prisma/seed.js`. **Demo credentials are for development only.**

API documentation: `http://localhost:3000/api/docs` *(once Swagger is set up)*.

---

## 6. Environment variables

**`server/.env`**

| Variable | Example | Purpose |
|---|---|---|
| `PORT` | `3000` | API port |
| `DATABASE_URL` | `postgresql://pos:pos@localhost:5432/pos` | PostgreSQL connection |
| `JWT_SECRET` | *(long random string)* | Signs access tokens |
| `JWT_EXPIRES_IN` | `15m` | Access token lifetime |
| `SESSION_IDLE_MINUTES` | `30` | Idle timeout |
| `MAX_FAILED_ATTEMPTS` | `5` | Failed logins before lockout |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend origin |
| `REDIS_URL` | `redis://localhost:6379` | Optional cache and rate limiting |
| `NODE_ENV` | `development` | Environment |

**`client/.env`**

| Variable | Example | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000/api/v1` | Backend base URL |
| `VITE_SOCKET_URL` | `http://localhost:3000` | Socket.IO server |

Never commit `.env` files. Commit only `.env.example` with placeholder values.

---

## 7. Scripts

| Where | Command | Purpose |
|---|---|---|
| `server` | `npm run dev` | API with auto-reload |
| `server` | `npm start` | API in production mode |
| `server` | `npm test` | Backend tests |
| `server` | `npx prisma migrate dev` | Apply schema changes locally |
| `server` | `npx prisma studio` | Browse the database |
| `server` | `npm run seed` | Load roles, permissions and demo data |
| `client` | `npm run dev` | Frontend dev server |
| `client` | `npm run build` | Production build |
| `client` | `npm run lint` | Lint the code |
| `client` | `npm test` | Frontend tests |

---

## 8. Module guide

### Intern 1: Orders and front of house

- **Tables:** create, number, floor/section, availability, assignment, transfer, merge, block, release.
- **Menu:** categories, items, price, tax category, availability, description, image, preparation time, branch and time-based availability (for example Breakfast 07:00–11:00).
- **Modifiers:** extras, removals, spice level, combo upgrades, extra price, quantity, selection limits.
- **Orders:** create, add/remove items, quantity, modifiers, notes, modify, cancel, reopen, history, status.
- **KOT and kitchen:** KOT creation and status, priority, kitchen stations (Main Kitchen, Grill, Bakery, Beverage, Dessert), KDS integration.
- **Workflows:** dine-in, takeaway, delivery (including how payment, delivery and order status interact).
- **Edge cases:** wrong order, modification after KOT, item becomes unavailable, table transfer/merge, partial serving, cancellation, kitchen delay, KOT failure.

### Intern 2: Billing, payments and finance

- **Billing:** bill generation, subtotal, tax, discount, final amount, invoice, receipt, reprint, bill status.
- **Split and merge:** by item, equal split, partial payment, merge eligible orders into one bill.
- **Payments:** cash, card, UPI, wallet, bank transfer, online, mixed. Tracks payment ID, bill ID, amount, method, reference, status, timestamp and user.
- **Reconciliation:** POS payment record versus actual provider settlement. When confirmation is lost, verify the transaction instead of creating a second payment.
- **Discounts and tax:** percentage/fixed, item/order level, coupons, manager approval, configurable tax rates, categories, branch tax, exemptions.
- **Refunds:** request → eligibility → authorization → provider → confirmation → audit.
- **Shifts and cash drawer:** opening cash, sales, refunds, additions/removals, expected versus actual cash, variance, manager review.
- **Edge cases:** payment succeeded but POS not updated, duplicate payment, failed/pending/partial payment, refund failure, duplicate refund, cash mismatch, paid-bill modification, reconciliation mismatch.

### Intern 3: Inventory, recipes and customers

- **Inventory:** every sale consumes ingredients through the recipe/BOM (sale → menu item → recipe → ingredients → stock update).
- **Stock:** received, consumed, adjusted, transferred, counted, low stock, availability.
- **Wastage:** ingredient, quantity, reason, user, timestamp, branch, approval. Kept separate from sales.
- **Menu availability:** driven by stock, time, branch, day, kitchen capacity or a temporary decision. Connects to Intern 1's menu.
- **Customers and loyalty:** profile, contact, order history, preferences, identification, loyalty.
- **Reservations:** date/time, guest count, table assignment, status, cancellation, no-show.
- **Notifications:** low stock, item unavailable, reservation reminder.
- **Edge cases:** ingredient unavailable after order, negative stock, wrong or changed recipe, wastage correction, stock adjustment, item sold while unavailable, reservation conflict.

### Intern 4: Security, RBAC, dashboards and analytics

- **Users:** login/logout, PIN, creation, deactivation, login activity, sessions, access restriction.
- **RBAC:** master permission matrix for Owner, Manager, Cashier, Waiter, Kitchen, Inventory, Admin. Permissions are configurable per restaurant, with scopes and limits. Manager approval for over-limit actions.
- **Dashboards:** a separate dashboard per role (see [section 10](#10-roles-and-permissions)).
- **Audit trail:** who, what, when, transaction, old value, new value, reason. Append-only.
- **Reports:** sales, payments, orders, staff, inventory and management reports.
- **Edge cases:** repeated wrong PIN, deactivation during an active session, role change mid-session, approver unavailable, cross-branch access, last admin removed, audit tampering.

### Intern 5: Architecture, integration and reliability

- **Architecture:** layers, modules, event flow, scalability plan from one terminal to many branches.
- **API standard:** naming, auth, request/response and error formats, status codes, versioning, idempotency.
- **Offline and sync:** what works offline, local storage, sync queue, retry, conflict resolution, duplicate prevention, recovery.
- **Concurrency:** for example two waiters editing the same table.
- **Integrations:** card terminals, UPI, gateways, wallets, KDS, KOT/receipt printers, barcode scanner, cash drawer, customer display, scale, accounting/CRM/loyalty, delivery platforms, SMS/email/WhatsApp. All with failure handling and retries.
- **Hardware and network:** terminals, printers, routers, backup internet, UPS.
- **NFRs, backup and recovery, deployment.**

---

## 9. API standards

*(Owned by Intern 5. Every module follows these.)*

- **Base path:** `/api/v1/<module>`:
  `/auth` `/users` `/roles` `/branches` `/tables` `/menu` `/orders` `/kot` `/bills` `/payments` `/refunds` `/shifts` `/inventory` `/customers` `/reservations` `/audit-logs` `/dashboards` `/reports`
- **Format:** JSON.
- **Auth:** `Authorization: Bearer <token>` on every endpoint except login.
- **Success:** `{ "data": ... }`
- **Error:** `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": ... } }`
- **Status codes:** `200/201` success, `400` validation, `401` not logged in, `403` not allowed, `404` not found, `409` conflict, `423` locked.
- **Idempotency:** `POST` requests that create orders, payments or refunds accept an `Idempotency-Key` header. A repeated key returns the original result and never creates a duplicate.
- **Permissions:** protected routes use `requirePermission('module.action')`, for example `requirePermission('refunds.process')`.
- **Audit:** state-changing actions write an audit record.
- **Pagination:** list endpoints accept `limit` and `offset`.
- **Naming:** plural nouns for resources, `kebab-case` for multi-word paths, `camelCase` for JSON fields.
- **Versioning:** breaking changes go to a new version (`/api/v2`).

Interactive docs live at `/api/docs` once the OpenAPI spec is in place. Each module adds its endpoints to `server/src/openapi/`.

---

## 10. Roles and permissions

Roles: **Owner, Manager, Cashier, Waiter, Kitchen, Inventory, Admin.**

Permissions use `module.action` codes, for example `orders.create`, `orders.modify`, `kot.send`, `payments.process`, `discounts.apply`, `refunds.process`, `menu.manage`, `inventory.manage`, `reports.view`, `users.manage`, `audit.view`. Each role-permission link has a **scope** (`own`, `branch`, `all`) and an optional **limit** (such as maximum discount %).

Baseline from the requirements (✓ full, L limited, – none; "limited" is defined precisely in `docs/04-security-rbac-analytics/rbac-matrix.md`):

| Function | Owner | Manager | Cashier | Waiter | Kitchen | Inventory | Admin |
|---|---|---|---|---|---|---|---|
| View sales | ✓ | ✓ | L | – | – | L | ✓ |
| Create order | ✓ | ✓ | ✓ | ✓ | – | – | ✓ |
| Modify order | ✓ | ✓ | L | ✓ | – | – | ✓ |
| Send KOT | ✓ | ✓ | ✓ | ✓ | – | – | ✓ |
| Process payment | ✓ | ✓ | ✓ | L | – | – | ✓ |
| Apply discount | ✓ | ✓ | L | L | – | – | ✓ |
| Refund | ✓ | ✓ | L | – | – | – | ✓ |
| Manage menu | ✓ | ✓ | – | – | – | – | ✓ |
| Manage inventory | ✓ | ✓ | – | – | – | ✓ | ✓ |
| View reports | ✓ | ✓ | L | L | L | ✓ | ✓ |
| User management | L | L | – | – | – | – | ✓ |

Actions above a user's limit (large discounts, refunds) need a **single-use manager approval**, recorded in the audit log. Permissions are enforced **on the server**, never only in the UI.

### Dashboards by role

| Role | Main widgets |
|---|---|
| Owner | Total sales, revenue, branch performance, trends, inventory overview, staff activity |
| Manager | Active orders, pending KOT, discounts, refunds, staff activity, shift status, daily sales, alerts |
| Cashier | Active bills, payments, refunds, cash drawer, shift, payment failures |
| Waiter | Tables and status, active orders, KOT status, order history, customer info |
| Kitchen | Active KOT, priority, preparing, ready, delayed orders, station-wise orders |
| Inventory | Current and low stock, consumption, wastage, ingredient usage, adjustments |
| Admin | Users, roles, permissions, system configuration, audit, branch configuration |

---

## 11. Core state models

### Order lifecycle (Intern 1)

```
Created → Confirmed → KOT Sent → Preparing → Ready → Served → Billed → Paid → Closed
```

Alternative states: `Cancelled`, `Rejected`, `Modified`, `Partially Served`, `Refunded`.
State changes are never silently overwritten. Important state history is kept.

### Table states (Intern 1)

`Available` · `Reserved` · `Occupied` · `Ordering` · `Preparing` · `Waiting for Payment` · `Payment Completed` · `Cleaning` · `Blocked`

### Payment flow (Intern 2)

```
Initiated → Processing → Success / Failure / Pending → POS record → Provider settlement → Reconciliation
```

### Refund flow (Intern 2)

```
Request → Original transaction → Eligibility → Authorization → Initiated → Provider → Confirmed → Audit log
```

### Shift flow (Intern 2)

```
Open → Transactions → Cash collection → Close → Expected vs actual → Variance → Manager review → Closed
```

### Inventory flow (Intern 3)

```
Sale → Menu item → Recipe/BOM → Ingredients → Stock consumption → Inventory update
```

### Takeaway and delivery

```
Takeaway: Customer → POS order → KOT → Kitchen → Ready → Payment → Handover → Closed
Delivery: Online/Phone/Platform → POS → KOT → Kitchen → Ready → Assignment → Dispatched → Delivered → Settlement → Closed
```

---

## 12. Offline mode, sync and idempotency

*(Owned by Intern 5.)*

1. Every transaction is saved locally first (IndexedDB).
2. If online, it is sent to the server right away. If offline, it waits in the **sync queue** and retries when the connection returns.
3. The UI shows the sync status of each record.
4. The server uses **idempotency keys**, so a retried request never creates a duplicate order, payment or refund.
5. Conflicts (for example two waiters editing Table 12) are handled by documented rules, with optimistic locking on shared records.
6. After a crash or power loss, the app recovers from the local store and resumes syncing.

---

## 13. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | Fast order creation, KOT, billing and payment, even at peak hours |
| Availability | High availability during operating hours |
| Reliability | No duplicate transactions, data corruption, inconsistent payment records or lost orders |
| Scalability | Single POS → multiple POS → multiple branches |
| Maintainability | Modular components with clear boundaries |
| Usability | Quick order entry, minimal clicks, clear statuses, readable bills, touchscreen support |
| Security | Authentication, authorization, RBAC, sessions, audit, secure API communication |
| Backup and recovery | Automated backups, transaction recovery, database recovery, data restoration |

Every intern adds module-specific NFRs to their docs folder. Intern 5 maintains the master NFR document.

---

## 14. Git workflow

- `main` is protected. **No direct pushes.** All changes go through pull requests.
- **Branch names:** `intern<N>/<short-description>`, for example `intern2/split-bill-workflow`.
- **Commit messages:** short, present tense, for example `Add PIN lockout after 5 failed attempts`. Optional prefixes: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`.
- **Reviews:** at least one reviewer per PR. Changes to `schema.prisma`, the API standard or permission codes also need review from Intern 5 (and Intern 4 for permissions).
- **Stay in sync:**

```bash
git checkout main && git pull
git checkout intern4/my-branch
git merge main
```

- **Issues:** use GitHub Issues for tasks and questions. Labels: `intern-1` … `intern-5`, `cross-module`, `blocked`, `bug`, `docs`.
- **Never commit:** `.env` files, secrets, `node_modules/`, database files.
- **Schema changes:** one person at a time edits `schema.prisma`. Announce it first, keep migrations small, and pull before creating a migration.

### Pull request checklist

- [ ] Branch is up to date with `main`
- [ ] Tests added or updated, and `npm test` passes
- [ ] No secrets or `.env` files
- [ ] New endpoints are in the OpenAPI spec and use `requirePermission`
- [ ] State-changing actions write audit records
- [ ] Docs updated (workflow, business rules, edge cases)

---

## 15. Definition of done

A feature is done when:

1. The workflow and business rules are documented in the owner's docs folder.
2. Database entities exist in Prisma with a migration.
3. APIs follow the standard and are documented in OpenAPI.
4. Permission checks and audit logging are in place.
5. Edge cases from the requirements are handled and tested.
6. Acceptance criteria are written and pass.
7. It has been reviewed by another team member.

### Deliverables per intern

| Intern | Deliverables |
|---|---|
| 1 | Table, menu, order, KOT, kitchen, dine-in, takeaway, delivery workflows; order lifecycle diagram; business rules; DB entities; Order/KOT APIs; edge cases; acceptance criteria |
| 2 | Billing, split/merge, payment lifecycle, reconciliation, discount, tax, refund, shift and cash drawer workflows; financial DB entities; billing/payment APIs; edge cases; acceptance criteria |
| 3 | Inventory workflow, recipe/BOM model, stock lifecycle, consumption flow, wastage workflow, menu availability rules, customer model, reservations, loyalty; DB entities; APIs; edge cases; acceptance criteria |
| 4 | User management, RBAC matrix, dashboards, authentication flow, authorization rules, audit-log design, security requirements, sales/payment/staff/inventory/management reports; DB entities; APIs; edge cases; acceptance criteria |
| 5 | Overall architecture, scalability plan, edge/cloud architecture, API and event architecture, offline and sync design, idempotency, concurrency, integrations, hardware and network requirements, NFR master document, backup/recovery, deployment, system-level edge cases and acceptance criteria |

---

## 16. Testing

- **Backend:** unit tests for services; API tests for routes (permissions, validation, idempotency).
- **Frontend:** component tests for key flows (login, order entry, payment).
- **Required scenarios:** each module's edge cases, such as duplicate payments, paid-bill modification, failed KOT, negative stock, account lockout and over-limit discounts.
- Run `npm test` in `server` and `client` before opening a PR.

---

## 17. Troubleshooting

| Problem | Try this |
|---|---|
| `Can't reach database server` | Check Docker is running (`docker compose ps`) and `DATABASE_URL` in `server/.env` |
| Port already in use | Change `PORT` in `.env`, or stop the other process |
| Prisma client out of date | Run `npx prisma generate` |
| Migration conflict after pulling | Pull `main`, then run `npx prisma migrate dev`. If two people changed the schema, coordinate before merging |
| CORS error in the browser | Make sure `CORS_ORIGIN` matches the frontend URL |
| `401` on every request | Token missing or expired; log in again |
| `403` on an action | The role lacks that permission; check the RBAC matrix |
| Reset local database | `npx prisma migrate reset` (deletes all local data) |

---

## 18. Roadmap

- [ ] Repository setup, Docker Compose, Prisma baseline, CI
- [ ] Auth, users, RBAC, audit
- [ ] Tables, menu, orders, KOT, kitchen screen
- [ ] Billing, payments, refunds, shifts
- [ ] Inventory, recipes, customers, reservations
- [ ] Per-role dashboards and reports
- [ ] Offline mode, sync queue, idempotency
- [ ] Integrations: printers, payment gateways, delivery platforms
- [ ] Multi-branch support
- [ ] Deployment, backups, monitoring

---

## 19. License

To be decided by the team. Add a `LICENSE` file to the repository root.
