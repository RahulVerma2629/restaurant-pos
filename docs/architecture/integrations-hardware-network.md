# Integrations, Hardware & Network

## 1. Integration pattern
| Direction | Method | Rule |
|---|---|---|
| Module → module (inside system) | Event outbox: `GET /api/v1/events?after_id=` (Orders) | Consumers store last processed id, must be idempotent |
| Terminal → server | REST + Idempotency-Key | See `api-architecture.md` |
| Server → payment gateway | HTTPS from server only (never from browser) | Use gateway idempotency key = our `Idempotency-Key`; verify webhook signature |
| Gateway → server | Webhook `POST /api/v1/webhooks/payments` (to be built by Billing) | Verify signature, respond 200 quickly, process once |
| Server → printer | ESC/POS over TCP 9100 or browser print | Queue print jobs; failed print never fails the order |

## 2. Payment gateway checklist (Billing owner + Fifth member)
1. Secrets only in `.env` / secret manager, never in Git (`.gitignore` already ignores `.env`).
2. Timeouts: 10 s connect/read; on timeout mark payment `PENDING` and reconcile via webhook or status API.
3. Reconciliation job every 15 min for `PENDING` payments.
4. Log gateway reference id on every payment.

## 3. Hardware
| Device | Connection | Notes |
|---|---|---|
| Receipt printer (80 mm thermal) | Ethernet (fixed IP) preferred, USB fallback | Reserve IP on router; test print on boot |
| Kitchen printer (KOT) | Ethernet | One per station; fallback is KDS screen |
| Kitchen display (KDS) | Browser fullscreen on LAN | Polls `/api/v1/events/latest` every 2 s |
| Cash drawer | Opens via printer kick pulse | Drawer open is logged in cash shift |
| Barcode / card reader | USB keyboard-wedge / gateway device | No special driver needed |
| UPS | Server + router + switch | ≥ 15 min so backup can finish and graceful shutdown works |

## 4. Network
- Dedicated restaurant VLAN or router for POS devices; guest Wi-Fi separate.
- Server has a fixed LAN IP; terminals use it (e.g. `http://192.168.1.10:3000`).
- Wired Ethernet for server, printers and cashier; Wi-Fi 5 GHz for tablets with at least two access points for coverage.
- Ports: 3000 (API), 8000 (Orders), 5173 (dev frontend only), 5432 (PostgreSQL – **LAN-closed, server only**).
- Production: HTTPS (reverse proxy such as Nginx/Caddy), firewall allows only 443 from outside.
- Internet failover: second ISP or mobile hotspot for gateway calls; LAN service continues without internet.
- Time: NTP enabled on server (order timestamps and audit trail depend on it).
