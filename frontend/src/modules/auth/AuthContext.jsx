import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setSessionLostHandler } from '../../services/api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null); // { user, roles, permissions, mustChange }
  const [ready, setReady] = useState(false);

  const clear = useCallback(() => { setToken(null); setSession(null); }, []);

  // On first load, restore the session if a token is stored.
  useEffect(() => {
    setSessionLostHandler(clear);
    if (!getToken()) { setReady(true); return; }
    api('/auth/me')
      .then((me) => setSession({ ...me, mustChange: me.user.mustChange }))
      .catch(clear)
      .finally(() => setReady(true));
  }, [clear]);

  const login = useCallback(async (username, secret, method) => {
    const body = { username, terminalId: 'WEB' };
    if (method === 'pin') body.pin = secret; else body.password = secret;
    const data = await api(method === 'pin' ? '/auth/pin-login' : '/auth/login', { method: 'POST', body });
    setToken(data.token);
    setSession({ user: data.user, roles: data.roles, permissions: data.permissions, mustChange: data.mustChange });
  }, []);

  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* already logged out */ }
    clear();
  }, [clear]);

  const value = useMemo(() => ({
    ready,
    user: session?.user ?? null,
    roles: session?.roles ?? [],
    permissions: session?.permissions ?? [],
    mustChange: session?.mustChange ?? false,
    // can('users.manage')  ->  true if the logged-in user holds that permission
    can: (code) => !!session?.permissions.some((p) => p.code === code),
    login,
    logout,
    credentialsChanged: () => setSession((s) => (s ? { ...s, mustChange: false } : s)),
  }), [ready, session, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
