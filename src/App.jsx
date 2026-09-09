import { Routes, Route } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import RoleRedirect from './components/RoleRedirect';
import LoginPage from './pages/auth/LoginPage';
import SignUpPage from './pages/auth/SignUpPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import PolicyDetailsPage from './pages/admin/PolicyDetailsPage';
import AdminAuditLog from './pages/admin/AdminAuditLog';
import ClientPolicies from './pages/client/ClientPolicies';
import ClientPolicyDetail from './pages/client/ClientPolicyDetail';
import ClientAdvisor from './pages/client/ClientAdvisor';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login"  element={<LoginPage />} />
      <Route path="/signup" element={<SignUpPage />} />

      {/* Index: redirect to role-appropriate dashboard */}
      <Route path="/" element={<RoleRedirect />} />

      {/* Admin routes */}
      <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
        <Route path="/admin/dashboard"       element={<AdminDashboard />} />
        <Route path="/admin/policies/:id"    element={<PolicyDetailsPage />} />
        <Route path="/admin/audit-log"       element={<AdminAuditLog />} />
      </Route>

      {/* Client routes */}
      <Route element={<ProtectedRoute allowedRoles={['client']} />}>
        <Route path="/client/policies"       element={<ClientPolicies />} />
        <Route path="/client/policies/:id"   element={<ClientPolicyDetail />} />
        <Route path="/client/advisor"        element={<ClientAdvisor />} />
      </Route>

      {/* 404 */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

