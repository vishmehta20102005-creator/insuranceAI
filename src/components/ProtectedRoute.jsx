import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * Wraps routes that require authentication.
 * Optionally restricts access to specific roles.
 *
 *   <Route element={<ProtectedRoute allowedRoles={['admin']} />}>
 *     <Route path="/admin/dashboard" element={<AdminDashboard />} />
 *   </Route>
 */
export default function ProtectedRoute({ allowedRoles }) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="page-loader">
        <div className="spinner" />
      </div>
    );
  }

  /* Not logged in → send to login */
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  /* Still waiting for profile to resolve (edge case) */
  if (!profile) {
    return (
      <div className="page-loader">
        <div className="spinner" />
      </div>
    );
  }

  /* Role check */
  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    /* Redirect to the correct dashboard for their role */
    const dest = profile.role === 'admin' ? '/admin/dashboard' : '/client/policies';
    return <Navigate to={dest} replace />;
  }

  return <Outlet />;
}
