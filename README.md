# Restaurant POS: Restaurant Management System

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-5-2D3748?logo=prisma&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

A modular Point-of-Sale system for restaurants, built by a team of five interns. It covers the whole restaurant flow: tables and orders, the kitchen (KOT/KDS), billing and payments, inventory and recipes, customers, and the security, audit and reporting layer behind all of it.

```
Customer → Table/Order → POS → KOT → Kitchen → Preparation → Serving
        → Billing → Payment → Inventory → Reporting
        (plus separate Takeaway and Delivery flows)
```

The design goal is to grow from **one POS terminal → many terminals → one branch → many branches** without a major redesign.

---

## Project status

| Module | Owner | Status |
|---|---|---|
| Security, RBAC, audit, dashboards, reports | Intern 4 (Somil) | **Implemented** (backend and frontend) |
| Orders, tables, menu, KOT, kitchen | Intern 1 | Planned |
| Billing, payments, refunds, shifts | Intern 2 | Planned |
| Inventory, recipes, customers, reservations | Intern 3 | Planned |
| Architecture, offline sync, integrations | Intern 5 | Planned |

Dashboard widgets and reports that depend on the planned modules (sales, orders, inventory) already exist in the security module and show "waiting for module" until those modules supply data.

---

## Features (security module)

- **Login with password or PIN**, account lockout after 5 failed attempts, one active session per user, idle and maximum session timeouts, forced password change for new users.
- **User management:** create, update, deactivate, activate, unlock and reset credentials, with safeguards (no self-deactivation, last admin protected, only owners and admins can assign owner/admin roles).
- **Role-based access control (RBAC):** 7 roles, 14 permission codes, each with a **scope** (own, branch, all) and an optional **limit** (maximum discount % or refund amount). The matrix is stored in the database and editable in the app.
- **Manager approvals:** a cashier above their discount or refund limit must request an approval. A manager approves it, and it works exactly once. Nobody can approve their own request.
- **Tamper-proof audit log:** records who, what, when, where, old value, new value, reason and approver. The database rejects any update or delete on it.
- **A dashboard for each role:** Owner, Manager, Cashier, Waiter, Kitchen, Inventory and Admin each see only the widgets they have permission for.
- **Reports:** staff activity and login activity today, with sales, payments, orders and inventory reports ready to connect.
- **API standard for the team:** `/api/v1`, JSON in camelCase, consistent error format, `guard(permission)` middleware and an `audit()` helper that every other module reuses.

### Roles

| Role | Typical use |
|---|---|
| Owner | Whole business, all branches |
| Manager | One branch: staff, approvals, daily operations |
| Cashier | Bills, payments, limited discounts and refunds |
| Waiter | Tables and orders |
| Kitchen | KOT and preparation |
| Inventory | Stock and wastage |
| Admin | Users, roles, permissions, system settings |

Default limits: cashier discount 10% and refund up to 500, waiter discount 5%, manager discount 30% and refund up to 5000. Owners and admins have no refund limit. A restaurant can change all of these without code changes.

---

## Screenshots

Add screenshots to `docs/screenshots/` and link them here:

| Login | Role dashboard |
|---|---|
| `docs/screenshots/login.png` | `docs/screenshots/dashboard.png` |

| Permission matrix | Audit log |
|---|---|
| `docs/screenshots/roles.png` | `docs/screenshots/audit.png` |

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React + Vite**, **Tailwind CSS** | Large community, works well on touchscreens, one codebase for POS, kitchen display and dashboards |
| Backend | **Node.js + Express** | Same language as the frontend, so the team can help each other |
| Database | **PostgreSQL** with **Prisma** | Relational data and transactions (orders, bills, payments, stock); readable schema and migrations |
| Real-time | **Socket.IO** *(planned)* | KOT to the kitchen screen, live table status |
| Offline | **PWA + IndexedDB** with a sync queue *(planned)* | Orders keep working without internet and sync later |
| Auth | Opaque session tokens (hashed in the database) + **bcrypt** | Revocable sessions, no secrets stored in plain text |
| API docs | **OpenAPI / Swagger** *(planned)* | One place for every module's endpoints |
| Tooling | **Docker Compose**, Zod validation, Helmet, rate limiting | Same setup for everyone, input validation, safe defaults |

