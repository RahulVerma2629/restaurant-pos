import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../../middleware/authenticate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { login, logout, changeCredentials, permList } from './auth.service.js';

const router = Router();

// Slows down password/PIN guessing from one address.
const loginLimiter = rateLimit({
  windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts, try again in a minute' } },
});

router.post('/auth/login', loginLimiter, asyncHandler(async (req, res) => {
  res.json({ data: await login(req, 'password') });
}));

router.post('/auth/pin-login', loginLimiter, asyncHandler(async (req, res) => {
  res.json({ data: await login(req, 'pin') });
}));

router.post('/auth/logout', authenticate, asyncHandler(async (req, res) => {
  await logout(req);
  res.json({ data: { loggedOut: true } });
}));

router.get('/auth/me', authenticate, (req, res) => {
  res.json({ data: { user: req.user, roles: req.roles, permissions: permList(req.perms) } });
});

router.post('/auth/change-credentials', authenticate, asyncHandler(async (req, res) => {
  await changeCredentials(req);
  res.json({ data: { changed: true } });
}));

export default router;
