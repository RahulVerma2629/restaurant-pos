import { useState } from 'react';
import { api } from '../../services/api.js';
import { useFetch } from '../../services/useFetch.js';
import { Button, Card, ErrorBanner, Field, Loading, Table, inputClass } from '../../components/ui.jsx';

const PAGE = 20;

export default function AuditPage() {
  const [filters, setFilters] = useState({ action: '', userId: '', from: '', to: '' });
  const [applied, setApplied] = useState(filters);
  const [offset, setOffset] = useState(0);
  const { data, loading, error } = useFetch(
    () => api('/audit-logs', { query: {
      ...applied,
      from: applied.from ? new Date(applied.from).toISOString() : '',
      to: applied.to ? new Date(`${applied.to}T23:59:59`).toISOString() : '',
      limit: PAGE, offset } }),
    [applied, offset],
  );
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  const columns = [
    { header: 'When', render: (r) => new Date(r.createdAt).toLocaleString() },
    { header: 'Who', render: (r) => (r.userId ? `User ${r.userId}${r.role ? ` (${r.role})` : ''}` : 'System') },
    { header: 'Action', render: (r) => <span className="font-mono text-xs">{r.action}</span> },
    { header: 'Record', render: (r) => (r.entityType ? `${r.entityType} #${r.entityId}` : '') },
    { header: 'Reason', key: 'reason' },
    {
      header: 'Change',
      render: (r) => (r.oldValue || r.newValue) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-indigo-600">View</summary>
          {r.oldValue && <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2">Old: {JSON.stringify(r.oldValue, null, 1)}</pre>}
          {r.newValue && <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2">New: {JSON.stringify(r.newValue, null, 1)}</pre>}
        </details>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Audit log</h2>
      <Card>
        <form
          className="grid gap-3 sm:grid-cols-5"
          onSubmit={(e) => { e.preventDefault(); setOffset(0); setApplied(filters); }}
        >
          <Field label="Action"><input className={inputClass} placeholder="e.g. LOGIN_FAILED" value={filters.action} onChange={set('action')} /></Field>
          <Field label="User ID"><input className={inputClass} inputMode="numeric" value={filters.userId} onChange={set('userId')} /></Field>
          <Field label="From"><input className={inputClass} type="date" value={filters.from} onChange={set('from')} /></Field>
          <Field label="To"><input className={inputClass} type="date" value={filters.to} onChange={set('to')} /></Field>
          <div className="flex items-end"><Button type="submit">Search</Button></div>
        </form>
      </Card>
      <ErrorBanner error={error} />
      <Card>
        {loading && !data ? <Loading /> : <Table columns={columns} rows={data?.rows} empty="No audit records match" />}
        {data && (
          <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
            <span>{data.total} records</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
              <Button variant="secondary" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
