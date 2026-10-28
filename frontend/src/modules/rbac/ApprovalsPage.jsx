import { useState } from 'react';
import { api } from '../../services/api.js';
import { useFetch } from '../../services/useFetch.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Badge, Button, Card, ErrorBanner, Field, Loading, Notice, Table, inputClass } from '../../components/ui.jsx';

// Cashiers/waiters request an override here. Managers approve or reject it.
export default function ApprovalsPage() {
  const { can } = useAuth();
  const canDecide = can('approvals.decide');
  const canRequest = can('discounts.apply') || can('refunds.process');
  const pending = useFetch(() => (canDecide ? api('/approvals', { query: { status: 'pending' } }) : Promise.resolve([])));
  const [form, setForm] = useState({ action: can('discounts.apply') ? 'DISCOUNT' : 'REFUND', value: '', reason: '' });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function request(e) {
    e.preventDefault();
    setError(null);
    setNotice('');
    try {
      const a = await api('/approvals', { method: 'POST', body: { action: form.action, value: Number(form.value), reason: form.reason } });
      setNotice(`Request #${a.id} sent. Once a manager approves it, use approval ID ${a.id} when applying the ${form.action.toLowerCase()}.`);
      setForm((f) => ({ ...f, value: '', reason: '' }));
    } catch (err) {
      setError(err);
    }
  }

  async function decide(a, approve) {
    const reason = window.prompt(approve ? 'Note (optional):' : 'Reason for rejecting:') ?? '';
    if (!approve && !reason) return;
    setError(null);
    try {
      await api(`/approvals/${a.id}/decide`, { method: 'POST', body: { approve, reason: reason || undefined } });
      pending.reload();
    } catch (err) {
      setError(err);
    }
  }

  const columns = [
    { header: 'ID', key: 'id' },
    { header: 'Requested by', render: (a) => a.requester?.name },
    { header: 'Type', key: 'action' },
    { header: 'For', render: (a) => (a.payload.value == null ? (a.payload.entityId ? `#${a.payload.entityId}` : '') : a.action === 'DISCOUNT' ? `${a.payload.value}%` : `Rs ${a.payload.value}`) },
    { header: 'Reason', key: 'reason' },
    { header: 'Status', render: (a) => <Badge value={a.status} /> },
    {
      header: '',
      render: (a) => (
        <div className="flex gap-1">
          <Button variant="success" onClick={() => decide(a, true)}>Approve</Button>
          <Button variant="danger" onClick={() => decide(a, false)}>Reject</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Approvals</h2>
      <ErrorBanner error={error || pending.error} />
      <Notice>{notice}</Notice>

      {canRequest && (
        <Card title="Request manager approval">
          <form onSubmit={request} className="grid gap-3 sm:grid-cols-4">
            <Field label="Type">
              <select className={inputClass} value={form.action} onChange={set('action')}>
                {can('discounts.apply') && <option value="DISCOUNT">Discount (%)</option>}
                {can('refunds.process') && <option value="REFUND">Refund (amount)</option>}
              </select>
            </Field>
            <Field label="Value"><input className={inputClass} type="number" min="0.01" step="any" value={form.value} onChange={set('value')} required /></Field>
            <Field label="Reason"><input className={inputClass} value={form.reason} onChange={set('reason')} required /></Field>
            <div className="flex items-end"><Button type="submit">Send request</Button></div>
          </form>
        </Card>
      )}

      {canDecide && (
        <Card title="Waiting for a decision">
          {pending.loading && !pending.data ? <Loading /> : <Table columns={columns} rows={pending.data} empty="No pending requests" />}
        </Card>
      )}
      {!canRequest && !canDecide && <p className="text-sm text-slate-500">Your role has no approval actions.</p>}
    </div>
  );
}
