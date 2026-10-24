import { useState } from 'react';
import { api } from '../../services/api.js';
import { useFetch } from '../../services/useFetch.js';
import { Badge, Button, Card, ErrorBanner, Field, Loading, Notice, Table, inputClass } from '../../components/ui.jsx';

const EMPTY = { name: '', username: '', password: '', pin: '', roles: [] };

export default function UsersPage() {
  const users = useFetch(() => api('/users'));
  const roles = useFetch(() => api('/roles'));
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggleRole = (name) =>
    setForm((f) => ({ ...f, roles: f.roles.includes(name) ? f.roles.filter((r) => r !== name) : [...f.roles, name] }));

  async function run(action, okMessage) {
    setError(null);
    setNotice('');
    try {
      await action();
      setNotice(okMessage);
      users.reload();
    } catch (err) {
      setError(err);
    }
  }

  const create = (e) => {
    e.preventDefault();
    const body = { name: form.name, username: form.username, password: form.password, roles: form.roles };
    if (form.pin) body.pin = form.pin;
    return run(async () => {
      await api('/users', { method: 'POST', body });
      setForm(EMPTY);
      setShowForm(false);
    }, 'User created. They must change their password at first login.');
  };

  const deactivate = (u) => {
    const reason = window.prompt(`Reason for deactivating ${u.name}?`);
    if (reason) run(() => api(`/users/${u.id}/deactivate`, { method: 'POST', body: { reason } }), `${u.name} deactivated.`);
  };
  const resetPassword = (u) => {
    const password = window.prompt(`New temporary password for ${u.name} (8+ characters, letters and digits):`);
    if (password) run(() => api(`/users/${u.id}/reset-credentials`, { method: 'POST', body: { password } }), 'Password reset. The user must change it at next login.');
  };
  const resetPin = (u) => {
    const pin = window.prompt(`New PIN for ${u.name} (4 to 6 digits):`);
    if (pin) run(() => api(`/users/${u.id}/reset-credentials`, { method: 'POST', body: { pin } }), 'PIN reset.');
  };
  const post = (u, action, msg) => run(() => api(`/users/${u.id}/${action}`, { method: 'POST', body: {} }), msg);

  const columns = [
    { header: 'Name', render: (u) => <div><div className="font-medium">{u.name}</div><div className="font-mono text-xs text-slate-500">{u.username}</div></div> },
    { header: 'Roles', render: (u) => u.roles.join(', ') },
    { header: 'Status', render: (u) => <Badge value={u.status} /> },
    { header: 'Last login', render: (u) => (u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never') },
    {
      header: 'Actions',
      render: (u) => (
        <div className="flex flex-wrap gap-1">
          {u.status === 'locked' && <Button variant="success" onClick={() => post(u, 'unlock', `${u.name} unlocked.`)}>Unlock</Button>}
          {u.status === 'inactive' && <Button variant="success" onClick={() => post(u, 'activate', `${u.name} activated.`)}>Activate</Button>}
          {u.status !== 'inactive' && <Button variant="danger" onClick={() => deactivate(u)}>Deactivate</Button>}
          <Button variant="secondary" onClick={() => resetPassword(u)}>Reset password</Button>
          <Button variant="secondary" onClick={() => resetPin(u)}>Reset PIN</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Users</h2>
        <Button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : 'Add user'}</Button>
      </div>
      <ErrorBanner error={error || users.error} />
      <Notice>{notice}</Notice>

      {showForm && (
        <Card title="New user">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name"><input className={inputClass} value={form.name} onChange={set('name')} required /></Field>
            <Field label="Username (3+ characters)"><input className={inputClass} value={form.username} onChange={set('username')} required minLength={3} /></Field>
            <Field label="Temporary password (8+ characters, letters and digits)"><input className={inputClass} type="password" value={form.password} onChange={set('password')} required /></Field>
            <Field label="PIN (optional, 4 to 6 digits)"><input className={inputClass} type="password" inputMode="numeric" value={form.pin} onChange={set('pin')} /></Field>
            <div className="sm:col-span-2">
              <span className="mb-1 block text-sm font-medium text-slate-700">Roles</span>
              <div className="flex flex-wrap gap-3 text-sm">
                {roles.data?.map((r) => (
                  <label key={r.id} className="flex items-center gap-1">
                    <input type="checkbox" checked={form.roles.includes(r.name)} onChange={() => toggleRole(r.name)} />
                    {r.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2"><Button type="submit" disabled={!form.roles.length}>Create user</Button></div>
          </form>
        </Card>
      )}

      <Card>
        {users.loading && !users.data ? <Loading /> : <Table columns={columns} rows={users.data} />}
      </Card>
    </div>
  );
}
