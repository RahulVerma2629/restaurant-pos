import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

// Wrap a page: <RequireAuth permission="users.manage"><UsersPage/></RequireAuth>
// The server enforces permissions too; this only hides pages the user cannot use.
export default function RequireAuth({ permission, children }) {
  const { ready, user, can } = useAuth();
  const location = useLocation();
  if (!ready) return <p className="p-6 text-sm text-slate-500">Loading...</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (permission && !can(permission)) {
    return <p className="rounded-md bg-amber-50 p-4 text-sm text-amber-800">You do not have permission to view this page.</p>;
  }
  return children;
}
