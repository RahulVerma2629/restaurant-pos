// Permission codes use "module.action". Every module checks these exact strings,
// e.g. requirePermission(PERMISSIONS.REFUNDS_PROCESS). To add a code: add it here,
// add it to PERMISSION_INFO, and tell the RBAC owner so the default matrix is updated.

export const SCOPES = Object.freeze({ OWN: 'own', BRANCH: 'branch', ALL: 'all' });
export const SCOPE_RANK = Object.freeze({ own: 1, branch: 2, all: 3 });

export const PERMISSIONS = Object.freeze({
  SALES_VIEW: 'sales.view',
  ORDERS_CREATE: 'orders.create',
  ORDERS_MODIFY: 'orders.modify',
  KOT_SEND: 'kot.send',
  PAYMENTS_PROCESS: 'payments.process',
  DISCOUNTS_APPLY: 'discounts.apply',     // limit = max discount percent
  REFUNDS_PROCESS: 'refunds.process',     // limit = max refund amount
  MENU_MANAGE: 'menu.manage',
  INVENTORY_MANAGE: 'inventory.manage',
  REPORTS_VIEW: 'reports.view',
  USERS_MANAGE: 'users.manage',
  ROLES_MANAGE: 'roles.manage',
  AUDIT_VIEW: 'audit.view',
  APPROVALS_DECIDE: 'approvals.decide',
  // Added during integration review: actions the other modules need that the base matrix did not cover.
  KOT_UPDATE: 'kot.update',                 // kitchen: accept / start / ready / cancel a KOT
  TABLES_MANAGE: 'tables.manage',           // create tables, block / release
  DELIVERY_MANAGE: 'delivery.manage',       // assign rider, dispatch, complete, fail
  SHIFTS_MANAGE: 'shifts.manage',           // open / close shift, cash in/out
  CUSTOMERS_MANAGE: 'customers.manage',     // customer profiles, loyalty
  RESERVATIONS_MANAGE: 'reservations.manage',
});

export const PERMISSION_INFO = Object.freeze([
  { code: 'sales.view', module: 'sales', description: 'View sales figures' },
  { code: 'orders.create', module: 'orders', description: 'Create orders' },
  { code: 'orders.modify', module: 'orders', description: 'Modify orders' },
  { code: 'kot.send', module: 'orders', description: 'Send KOT to the kitchen' },
  { code: 'payments.process', module: 'billing', description: 'Process payments' },
  { code: 'discounts.apply', module: 'billing', description: 'Apply discounts (limit = max %)' },
  { code: 'refunds.process', module: 'billing', description: 'Process refunds (limit = max amount)' },
  { code: 'menu.manage', module: 'menu', description: 'Manage menu' },
  { code: 'inventory.manage', module: 'inventory', description: 'Manage inventory' },
  { code: 'reports.view', module: 'reports', description: 'View reports' },
  { code: 'users.manage', module: 'security', description: 'Manage users' },
  { code: 'roles.manage', module: 'security', description: 'Manage roles and permissions' },
  { code: 'audit.view', module: 'security', description: 'View audit logs' },
  { code: 'approvals.decide', module: 'security', description: 'Approve or reject override requests' },
  { code: 'kot.update', module: 'orders', description: 'Update KOT status in the kitchen (accept, preparing, ready, cancel)' },
  { code: 'tables.manage', module: 'orders', description: 'Create tables, block and release tables' },
  { code: 'delivery.manage', module: 'orders', description: 'Assign riders and update delivery status' },
  { code: 'shifts.manage', module: 'billing', description: 'Open and close shifts, cash in and out' },
  { code: 'customers.manage', module: 'customers', description: 'Manage customer profiles and loyalty' },
  { code: 'reservations.manage', module: 'customers', description: 'Create and manage reservations' },
]);

// Default matrix. "Limited" in the requirements = scope 'own' and/or a numeric limit.
// limit: null = no limit. The database copy is editable per restaurant; this is only the seed.
const grant = (scope, limit = null) => Object.freeze({ scope, limit });
const A = (l) => grant('all', l), B = (l) => grant('branch', l), O = (l) => grant('own', l);

export const DEFAULT_RBAC_MATRIX = Object.freeze({
  owner: {
    'sales.view': A(), 'orders.create': A(), 'orders.modify': A(), 'kot.send': A(), 'payments.process': A(),
    'discounts.apply': A(100), 'refunds.process': A(), 'menu.manage': A(), 'inventory.manage': A(),
    'reports.view': A(), 'users.manage': B(), 'audit.view': A(), 'approvals.decide': A(),
    'kot.update': A(), 'tables.manage': A(), 'delivery.manage': A(), 'shifts.manage': A(),
    'customers.manage': A(), 'reservations.manage': A(),
  },
  manager: {
    'sales.view': B(), 'orders.create': B(), 'orders.modify': B(), 'kot.send': B(), 'payments.process': B(),
    'discounts.apply': B(30), 'refunds.process': B(5000), 'menu.manage': B(), 'inventory.manage': B(),
    'reports.view': B(), 'users.manage': B(), 'audit.view': B(), 'approvals.decide': B(),
    'kot.update': B(), 'tables.manage': B(), 'delivery.manage': B(), 'shifts.manage': B(),
    'customers.manage': B(), 'reservations.manage': B(),
  },
  cashier: {
    'sales.view': O(), 'orders.create': B(), 'orders.modify': O(), 'kot.send': B(), 'payments.process': B(),
    'discounts.apply': B(10), 'refunds.process': B(500), 'reports.view': O(),
    'shifts.manage': B(), 'delivery.manage': B(), 'customers.manage': B(), 'reservations.manage': B(),
  },
  waiter: {
    'orders.create': B(), 'orders.modify': O(), 'kot.send': B(), 'payments.process': O(),
    'discounts.apply': O(5), 'reports.view': O(),
    'customers.manage': B(), 'reservations.manage': B(),
  },
  kitchen: { 'reports.view': O(), 'kot.update': B() },
  inventory: { 'sales.view': O(), 'inventory.manage': B(), 'reports.view': B() },
  admin: {
    'sales.view': A(), 'orders.create': A(), 'orders.modify': A(), 'kot.send': A(), 'payments.process': A(),
    'discounts.apply': A(100), 'refunds.process': A(), 'menu.manage': A(), 'inventory.manage': A(),
    'reports.view': A(), 'users.manage': A(), 'roles.manage': A(), 'audit.view': A(), 'approvals.decide': A(),
    'kot.update': A(), 'tables.manage': A(), 'delivery.manage': A(), 'shifts.manage': A(),
    'customers.manage': A(), 'reservations.manage': A(),
  },
});
