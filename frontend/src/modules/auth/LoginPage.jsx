import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import { Button, ErrorBanner, Field, inputClass } from '../../components/ui.jsx';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [method, setMethod] = useState('password');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), secret, method);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow ring-1 ring-slate-200">
        <h1 className="text-xl font-semibold">Restaurant POS</h1>
        <div className="flex gap-2 text-sm">
          {['password', 'pin'].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMethod(m); setSecret(''); }}
              className={`flex-1 rounded-md px-3 py-1.5 ${method === m ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`}
            >
              {m === 'pin' ? 'PIN' : 'Password'}
            </button>
          ))}
        </div>
        <ErrorBanner error={error} />
        <Field label="Username">
          <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </Field>
        <Field label={method === 'pin' ? 'PIN' : 'Password'}>
          <input
            className={inputClass}
            type="password"
            inputMode={method === 'pin' ? 'numeric' : undefined}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <Button type="submit" disabled={busy} className="w-full">{busy ? 'Signing in...' : 'Sign in'}</Button>
      </form>
    </div>
  );
}
