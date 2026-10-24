# Restaurant POS — Order & Front-of-House Module

**Owner:** Intern 1 — Order & Front-of-House Operations Lead
**Stack (kept deliberately simple):** Python **FastAPI** · **SQLite** · plain **HTML + CSS + JavaScript** (no Node, no Docker, no build step)

Scope: **tables · menu & modifiers · orders · order lifecycle · KOT · kitchen screen (KDS) · dine-in / takeaway / delivery**.
One command starts everything; the web UI and the API are served by the same program.

## Run it (2 minutes)

You only need **Python 3.10 or newer** (check: `python --version`).

| Windows | Mac / Linux |
|---|---|
| double-click **`start.bat`** (or run it in a terminal) | `./start.sh` |

Then open **http://localhost:8000** — sample tables and menu are created automatically on the first run.
API documentation (try every API from the browser): **http://localhost:8000/docs**

Run the automatic tests: **`run_tests.bat`** / **`./run_tests.sh`** → `33 passed`.

<details><summary>Manual commands (same thing)</summary>

```bash
python -m venv .venv
.venv\Scripts\activate            # Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt
set AUTO_SEED=1                    # Mac/Linux: export AUTO_SEED=1
python -m uvicorn app.main:app --port 8000
```
</details>

## What the screens do

| Screen | Features |
|---|---|
| **Floor / Dine-in** | table map with the 9 table states · open an order · **move** table · **merge** tables · **block / release** |
| **Order screen** | menu by category · modifiers (extra cheese, spice level… with min/max rules) · notes · quantity · send to kitchen (KOT) with priority · serve ready items · bill → paid → close (demo buttons for the Billing module) · cancel · reopen · status history |
| **Kitchen (KDS)** | tickets per station (Main Kitchen, Grill, Bakery, Beverage, Dessert) · Accept / Start / Ready · **rush/high priority first** · DELAYED highlight · ADDITION and CANCEL tickets · print-failed → retry |
| **Takeaway & Delivery** | create orders · handover · assign rider → dispatch → delivered / failed · payment/COD status |

Screens refresh by themselves (every 2 s the browser checks the event counter) — open the Kitchen on a second tab/tablet and watch tickets arrive live.
Use the **Role** dropdown (waiter / manager / cashier / kitchen): removing an already-sent item or cancelling after KOT needs manager approval — as a *manager* you approve yourself.

## Project layout

```
app/
  main.py            web server: API + UI + start-up (creates tables, optional sample data)
  models.py          18 database tables (docs/schema.sql)
  state_machine.py   order lifecycle, KOT transitions, table-status mapping   <- single source of truth
  routers/           tables, menu, orders, kot, deliveries   (the API endpoints)
  services/          business logic
  static/            index.html · app.js · style.css          (the UI — plain JavaScript)
tests/               33 automatic tests
scripts/             seed.py (sample data) · concurrency_check.py · export_docs.py
docs/                DESIGN.md (full design, rules, edge cases) · openapi.json · schema.sql
```

## Built-in reliability (all tested)
* **No duplicate orders** — `Idempotency-Key`: 8 identical requests sent at once create exactly 1 order.
* **No lost edits** — every write is serialized (one lock) + `If-Match` version check: 20 parallel item additions → 20 items stored.
* **Two waiters, one table** — only one gets it, the others get a clear `TABLE_NOT_AVAILABLE`.
* **KOT failure** — 3 retries on the printer/KDS, then a fallback device, else status `failed` + alert; the order is never lost.
* **History is never overwritten** — every status change stored with who/when/why; item name & price are snapshotted on the order.
* **Event outbox** — every change writes an event (`GET /api/v1/events`) that Billing / Inventory / Audit can read.

## Integration points for the other interns
| Who | Use |
|---|---|
| Intern 2 Billing | call `POST /orders/{id}/status` (`billed` → `paid` → `closed`/`refunded`) and `PATCH /orders/{id}/payment-status`; `subtotal` is before tax/discount; ignore orders with `merged_into_order_id` |
| Intern 3 Inventory | read events `order.confirmed`, `order.items_served`, `order.item_cancelled_after_kot`; set `PATCH /menu/items/{id}/availability` (`stock_available`) |
| Intern 4 RBAC / Audit | replace `app/deps.py` (`current_user`) with real login; read `/events` + `order_status_history` |
| Intern 5 Architecture | implement `transport()` in `app/services/kot_service.py` for real printers/KDS; switch DB with `DATABASE_URL` (e.g. PostgreSQL) |

## Assumptions & limits (be honest in your demo)
* Login is a placeholder (role dropdown → `X-User-Role` header). Add real auth before using it outside a demo.
* KOT printing is a stub that always succeeds (real printer driver = Intern 5).
* SQLite + one write lock is perfect for one restaurant / one server. For many branches use PostgreSQL (`DATABASE_URL`) — code is unchanged.
* Retry count (3), delay rule (prep time × 1.25) and merge rule (only before "ready") are assumptions to confirm with the team.
* Money is stored in paise (₹10.00 = 1000). Time-slot menus use the server's local time.

## API
Base `/api/v1` · errors look like `{"error": {"code": "...", "message": "...", "details": {}}}` · full list in `docs/openapi.json` or `/docs`.