---

## Architecture

```
┌───────────────────────────────┐
│          CLIENT LAYER         │
│   POS  |  KDS  |  Dashboards  │   React + Vite
└──────────────┬────────────────┘
               ↓
┌───────────────────────────────┐
│    EDGE / LOCAL (planned)     │
│  Offline cache + sync queue   │   IndexedDB, retry, conflict handling
└──────────────┬────────────────┘
               ↓
┌───────────────────────────────┐
│          BACKEND API          │
│   Express modules, /api/v1    │   auth, users, rbac, audit, reports ...
└──────────────┬────────────────┘
               ↓
┌───────────────────────────────┐
│          DATA LAYER           │
│       PostgreSQL (Prisma)     │
└───────────────────────────────┘
```

A **modular monolith**: one backend with a folder per module. Modules talk through service functions, not by reading each other's tables, so they can be split into separate services later. Every request passes through `authenticate` and `requirePermission`, and every state-changing action writes an audit record.

---

## Repository structure

```
restaurant-pos/
├── backend/
│   ├── prisma/                 # schema.prisma, seed.js, audit_triggers.sql
│   └── src/
│       ├── config/  middleware/  utils/  routes/
│       └── modules/
│           ├── auth/  users/  rbac/  audit/  dashboards/  reports/    # security module
│           └── (orders, billing, inventory ... added by the other modules)
├── frontend/
│   └── src/
│       ├── app/                # routes and layout
│       ├── components/  services/
│       └── modules/            # auth, dashboards, users, rbac, audit, reports
├── shared/
│   ├── constants/              # roles, permission codes, audit event names
│   └── contracts/              # API contracts between modules
├── database/schema/            # reference SQL
├── docs/                       # requirements, workflows, per-module design
├── tests/backend/              # end-to-end smoke test
└── docker-compose.yml          # PostgreSQL
```

---

## Getting started

### Prerequisites

- Node.js 20 or newer
- Docker Desktop (for PostgreSQL), or your own PostgreSQL 15+
- Git

### 1. Clone and start the database

```bash
git clone <repository-url>
cd restaurant-pos
docker compose up -d db
```

### 2. Backend

```bash
cd backend
cp .env.example .env          # Windows CMD: copy .env.example .env
npm install
npx prisma migrate dev --name security_init
npm run db:triggers           # makes the audit log append-only
npm run seed                  # roles, permission matrix, demo users
npm run dev                   # http://localhost:3000/api/v1/health
```

### 3. Frontend (second terminal)

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

### 4. Check everything works (third terminal)

```bash
cd backend
npm run smoke                 # about 40 end-to-end checks
```

Logins are limited to 20 per minute, so wait a minute before running the smoke test twice.

### Demo accounts (development only)

| Username | Role |
|---|---|
| `owner`, `manager`, `cashier`, `waiter`, `kitchen`, `inventory`, `admin` | the role of the same name |

Password `Passw0rd!` and PIN `1234` for all of them. Change or remove them before any real use (`NODE_ENV=production` skips creating them).

### Try these

1. Log in as `cashier`, open **Approvals** and request a 20% discount.
2. Log in as `manager` and approve it.
3. Log in as `admin`, open **Roles & permissions** and change a limit.
4. Open **Audit log** and see every step recorded with who, when and why.
5. Enter a wrong PIN five times to see the lockout, then unlock the user as `manager`.

---

## API at a glance

