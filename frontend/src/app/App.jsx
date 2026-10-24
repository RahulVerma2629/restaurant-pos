import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './Layout.jsx';
import RequireAuth from '../modules/auth/RequireAuth.jsx';
import LoginPage from '../modules/auth/LoginPage.jsx';
import AccountPage from '../modules/auth/AccountPage.jsx';
import DashboardPage from '../modules/dashboards/DashboardPage.jsx';
import UsersPage from '../modules/users/UsersPage.jsx';
import ApprovalsPage from '../modules/rbac/ApprovalsPage.jsx';
import RolesPage from '../modules/rbac/RolesPage.jsx';
import AuditPage from '../modules/audit/AuditPage.jsx';
import ReportsPage from '../modules/reports/ReportsPage.jsx';

// Other interns: add your pages as extra <Route> entries inside the Layout route.
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="users" element={<RequireAuth permission="users.manage"><UsersPage /></RequireAuth>} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="roles" element={<RequireAuth permission="roles.manage"><RolesPage /></RequireAuth>} />
        <Route path="audit" element={<RequireAuth permission="audit.view"><AuditPage /></RequireAuth>} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="account" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
