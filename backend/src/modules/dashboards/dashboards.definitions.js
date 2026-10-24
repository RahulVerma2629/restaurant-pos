// One dashboard per role. Each widget: code, title, source module, permission needed (null = role only).
// "source" tells other interns which module must supply the data for that widget.
const W = (code, title, source, permission = null) => ({ code, title, source, permission });

export const DASHBOARDS = {
  owner: [W('sales.total', 'Total sales', 'billing', 'sales.view'), W('revenue.trend', 'Revenue', 'billing', 'sales.view'),
    W('branch.performance', 'Branch performance', 'reports', 'reports.view'), W('business.trends', 'Business trends', 'reports', 'reports.view'),
    W('inventory.overview', 'Inventory overview', 'inventory', 'inventory.manage'), W('staff.activity', 'Staff activity', 'security', 'audit.view'),
    W('reports.summary', 'High-level reports', 'reports', 'reports.view')],
  manager: [W('orders.active', 'Active orders', 'orders', 'orders.modify'), W('kot.pending', 'Pending KOT', 'orders', 'kot.send'),
    W('discounts.today', 'Discounts', 'billing', 'discounts.apply'), W('refunds.today', 'Refunds', 'billing', 'refunds.process'),
    W('staff.activity', 'Staff activity', 'security', 'audit.view'), W('shift.status', 'Shift status', 'billing', 'payments.process'),
    W('sales.daily', 'Daily sales', 'billing', 'sales.view'), W('alerts', 'Operational alerts', 'notifications')],
  cashier: [W('bills.active', 'Active bills', 'billing', 'payments.process'), W('payments.today', 'Payments', 'billing', 'payments.process'),
    W('refunds.today', 'Refunds', 'billing', 'refunds.process'), W('cash.drawer', 'Cash drawer', 'billing', 'payments.process'),
    W('shift.status', 'Shift', 'billing', 'payments.process'), W('payments.failed', 'Payment failures', 'billing', 'payments.process')],
  waiter: [W('tables.status', 'Tables and table status', 'orders', 'orders.create'), W('orders.active', 'Active orders', 'orders', 'orders.create'),
    W('kot.status', 'KOT status', 'orders', 'kot.send'), W('orders.history', 'Order history', 'orders', 'orders.create'),
    W('customers.info', 'Customer information', 'customers')],
  kitchen: [W('kot.active', 'Active KOT', 'orders'), W('kot.priority', 'Priority', 'orders'), W('kot.preparing', 'Preparing', 'orders'),
    W('kot.ready', 'Ready', 'orders'), W('orders.delayed', 'Delayed orders', 'orders'), W('kot.by_station', 'Station-wise orders', 'orders')],
  inventory: [W('stock.current', 'Current stock', 'inventory', 'inventory.manage'), W('stock.low', 'Low stock', 'inventory', 'inventory.manage'),
    W('stock.consumption', 'Consumption', 'inventory', 'inventory.manage'), W('stock.wastage', 'Wastage', 'inventory', 'inventory.manage'),
    W('ingredient.usage', 'Ingredient usage', 'inventory', 'inventory.manage'), W('stock.adjustments', 'Stock adjustments', 'inventory', 'inventory.manage')],
  admin: [W('users.summary', 'Users', 'security', 'users.manage'), W('roles.summary', 'Roles and permissions', 'security', 'roles.manage'),
    W('system.config', 'System configuration', 'system'), W('audit.recent', 'Audit', 'security', 'audit.view'),
    W('branches.config', 'Branch configuration', 'system')],
};