Base path `/api/v1`. JSON. `Authorization: Bearer <token>` on every endpoint except login.
Success: `{ "data": ... }`. Error: `{ "error": { "code", "message", "details" } }`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `/auth/pin-login`, `/auth/logout`, `GET /auth/me`, `POST /auth/change-credentials` |
| Users | `GET/POST /users`, `GET/PATCH /users/:id`, `POST /users/:id/deactivate \| activate \| unlock \| reset-credentials` |
| Roles | `GET /roles`, `GET /permissions`, `POST /roles`, `GET/PUT /roles/:id/permissions` |
| Approvals | `POST /approvals`, `GET /approvals`, `POST /approvals/:id/decide` |
| Limit checks | `POST /discounts/check`, `POST /refunds/check` |
| Audit | `GET /audit-logs` |
| Dashboards and reports | `GET /dashboards/me`, `GET /reports`, `GET /reports/:code` |

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"manager","password":"Passw0rd!","terminalId":"T1"}'
```

Full contract: `shared/contracts/security-api.md`.

### For other modules

```js
// protect a route and know who is calling
router.get('/orders', ...guard(PERMISSIONS.ORDERS_CREATE), handler);

// record an audit event
await audit(req, { action: AUDIT_EVENTS.ORDER_CANCELLED, entityType: 'order', entityId, oldValue, newValue, reason });

// before applying a discount or refund
POST /discounts/check   { "percent": 20, "orderId": 42, "approvalId": 7 }
```

---

## Security highlights

- Passwords and PINs are hashed with bcrypt. Session tokens are random and stored only as a SHA-256 hash.
- Permissions are re-read on every request, so a role change or deactivation takes effect immediately.
- The server enforces every permission. The UI only hides what a user cannot use.
- The audit log is append-only at the database level (triggers block UPDATE, DELETE and TRUNCATE).
- Over-limit actions need a single-use manager approval, with self-approval blocked.
- Privilege escalation is blocked: nobody changes their own roles, only owners and admins assign owner/admin, and the last active admin cannot be removed.
- Login endpoints are rate limited, error messages do not reveal whether a username exists, and Helmet sets safe HTTP headers.

---

## Order and table states (design for the orders module)

```
Order:  Created → Confirmed → KOT Sent → Preparing → Ready → Served → Billed → Paid → Closed
        alternatives: Cancelled, Rejected, Modified, Partially Served, Refunded

Table:  Available · Reserved · Occupied · Ordering · Preparing · Waiting for Payment
        · Payment Completed · Cleaning · Blocked
```

---

## Roadmap

- [x] Security: auth, users, RBAC, approvals, audit log, role dashboards, reports
- [ ] Orders: tables, menu, modifiers, orders, KOT, kitchen display
- [ ] Billing: bills, split/merge, payments, reconciliation, refunds, shifts
- [ ] Inventory: stock, recipes (BOM), wastage, customers, reservations, loyalty
- [ ] Architecture: OpenAPI docs, Socket.IO, offline mode with sync queue, idempotency
- [ ] Integrations: receipt and KOT printers, payment gateways, delivery platforms
- [ ] Multi-branch support, deployment, backups and monitoring

---

## Team

| # | Role | Owner |
|---|---|---|
| 1 | Order and front-of-house operations | *(add name)* |
| 2 | Billing, payment and finance | *(add name)* |
| 3 | Inventory, recipe and customers | *(add name)* |
| 4 | Security, RBAC, dashboards and analytics | Somil |
| 5 | Architecture, integration and reliability | *(add name)* |

### Contributing

- `main` is protected. Work on a branch named `yourname/short-description` and open a pull request.
- At least one review per pull request. Changes to `schema.prisma`, the API standard or permission codes also need review from the module owners involved.
- Use the shared constants in `shared/constants/` for roles, permission codes and audit event names.
- Never commit `.env` files or `node_modules/`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Can't reach database server` | Start Docker Desktop and run `docker compose up -d db`; check `DATABASE_URL` in `backend/.env` |
| `Environment variable not found: DATABASE_URL` | Copy `.env.example` to `.env` inside `backend/` |
| `@prisma/client did not initialize` | Run `npx prisma generate` |
| "Invalid credentials" for demo users | Run `npm run seed` |
| "Account is locked" | Log in as `manager` and unlock the user |
| "Too many login attempts" | Wait one minute |
| Frontend says it cannot reach the server | Start the backend on port 3000 |

Reset the local database (deletes all data): `npx prisma migrate reset`, then `npm run db:triggers` and `npm run seed`.

---

## License

To be decided by the team. Add a `LICENSE` file to the repository root.
