import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const env = {
  port: num(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  idleMinutes: num(process.env.SESSION_IDLE_MINUTES, 30),
  maxHours: num(process.env.SESSION_MAX_HOURS, 12),
  maxFailed: num(process.env.MAX_FAILED_ATTEMPTS, 5),
  // Shared secret for service-to-service calls (the Python orders module sends audit events with it). Empty = disabled.
  integrationKey: process.env.INTEGRATION_API_KEY || '',
  // Billing: where the Orders module runs, and the default tax rate in basis points (500 = 5%)
  ordersApiUrl: process.env.ORDERS_API_URL || '',
  defaultTaxBasisPoints: num(process.env.DEFAULT_TAX_BASIS_POINTS, 500),
};
