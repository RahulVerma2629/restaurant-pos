import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../modules/auth/AuthContext.jsx';

// Each menu item appears only if the user holds its permission (null = everyone).
const MENU = [
  { to: '/', label: 'Dashboard', permission: null, end: true },
  { to: '/users', label: 'Users', permission: 'users.manage' },
  { to: '/approvals', label: 'Approvals', permission: null },
  { to: '/roles', label: 'Roles & permissions', permission: 'roles.manage' },
  { to: '/audit', label: 'Audit log', permission: 'audit.view' },
  { to: '/reports', label: 'Reports', permission: null },
  { to: '/account', label: 'My account', permission: null },
];

export default function Layout() {
  const { user, roles, can, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen md:flex">
      <aside className="bg-slate-900 p-4 text-slate-100 md:w-60 md:shrink-0">
        <h1 className="mb-4 text-lg font-semibold">Restaurant POS</h1>
        <nav className="flex flex-wrap gap-1 md:flex-col">
          {MENU.filter((m) => !m.permission || can(m.permission)).map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.end}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm ${isActive ? 'bg-indigo-600' : 'hover:bg-slate-800'}`}
            >
              {m.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <p className="text-sm">
            <span className="font-medium">{user.name}</span>
            <span className="ml-2 text-slate-500">{roles.join(', ')}</span>
          </p>
          <button
            type="button"
            className="rounded-md px-3 py-1 text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
            onClick={async () => { await logout(); navigate('/login'); }}
          >
            Log out
          </button>
        </header>
        <main className="p-4"><Outlet /></main>
      </div>
    </div>
  );
}
