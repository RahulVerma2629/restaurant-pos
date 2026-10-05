# Restaurant POS: Restaurant Management System

A modular Point-of-Sale system for restaurants. It covers the full flow from table and order creation, through the kitchen (KOT/KDS), billing and payment, to inventory, reporting and audit. It is designed to grow from a **single POS terminal** to **multiple terminals** and then **multiple branches** without a major redesign.

```
Customer → Table/Order → POS → KOT → Kitchen → Preparation → Serving
        → Billing → Payment → Inventory → Reporting
(plus separate Takeaway and Delivery flows)
```

> **Status:** early development. This README describes the agreed stack, structure and team rules. Items marked *(planned)* are not built yet.

---

## Table of contents

1. [Features by module](#features-by-module)
2. [Tech stack](#tech-stack)
3. [Architecture](#architecture)
4. [Repository structure](#repository-structure)
5. [Getting started](#getting-started)
6. [Environment variables](#environment-variables)
7. [Available scripts](#available-scripts)
8. [API conventions](#api-conventions)
9. [Roles and permissions](#roles-and-permissions)
10. [Order lifecycle](#order-lifecycle)
11. [Offline mode and sync](#offline-mode-and-sync)
12. [Team and module ownership](#team-and-module-ownership)
13. [Git workflow](#git-workflow)
14. [Testing](#testing)
15. [Documentation](#documentation)
16. [Roadmap](#roadmap)

---

## Features by module

| Module | Owner | Main features |
|---|---|---|
| **Orders and front of house** | Intern 1 | Tables (transfer, merge, block, release), menu and modifiers, order management, order lifecycle, KOT, kitchen display, dine-in / takeaway / delivery workflows |
| **Billing and payments** | Intern 2 | Bills, split and merge bills, payments (cash, card, UPI, wallet, mixed), reconciliation, discounts, tax, refunds, shifts, cash drawer |
| **Inventory and customers** | Intern 3 | Stock, recipes/BOM, wastage, menu availability, customers, loyalty, reservations, notifications |
| **Security and analytics** | Intern 4 | Users, login/PIN, RBAC permission matrix, approvals, audit log, per-role dashboards, reports |
| **Architecture and reliability** | Intern 5 | System architecture, API standard, offline mode and sync, idempotency, concurrency, integrations, hardware, NFRs, backup and recovery |

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend (POS, KDS, dashboards) | **React + Vite**, **Tailwind CSS** | Large community and plenty of tutorials. Works well on touchscreens, and one codebase covers the POS, kitchen screen and admin dashboards. |
| Backend | **Node.js + Express** (or **NestJS** if the team wants more structure) | Same language as the frontend, so interns can help each other. NestJS has built-in modules and guards, which suit RBAC and the module split. |
| Database | **PostgreSQL** with **Prisma** | Restaurant data is relational (orders, bills, payments, stock) and needs transactions to avoid duplicate payments. Prisma gives readable schemas and migrations. |
| Real-time | **WebSockets (Socket.IO)** | KOT to the kitchen screen and live table status. |
| Offline | **PWA + IndexedDB**, with a sync queue | Local-first order entry that syncs when the connection returns. A local branch server can come later. |
| Auth | **JWT or opaque tokens** + **bcrypt / argon2** | Standard, well understood. Passwords and PINs are always hashed. |
| API docs | **OpenAPI / Swagger** | One place for the common API standard and every module's endpoints. |
| Optional | **Redis** (cache, rate limiting), **Docker Compose** | Docker makes everyone's setup identical. Add Redis only when needed. |

---

## Architecture

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
│   PostgreSQL (Prisma)  |      │
│   Redis (optional cache)      │
└───────────────────────────────┘
```

**Modular monolith first.** One backend, one folder per module (`auth`, `users`, `rbac`, `audit`, `tables`, `menu`, `orders`, `kot`, `bills`, `payments`, `inventory`, `customers`, `reports`, `notifications`). Modules talk through services and events, not by reaching into each other's tables, so they can be split into separate services later if needed.

**Growth model:** single POS → multiple POS terminals → single branch → multiple branches. Almost every table carries a `branchId`, and terminals are first-class records.

---

## Repository structure

```
restaurant-pos/
├── README.md
├── CONTRIBUTING.md
├── docker-compose.yml          # PostgreSQL (and optional Redis)
├── .github/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── CODEOWNERS
├── docs/
│   ├── 00-overview/            # requirements PDF, glossary, assumptions
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
│   │   ├── middleware/         # authenticate, requirePermission, idempotency, errorHandler
│   │   ├── realtime/           # Socket.IO setup and events
│   │   ├── modules/
│   │   │   ├── auth/           # Intern 4
│   │   │   ├── users/          # Intern 4
│   │   │   ├── rbac/           # Intern 4
│   │   │   ├── audit/          # Intern 4
│   │   │   ├── reports/        # Intern 4
│   │   │   ├── tables/         # Intern 1
│   │   │   ├── menu/           # Intern 1
│   │   │   ├── orders/         # Intern 1
│   │   │   ├── kot/            # Intern 1
│   │   │   ├── bills/          # Intern 2
│   │   │   ├── payments/       # Intern 2
│   │   │   ├── shifts/         # Intern 2
│   │   │   ├── inventory/      # Intern 3
│   │   │   ├── customers/      # Intern 3
│   │   │   └── notifications/  # Intern 3
│   │   └── openapi/            # Swagger spec
│   └── tests/
└── client/
    ├── public/                 # PWA manifest, icons
    └── src/
        ├── app/                # routing, providers
        ├── features/           # pos, kds, tables, billing, inventory, admin
        ├── pages/dashboards/   # owner, manager, cashier, waiter, kitchen, inventory, admin
        ├── components/
        ├── offline/            # IndexedDB, sync queue
        └── services/           # API client, socket client
```

Each module folder contains its own `routes`, `controller`, `service`, and `validation` files.

---

## Getting started

### Prerequisites

- **Node.js 20 LTS or newer** (`node --version`)
- **npm** (comes with Node)
- **Docker Desktop** (recommended, for PostgreSQL), or a local PostgreSQL 15+
- **Git**

### 1. Clone and install

```bash
git clone <repository-url>
cd restaurant-pos

cd server && npm install
cd ../client && npm install
```

### 2. Start the database

```bash
# from the repository root
docker compose up -d db
```

### 3. Configure environment

```bash
cd server
cp .env.example .env
cd ../client
cp .env.example .env
```

Edit the values if needed (see [Environment variables](#environment-variables)).

### 4. Create tables and seed demo data

```bash
cd server
npx prisma migrate dev
npm run seed
```

The seed creates one branch, the standard roles and the permission matrix, and (outside production) demo users: `owner`, `manager`, `cashier`, `waiter`, `kitchen`, `inventory`, `admin`. Check `seed.js` for the demo password. **Never use demo credentials outside development.**

### 5. Run the apps

```bash
# terminal 1
cd server && npm run dev        # API on http://localhost:3000

# terminal 2
cd client && npm run dev        # App on http://localhost:5173
```

API documentation is served at `http://localhost:3000/api/docs` *(planned)*.

---

## Environment variables

**`server/.env`**

| Variable | Example | Purpose |
|---|---|---|
| `PORT` | `3000` | API port |
| `DATABASE_URL` | `postgresql://pos:pos@localhost:5432/pos` | PostgreSQL connection for Prisma |
| `JWT_SECRET` | *(long random string)* | Signs access tokens |
| `JWT_EXPIRES_IN` | `15m` | Access token lifetime |
| `SESSION_IDLE_MINUTES` | `30` | Idle timeout |
| `MAX_FAILED_ATTEMPTS` | `5` | Failed logins before lockout |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed frontend origin |
| `REDIS_URL` | `redis://localhost:6379` | Optional cache / rate limiting |
| `NODE_ENV` | `development` | Environment |

**`client/.env`**

| Variable | Example | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3000/api/v1` | Backend base URL |
| `VITE_SOCKET_URL` | `http://localhost:3000` | Socket.IO server |

Never commit `.env` files. Only commit `.env.example` with placeholder values.

---

## Available scripts

| Where | Command | What it does |
|---|---|---|
| `server` | `npm run dev` | Start API with auto-reload |
| `server` | `npm start` | Start API (production mode) |
| `server` | `npm test` | Run backend tests |
| `server` | `npx prisma migrate dev` | Apply schema changes locally |
| `server` | `npx prisma studio` | Browse the database in a browser |
| `server` | `npm run seed` | Load roles, permissions, demo data |
| `client` | `npm run dev` | Start frontend dev server |
| `client` | `npm run build` | Production build |
| `client` | `npm run lint` | Lint the code |

---

## API conventions

*(Owned by Intern 5. Every module must follow these.)*

- **Base path:** `/api/v1/<module>`, for example `/api/v1/orders`, `/api/v1/kot`, `/api/v1/bills`, `/api/v1/payments`, `/api/v1/refunds`, `/api/v1/inventory`, `/api/v1/customers`, `/api/v1/reports`.
- **Format:** JSON requests and responses.
- **Auth:** `Authorization: Bearer <token>` on every endpoint except login.
- **Success:** `{ "data": ... }`
- **Error:** `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": ... } }`
- **Status codes:** `200/201` success, `400` validation, `401` not logged in, `403` not allowed, `404` not found, `409` conflict, `423` locked.
- **Idempotency:** `POST` requests that create orders, payments or refunds must accept an `Idempotency-Key` header. A repeated key returns the original result and never creates a duplicate.
- **Permissions:** protected routes use `requirePermission('module.action')`, for example `requirePermission('refunds.process')`.
- **Audit:** state-changing actions write an audit record with who, what, when, old value, new value and reason.
- **Pagination:** list endpoints accept `limit` and `offset`.

---

## Roles and permissions

Roles: **Owner, Manager, Cashier, Waiter, Kitchen, Inventory, Admin.**

Permissions use `module.action` codes (for example `orders.create`, `discounts.apply`, `refunds.process`, `reports.view`, `users.manage`). Each role-permission link has a **scope** (`own`, `branch`, `all`) and an optional **limit** (such as maximum discount %). The matrix is stored in the database so a restaurant can change it without code changes.

Actions above a user's limit (large discounts, refunds) need a **manager approval**, which is single-use and recorded in the audit log.

The full matrix lives in `docs/04-security-rbac-analytics/rbac-matrix.md`.

---

## Order lifecycle

```
Created → Confirmed → KOT Sent → Preparing → Ready → Served → Billed → Paid → Closed
```

Alternative states: `Cancelled`, `Rejected`, `Modified`, `Partially Served`, `Refunded`.

Table states: `Available`, `Reserved`, `Occupied`, `Ordering`, `Preparing`, `Waiting for Payment`, `Payment Completed`, `Cleaning`, `Blocked`.

State changes are never silently overwritten. Important state history is preserved.

---

## Offline mode and sync

*(Owned by Intern 5, planned.)*

1. Every transaction is saved locally first (IndexedDB).
2. If online, it goes to the sync queue and is sent to the server right away.
3. If offline, it stays in the queue and retries when the connection returns.
4. The server uses idempotency keys to prevent duplicates, and conflicts are resolved by documented rules.
5. The UI shows the sync status of each record.

---

## Team and module ownership

| Intern | Role | Folder (docs and code) |
|---|---|---|
| 1 | Order and front-of-house operations | `docs/01-…`, `modules/tables, menu, orders, kot` |
| 2 | Billing, payment and financial operations | `docs/02-…`, `modules/bills, payments, shifts` |
| 3 | Inventory, recipe and customer operations | `docs/03-…`, `modules/inventory, customers, notifications` |
| 4 | Security, RBAC, dashboards and analytics | `docs/04-…`, `modules/auth, users, rbac, audit, reports` |
| 5 | Architecture, integration and reliability | `docs/05-…`, `middleware/`, `realtime/`, `offline/`, `openapi/` |

Cross-module changes (shared tables, API standards, permission codes) need a review from the owners involved.

---

## Git workflow

- `main` is protected. **No direct pushes.** All changes come through pull requests.
- Branch names: `intern<N>/<short-description>`, for example `intern4/rbac-matrix`.
- Commit messages: short and in the present tense, for example `Add PIN lockout after 5 failed attempts`. Optional prefixes: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`.
- Every PR needs **at least one review**. PRs that change `schema.prisma`, the API standard, or permission codes need review from Intern 5 (and Intern 4 for permissions).
- Pull from `main` often to avoid large merge conflicts:

```bash
git checkout main && git pull
git checkout intern4/my-branch
git merge main
```

- Use GitHub Issues for tasks and questions. Suggested labels: `intern-1` … `intern-5`, `cross-module`, `blocked`, `bug`.
- Do not commit secrets, `.env` files, `node_modules/`, or database files.

---

## Testing

- **Backend:** unit tests for services, API tests for routes (permission checks, validation, idempotency).
- **Frontend:** component tests for key flows (login, order entry, payment).
- **Required cases per module:** the edge cases listed in each intern's `edge-cases.md`, such as duplicate payments, paid-bill modification, failed KOT, negative stock and account lockout.

Run `npm test` in `server` and `client` before opening a PR.

---

## Documentation

All design documents live under `docs/`. The original requirements and the work split are in `docs/00-overview/`.

Each module folder should contain: workflow, business rules, database entities, API list, edge cases and acceptance criteria.

---

## Roadmap

- [ ] Repo setup, Docker Compose, Prisma schema baseline
- [ ] Auth, users, RBAC, audit (Intern 4)
- [ ] Tables, menu, orders, KOT, kitchen screen (Intern 1)
- [ ] Billing, payments, refunds, shifts (Intern 2)
- [ ] Inventory, recipes, customers, reservations (Intern 3)
- [ ] Per-role dashboards and reports (Intern 4)
- [ ] Offline mode, sync queue, idempotency (Intern 5)
- [ ] Integrations: printers, payment gateways, delivery platforms
- [ ] Multi-branch support
- [ ] Deployment, backups, monitoring

---

## License

To be decided by the team (add a `LICENSE` file).
