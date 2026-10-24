import bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'node:crypto';

export const hashSecret = (secret) => bcrypt.hash(String(secret), 10);
export const verifySecret = (secret, hash) => (hash ? bcrypt.compare(String(secret), hash) : Promise.resolve(false));
export const newToken = () => randomBytes(32).toString('hex');
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// Credential policy. Return an error message, or null when fine.
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and digits';
  return null;
}
export function pinProblem(pin) {
  return /^\d{4,6}$/.test(String(pin ?? '')) ? null : 'PIN must be 4 to 6 digits';
}
