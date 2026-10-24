import { useEffect, useState } from 'react';
import { api } from '../../services/api.js';
import { useFetch } from '../../services/useFetch.js';
import { Button, Card, ErrorBanner, Loading, Notice, inputClass } from '../../components/ui.jsx';

const LIMIT_HINT = { 'discounts.apply': 'max %', 'refunds.process': 'max amount' };

// The editable permission matrix: for one role, tick the permissions, pick a scope, set a limit.
export default function RolesPage() {
  const roles = useFetch(() => api('/roles'));
  const perms = useFetch(() => api('/permissions'));
  const [roleId, setRoleId] = useState(null);
  const [rows, setRows] = useState({}); // code -> { enabled, scope, limit }
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');

  useEffect(() => { if (roles.data?.length && roleId === null) setRoleId(roles.data[0].id); }, [roles.data, roleId]);

  useEffect(() => {
    if (roleId === null || !perms.data) return;
    setNotice('');
    api(`/roles/${roleId}/permissions`)
      .then((granted) => {
        const next = {};
        for (const p of perms.data) {
          const g = granted.find((x) => x.code === p.code);
          next[p.code] = { enabled: !!g, scope: g?.scope ?? 'branch', limit: g?.limit ?? '' };
        }
        setRows(next);
      })
      .catch(setError);
  }, [roleId, perms.data]);

  const update = (code, patch) => setRows((r) => ({ ...r, [code]: { ...r[code], ...patch } }));

  async function save() {
    const reason = window.prompt('Reason for this change?');
    if (!reason) return;
    setError(null);
    setNotice('');
    const permissions = Object.entries(rows)
      .filter(([, v]) => v.enabled)
      .map(([code, v]) => ({ code, scope: v.scope, limit: v.limit === '' ? null : Number(v.limit) }));
    try {
      await api(`/roles/${roleId}/permissions`, { method: 'PUT', body: { permissions, reason } });
      setNotice('Permissions saved. They apply to users of this role on their next action.');
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Roles & permissions</h2>
      <ErrorBanner error={error || roles.error || perms.error} />
      <Notice>{notice}</Notice>
      {(roles.loading || perms.loading) && !perms.data ? <Loading /> : (
        <Card
          title="Permission matrix"
          actions={<Button onClick={save}>Save changes</Button>}
        >
          <div className="mb-3 flex flex-wrap gap-2">
            {roles.data?.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRoleId(r.id)}
                className={`rounded-md px-3 py-1 text-sm ${roleId === r.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {r.name}
              </button>
            ))}
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="px-2 py-2">Allowed</th><th className="px-2 py-2">Permission</th>
                <th className="px-2 py-2">Scope</th><th className="px-2 py-2">Limit</th>
              </tr>
            </thead>
            <tbody>
              {perms.data?.map((p) => {
                const row = rows[p.code];
                if (!row) return null;
                return (
                  <tr key={p.code} className="border-b border-slate-100">
                    <td className="px-2 py-2"><input type="checkbox" checked={row.enabled} onChange={(e) => update(p.code, { enabled: e.target.checked })} /></td>
                    <td className="px-2 py-2"><div className="font-mono text-xs">{p.code}</div><div className="text-xs text-slate-500">{p.description}</div></td>
                    <td className="px-2 py-2">
                      <select className={inputClass} disabled={!row.enabled} value={row.scope} onChange={(e) => update(p.code, { scope: e.target.value })}>
                        <option value="own">own</option><option value="branch">branch</option><option value="all">all</option>
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        className={inputClass}
                        type="number" min="0" step="any" disabled={!row.enabled}
                        placeholder={LIMIT_HINT[p.code] ?? 'no limit'}
                        value={row.limit}
                        onChange={(e) => update(p.code, { limit: e.target.value })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
