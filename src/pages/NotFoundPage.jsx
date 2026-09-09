import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="auth-page">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div className="auth-header">
          <h1 style={{ fontSize: '3.5rem', marginBottom: '0.25rem', color: 'var(--color-text-muted)' }}>404</h1>
          <p className="auth-subtitle">The page you're looking for doesn't exist.</p>
        </div>
        <Link to="/" className="btn btn-primary">
          Go home
        </Link>
      </div>
    </div>
  );
}
