// One place for all backend calls. Success responses are { data }, errors are { error: { code, message } }.
const BASE = import.meta.env.VITE_API_URL || '/api/v1';
const TOKEN_KEY = 'pos_token';

let token = sessionStorage.getItem(TOKEN_KEY);
let onSessionLost = () => {};

export const getToken = () => token;
export function setToken(t) {
  token = t;
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  else sessionStorage.removeItem(TOKEN_KEY);
}
export const setSessionLostHandler = (fn) => { onSessionLost = fn; };

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const SESSION_CODES = ['UNAUTHENTICATED', 'SESSION_INVALID', 'SESSION_EXPIRED'];

export async function api(path, { method = 'GET', body, query } = {}) {
  const params = query
    ? Object.entries(query).filter(([, v]) => v !== '' && v !== undefined && v !== null)
    : [];
  const qs = params.length ? `?${new URLSearchParams(params)}` : '';
  let res;
  try {
    res = await fetch(`${BASE}${path}${qs}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Is the backend running?');
  }
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const e = json?.error ?? {};
    if (SESSION_CODES.includes(e.code)) onSessionLost();
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? `Request failed (${res.status})`, e.details);
  }
  return json?.data;
}
