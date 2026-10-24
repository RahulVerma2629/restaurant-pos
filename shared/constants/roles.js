// Single source of truth for role names. Used by backend, frontend and seeds.
export const ROLES = Object.freeze({
  OWNER: 'owner',
  MANAGER: 'manager',
  CASHIER: 'cashier',
  WAITER: 'waiter',
  KITCHEN: 'kitchen',
  INVENTORY: 'inventory',
  ADMIN: 'admin',
});

export const ROLE_DESCRIPTIONS = Object.freeze({
  owner: 'Restaurant owner',
  manager: 'Branch manager',
  cashier: 'Cashier',
  waiter: 'Waiter',
  kitchen: 'Kitchen staff',
  inventory: 'Inventory staff',
  admin: 'System administrator',
});

// Roles that may hand out owner/admin (privilege-escalation guard).
export const PRIVILEGED_ROLES = Object.freeze([ROLES.OWNER, ROLES.ADMIN]);
