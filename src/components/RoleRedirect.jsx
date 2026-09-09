import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * Redirects an authenticated user to their role-appropriate dashboard.
 * If not authenticated, sends them to /login.
 * Used on the "/" index route.
 */
export default function RoleRedirect() {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="page-loader">
        <div className="spinner" />
      </div>
    );
  }

  if (!user || !profile) {
    return <Navigate to="/login" replace />;
  }

  if (profile.role === 'admin') {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return <Navigate to="/client/policies" replace />;
}
