# Project Structure & Ownership

This repository follows a common modular structure.

## Team Ownership

### Prashant
Order & Front-of-House Operations

Main areas:
- Tables
- Menu
- Modifiers
- Orders
- Order Lifecycle
- KOT
- Kitchen/KDS
- Dine-in
- Takeaway
- Delivery

### Rahul
Billing & Payment Operations

Main areas:
- Billing
- Split/Merge Bills
- Payments
- Payment Reconciliation
- Discounts
- Taxes
- Refunds
- Shifts
- Cash Drawer

### Tia
Inventory & Customer Operations

Main areas:
- Inventory
- Stock Management
- Recipe/BOM
- Stock Consumption
- Wastage
- Menu Availability
- Customers
- Reservations
- Notifications

### Somil
Security, RBAC, Dashboards & Analytics

Main areas:
- User Management
- Authentication
- Authorization
- Roles
- Permissions
- Access Control
- Dashboards
- Audit
- Reports

### Fifth Team Member
Architecture, Integration & Reliability

Main areas:
- System Architecture
- API Architecture
- Scalability
- Offline Support
- Synchronization
- Idempotency
- Concurrency
- Integrations
- Hardware & Network
- Backup & Recovery
- Non-Functional Requirements

## Important Rule

All team members work inside the common repository structure.

Do not create separate project architectures for individual modules.

Shared types, constants, contracts and database conventions must remain consistent across modules.