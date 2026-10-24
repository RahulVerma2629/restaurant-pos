# Backend: Security module (auth, users, RBAC, audit, dashboards, reports)

Run from the repo root, then in `backend/`:

```bash
docker compose up -d db                  # PostgreSQL (repo root)
cd backend
cp .env.example .env
npm install
npx prisma migrate dev --name security_init
npm run db:triggers                      # makes audit_logs append-only
npm run seed                             # roles, permission matrix, demo users
npm run dev                              # http://localhost:3000/api/v1/health
npm run smoke                            # in a second terminal: end-to-end check (about 40 checks)
```

Demo users (development only): `owner, manager, cashier, waiter, kitchen, inventory, admin`, password `Passw0rd!`, PIN `1234`.

## For other modules

| Need | Use |
|---|---|
| Require login + a permission | `router.get('/', ...guard(PERMISSIONS.ORDERS_CREATE), handler)` (`src/middleware/authenticate.js`) |
| Who is calling | `req.user`, `req.roles`, `req.perms` (Map of code to `{ scope, limit }`) |
| Respect scope | `scopeWhere(req, req.access.scope)` (`src/modules/rbac/access.js`) |
| Write an audit record | `await audit(req, { action: AUDIT_EVENTS.ORDER_CANCELLED, entityType: 'order', entityId, oldValue, newValue, reason })` |
| Enforce discount/refund limits | `POST /discounts/check` or `/refunds/check` (see `shared/contracts/security-api.md`) |
| Add a router | `src/routes/index.js` |

JSON field names are camelCase everywhere (team API standard).
