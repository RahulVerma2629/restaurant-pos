import { useState } from 'react';
import { api } from '../../services/api.js';
import { useFetch } from '../../services/useFetch.js';
import { Badge, Button, Card, ErrorBanner, Field, Loading, Table, inputClass } from '../../components/ui.jsx';

export default function ReportsPage() {
  const list = useFetch(() => api('/reports'));
  const [selected, setSelected] = useState(null);
  const [range, setRange] = useState({ from: '', to: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(report) {
    setSelected(report);
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const data = await api(`/reports/${report.code}`, { query: {
        from: range.from ? new Date(range.from).toISOString() : '',
        to: range.to ? new Date(`${range.to}T23:59:59`).toISOString() : '' } });
      setResult(data);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const groups = {};
  for (const r of list.data ?? []) (groups[r.group] ??= []).push(r);
  const columns = result?.rows?.length
    ? Object.keys(result.rows[0]).map((key) => ({ header: key, render: (row) => String(row[key] ?? '') }))
    : [];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Reports</h2>
      <ErrorBanner error={list.error} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="From"><input className={inputClass} type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></Field>
          <Field label="To"><input className={inputClass} type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></Field>
        </div>
      </Card>

      {list.loading && !list.data ? <Loading /> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-1">
            {Object.entries(groups).map(([group, items]) => (
              <Card key={group} title={group[0].toUpperCase() + group.slice(1)}>
                <ul className="space-y-1 text-sm">
                  {items.map((r) => (
                    <li key={r.code} className="flex items-center justify-between gap-2">
                      <button type="button" className="text-left text-indigo-700 hover:underline" onClick={() => run(r)}>{r.title}</button>
                      {!r.implemented && <Badge value="pending" />}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
            {!list.data?.length && !list.loading && <p className="text-sm text-slate-500">Your role has no reports.</p>}
          </div>
          <div className="lg:col-span-2">
            <Card title={selected ? selected.title : 'Select a report'} actions={selected && <Button variant="secondary" onClick={() => run(selected)}>Re-run</Button>}>
              {busy && <Loading />}
              {error?.status === 501
                ? <p className="text-sm text-slate-600">This report needs data from the {selected?.source} module, which is not connected yet.</p>
                : <ErrorBanner error={error} />}
              {result && <Table columns={columns} rows={result.rows} empty="No data for this period" />}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
