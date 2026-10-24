import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const env = {
  port: num(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  idleMinutes: num(process.env.SESSION_IDLE_MINUTES, 30),
  maxHours: num(process.env.SESSION_MAX_HOURS, 12),
  maxFailed: num(process.env.MAX_FAILED_ATTEMPTS, 5),
};
