import { Badge } from '../../components/ui.jsx';

// Widgets with live data show it. Others wait for the module that owns the data.
export default function WidgetBody({ widget }) {
  if (widget.status !== 'live') {
    return (
      <p className="text-sm text-slate-500">
        Waiting for the <span className="font-medium">{widget.source}</span> module to provide this data.
      </p>
    );
  }
  const data = widget.data ?? [];

  switch (widget.code) {
    case 'users.summary':
      return (
        <ul className="space-y-1 text-sm">
          {data.map((r) => (
            <li key={r.status} className="flex justify-between"><Badge value={r.status} /><span className="font-medium">{r.count}</span></li>
          ))}
        </ul>
      );
    case 'roles.summary':
      return (
        <ul className="space-y-1 text-sm">
          {data.map((r) => (
            <li key={r.name} className="flex justify-between"><span>{r.name}</span><span className="font-medium">{r.users} users</span></li>
          ))}
        </ul>
      );
    case 'audit.recent':
      return (
        <ul className="space-y-1 text-xs">
          {data.length === 0 && <li className="text-slate-500">No activity yet</li>}
          {data.map((r) => (
            <li key={r.id} className="flex justify-between gap-2">
              <span className="font-mono">{r.action}</span>
              <span className="text-slate-500">{new Date(r.createdAt).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      );
    case 'staff.activity':
      return (
        <ul className="space-y-1 text-xs">
          {data.length === 0 && <li className="text-slate-500">No activity today</li>}
          {data.map((r) => (
            <li key={`${r.userId}-${r.action}`} className="flex justify-between gap-2">
              <span>{r.name ?? `User ${r.userId}`}: <span className="font-mono">{r.action}</span></span>
              <span className="font-medium">{r.count}</span>
            </li>
          ))}
        </ul>
      );
    default:
      return <pre className="overflow-x-auto text-xs">{JSON.stringify(data, null, 2)}</pre>;
  }
}
