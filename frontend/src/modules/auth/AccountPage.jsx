import { useState } from 'react';
import { api } from '../../services/api.js';
import { useAuth } from './AuthContext.jsx';
import { Button, Card, ErrorBanner, Field, Notice, inputClass } from '../../components/ui.jsx';

export default function AccountPage() {
  const { user, roles, mustChange, credentialsChanged } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', newPin: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setDone('');
    const body = { currentPassword: form.currentPassword };
    if (form.newPassword) body.newPassword = form.newPassword;
    if (form.newPin) body.newPin = form.newPin;
    try {
      await api('/auth/change-credentials', { method: 'POST', body });
      setDone('Credentials updated.');
      setForm({ currentPassword: '', newPassword: '', newPin: '' });
      credentialsChanged();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <Card title="My account">
        <p className="text-sm">{user.name} (<span className="font-mono">{user.username}</span>)</p>
        <p className="text-sm text-slate-500">Roles: {roles.join(', ')}</p>
      </Card>
      <Card title="Change password or PIN">
        {mustChange && <p className="mb-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">Please set your own password now.</p>}
        <form onSubmit={submit} className="space-y-3">
          <ErrorBanner error={error} />
          <Notice>{done}</Notice>
          <Field label="Current password"><input className={inputClass} type="password" value={form.currentPassword} onChange={set('currentPassword')} required /></Field>
          <Field label="New password (8+ characters, letters and digits)"><input className={inputClass} type="password" value={form.newPassword} onChange={set('newPassword')} /></Field>
          <Field label="New PIN (4 to 6 digits)"><input className={inputClass} type="password" inputMode="numeric" value={form.newPin} onChange={set('newPin')} /></Field>
          <Button type="submit">Save</Button>
        </form>
      </Card>
    </div>
  );
}
