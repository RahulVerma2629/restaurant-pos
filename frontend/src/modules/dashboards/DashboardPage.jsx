import { api } from '../../services/api.js';
import { useFetch } from '../../services/useFetch.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { Card, ErrorBanner, Loading } from '../../components/ui.jsx';
import WidgetBody from './WidgetBody.jsx';

// The server decides which widgets this user may see (by role and permission).
export default function DashboardPage() {
  const { user, roles, mustChange } = useAuth();
  const { data, loading, error, reload } = useFetch(() => api('/dashboards/me'));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Welcome, {user.name}</h2>
          <p className="text-sm text-slate-500">{roles.join(', ')} dashboard</p>
        </div>
        <button type="button" onClick={reload} className="rounded-md px-3 py-1.5 text-sm ring-1 ring-slate-300 hover:bg-white">Refresh</button>
      </div>
      {mustChange && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          Your password was set by an administrator. Please change it under My account.
        </p>
      )}
      <ErrorBanner error={error} />
      {loading && !data && <Loading />}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data?.widgets.map((w) => (
          <Card key={w.code} title={w.title}>
            <WidgetBody widget={w} />
          </Card>
        ))}
      </div>
    </div>
  );
}
