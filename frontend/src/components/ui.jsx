// Small shared UI pieces so every page looks the same.
export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="font-semibold text-slate-800">{title}</h2>}
          <div className="flex gap-2">{actions}</div>
        </div>
      )}
      {children}
    </section>
  );
}

const VARIANTS = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700',
  secondary: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
};
export function Button({ variant = 'primary', className = '', ...props }) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
export const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

export function ErrorBanner({ error }) {
  if (!error) return null;
  const details = Array.isArray(error.details) ? error.details.map((d) => d.message).join(', ') : null;
  return (
    <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">
      {error.message}
      {details ? `: ${details}` : ''}
    </div>
  );
}

export function Notice({ children }) {
  if (!children) return null;
  return <div className="mb-3 rounded-md bg-emerald-50 p-3 text-sm text-emerald-700 ring-1 ring-emerald-200">{children}</div>;
}

const BADGES = {
  active: 'bg-emerald-100 text-emerald-700',
  approved: 'bg-emerald-100 text-emerald-700',
  inactive: 'bg-slate-200 text-slate-600',
  locked: 'bg-red-100 text-red-700',
  rejected: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
  used: 'bg-slate-200 text-slate-600',
};
export function Badge({ value }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGES[value] ?? 'bg-slate-100 text-slate-600'}`}>{value}</span>;
}

export const Loading = () => <p className="text-sm text-slate-500">Loading...</p>;

export function Table({ columns, rows, empty = 'Nothing to show' }) {
  if (!rows?.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            {columns.map((c) => <th key={c.header} className="px-2 py-2 font-medium">{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i} className="border-b border-slate-100 last:border-0">
              {columns.map((c) => <td key={c.header} className="px-2 py-2 align-top">{c.render ? c.render(row) : row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
