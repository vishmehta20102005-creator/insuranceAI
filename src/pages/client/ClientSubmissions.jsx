import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchClientSubmissions } from '../../lib/submissions';

function SubmissionStatusBadge({ status }) {
  const cfg = {
    pending:      { cls: 'sub-badge-pending',      label: '⏳ Pending Review' },
    processing:   { cls: 'sub-badge-processing',   label: 'Processing...' },
    eligible:     { cls: 'sub-badge-eligible',     label: 'Eligible' },
    not_eligible: { cls: 'sub-badge-not_eligible', label: 'Not Eligible' },
    needs_review: { cls: 'sub-badge-needs_review', label: 'Needs Review' },
    approved:     { cls: 'sub-badge-approved',     label: '✓ Approved' },
    rejected:     { cls: 'sub-badge-rejected',     label: '✗ Rejected' },
  }[status] ?? { cls: '', label: status };
  return <span className={`sub-status-badge ${cfg.cls}`}>{cfg.label}</span>;
}

export default function ClientSubmissions() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const [submissions, setSubmissions] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [filterTab,   setFilterTab]   = useState('all');
  const [searchTerm,  setSearchTerm]  = useState('');

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const subs = await fetchClientSubmissions(user.id);
        setSubmissions(subs || []);
      } catch (err) {
        setError(err.message || 'Failed to load submissions.');
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  // Group submissions by policy_id to determine each policy's current latest standing
  // (submissions are returned sorted by submitted_at DESC)
  const latestSubmissionByPolicy = {};
  submissions.forEach((sub) => {
    if (!latestSubmissionByPolicy[sub.policy_id]) {
      latestSubmissionByPolicy[sub.policy_id] = sub;
    }
  });

  const latestList = Object.values(latestSubmissionByPolicy);

  // Summary counts based on current active policy standing
  const totalCount    = submissions.length;
  const approvedCount = latestList.filter((s) => ['approved', 'eligible'].includes(s.status)).length;
  const pendingCount  = latestList.filter((s) => ['pending', 'processing'].includes(s.status)).length;
  const actionCount   = latestList.filter((s) => ['needs_review', 'not_eligible', 'rejected'].includes(s.status)).length;

  // Filtered submissions
  const filteredSubmissions = submissions.filter((sub) => {
    const latestForThisPolicy = latestSubmissionByPolicy[sub.policy_id];
    const isLatest = latestForThisPolicy?.id === sub.id;
    const policyApproved = ['approved', 'eligible'].includes(latestForThisPolicy?.status);
    const policyInReview = ['pending', 'processing'].includes(latestForThisPolicy?.status);

    // Tab filter
    if (filterTab === 'approved' && !['approved', 'eligible'].includes(sub.status)) return false;
    if (filterTab === 'pending' && !['pending', 'processing'].includes(sub.status)) return false;
    if (filterTab === 'action') {
      // ONLY show submissions where action is currently needed (ignore superseded older attempts)
      if (!isLatest || policyApproved || policyInReview || !['needs_review', 'not_eligible', 'rejected'].includes(sub.status)) {
        return false;
      }
    }

    // Search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const polName = sub.policy?.name?.toLowerCase() || '';
      const catName = sub.policy?.category?.toLowerCase() || '';
      return polName.includes(term) || catName.includes(term);
    }
    return true;
  });

  return (
    <div className="dashboard-layout">
      {/* Header */}
      <header className="dashboard-header">
        <div className="dashboard-header-inner">
          <div className="dashboard-brand">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="var(--color-accent)" />
              <path d="M16 6L22 10V18L16 26L10 18V10L16 6Z" fill="white" opacity="0.9" />
              <path d="M16 10L19 12.5V17.5L16 22L13 17.5V12.5L16 10Z" fill="var(--color-accent)" />
            </svg>
            <span className="dashboard-brand-name">InsuranceAI</span>
          </div>

          <div className="advisor-header-nav">
            <Link to="/client/policies" className="advisor-nav-link">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="9" x2="15" y2="9" />
                <line x1="9" y1="13" x2="15" y2="13" />
                <line x1="9" y1="17" x2="13" y2="17" />
              </svg>
              <span>Browse Policies</span>
            </Link>
            <Link to="/client/submissions" className="advisor-nav-link active">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <span>My Submissions</span>
            </Link>
            <Link to="/client/advisor" className="advisor-nav-link">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>AI Advisor</span>
            </Link>
          </div>

          <div className="dashboard-user">
            <span className="dashboard-user-name">{profile?.full_name || profile?.email}</span>
            <button onClick={handleSignOut} className="btn btn-ghost btn-sm">Sign out</button>
          </div>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-container">

          {/* Welcome section */}
          <div className="dashboard-welcome">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
              <div>
                <h1>My Policy Applications</h1>
                <p>Track the real-time review status, verified criteria, and submitted documents for all your applications.</p>
              </div>
              <Link to="/client/policies" className="btn btn-primary btn-sm">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Apply for New Policy</span>
              </Link>
            </div>
          </div>

          {error && (
            <div className="form-error" style={{ marginBottom: '20px' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {error}
            </div>
          )}

          {/* Metric Summary Cards */}
          <div className="stats-grid" style={{ marginBottom: '28px' }}>
            <div className="card stat-card">
              <div className="stat-card-inner">
                <div>
                  <span className="stat-label">Total Applications</span>
                  <div className="stat-value">{totalCount}</div>
                </div>
                <div className="stat-icon-wrapper" style={{ background: 'var(--color-surface-sunken)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
              </div>
              <div className="stat-note">Across {latestList.length} {latestList.length === 1 ? 'policy' : 'policies'}</div>
            </div>

            <div className="card stat-card">
              <div className="stat-card-inner">
                <div>
                  <span className="stat-label">Approved & Eligible</span>
                  <div className="stat-value" style={{ color: 'var(--color-success, #16a34a)' }}>{approvedCount}</div>
                </div>
                <div className="stat-icon-wrapper" style={{ background: 'rgba(22, 163, 74, 0.1)', color: 'var(--color-success, #16a34a)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              </div>
              <div className="stat-note">Active coverage confirmed</div>
            </div>

            <div className="card stat-card">
              <div className="stat-card-inner">
                <div>
                  <span className="stat-label">Under Review</span>
                  <div className="stat-value" style={{ color: 'var(--color-warning, #d97706)' }}>{pendingCount}</div>
                </div>
                <div className="stat-icon-wrapper" style={{ background: 'rgba(217, 119, 6, 0.1)', color: 'var(--color-warning, #d97706)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
              </div>
              <div className="stat-note">In underwriting evaluation</div>
            </div>

            <div className="card stat-card">
              <div className="stat-card-inner">
                <div>
                  <span className="stat-label">Action Required</span>
                  <div className="stat-value" style={{ color: actionCount > 0 ? 'var(--color-error, #dc2626)' : 'inherit' }}>
                    {actionCount}
                  </div>
                </div>
                <div className="stat-icon-wrapper" style={{ background: actionCount > 0 ? 'rgba(220, 38, 38, 0.1)' : 'var(--color-surface-sunken)', color: actionCount > 0 ? 'var(--color-error, #dc2626)' : 'var(--color-text-muted)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
              </div>
              <div className="stat-note">{actionCount === 0 ? 'All applications up to date' : 'Document updates needed'}</div>
            </div>
          </div>

          {/* Filter tabs & Search */}
          <div className="content-toolbar">
            <div className="filter-tabs">
              <button
                className={`filter-tab ${filterTab === 'all' ? 'active' : ''}`}
                onClick={() => setFilterTab('all')}
              >
                All ({totalCount})
              </button>
              <button
                className={`filter-tab ${filterTab === 'approved' ? 'active' : ''}`}
                onClick={() => setFilterTab('approved')}
              >
                Approved ({approvedCount})
              </button>
              <button
                className={`filter-tab ${filterTab === 'pending' ? 'active' : ''}`}
                onClick={() => setFilterTab('pending')}
              >
                In Review ({pendingCount})
              </button>
              {actionCount > 0 && (
                <button
                  className={`filter-tab ${filterTab === 'action' ? 'active' : ''}`}
                  onClick={() => setFilterTab('action')}
                >
                  Action Required ({actionCount})
                </button>
              )}
            </div>

            <div className="toolbar-search">
              <input
                type="text"
                placeholder="Search submissions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
            </div>
          </div>

          {/* Submissions Table / Empty state */}
          {loading ? (
            <div className="page-loader" style={{ minHeight: '200px' }}>
              <div className="spinner" />
            </div>
          ) : filteredSubmissions.length > 0 ? (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Policy Name</th>
                      <th>Category</th>
                      <th>Documents</th>
                      <th>Status</th>
                      <th>Submitted Date</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSubmissions.map((sub) => {
                      const latestForThisPolicy = latestSubmissionByPolicy[sub.policy_id];
                      const isLatest = latestForThisPolicy?.id === sub.id;
                      const policyApproved = ['approved', 'eligible'].includes(latestForThisPolicy?.status);
                      const policyInReview = ['pending', 'processing'].includes(latestForThisPolicy?.status);

                      // Can this submission prompt Reapply?
                      // Strictly ONLY if it is the latest submission for this policy, the policy is NOT approved,
                      // NOT in review, and its status is rejected/not_eligible/needs_review.
                      const canReapply = isLatest && !policyApproved && !policyInReview && ['rejected', 'not_eligible', 'needs_review'].includes(sub.status);

                      return (
                        <tr
                          key={sub.id}
                          style={{
                            opacity: !isLatest && policyApproved ? 0.8 : 1,
                          }}
                        >
                          <td>
                            <div className="policy-name-cell">
                              <span className="policy-title">{sub.policy?.name ?? '—'}</span>
                            </div>
                          </td>

                          <td>
                            {sub.policy?.category && (
                              <span className={`badge-category badge-category-${sub.policy.category}`}>
                                {sub.policy.category}
                              </span>
                            )}
                          </td>

                          <td>
                            <span className="doc-count-pill">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                              </svg>
                              {sub.docsCount} {sub.docsCount === 1 ? 'doc' : 'docs'}
                            </span>
                          </td>

                          <td>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <SubmissionStatusBadge status={sub.status} />
                              {!isLatest && (
                                <span
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    padding: '2px 7px',
                                    borderRadius: '4px',
                                    background: policyApproved ? 'rgba(22, 163, 74, 0.08)' : 'var(--color-surface-sunken)',
                                    color: policyApproved ? 'var(--color-success, #16a34a)' : 'var(--color-text-muted)',
                                    border: '1px solid ' + (policyApproved ? 'rgba(22, 163, 74, 0.2)' : 'var(--color-border)'),
                                  }}
                                >
                                  {policyApproved ? 'Resolved (Approved)' : 'Previous Attempt'}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="cell-muted">
                            {new Date(sub.submitted_at).toLocaleDateString(undefined, {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </td>

                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
                              <Link
                                to={`/client/submissions/${sub.id}`}
                                className="btn btn-sm btn-ghost"
                              >
                                View Details
                              </Link>
                              {canReapply && (
                                <Link
                                  to={`/client/policies/${sub.policy_id}`}
                                  className="btn btn-sm btn-primary"
                                >
                                  Reapply
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '48px 24px', background: 'var(--color-surface)', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
              <div className="empty-state-icon">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <rect x="8" y="6" width="32" height="36" rx="4" stroke="var(--color-text-muted)" strokeWidth="2" />
                  <path d="M16 16h16M16 22h16M16 28h10" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <h3>
                {searchTerm || filterTab !== 'all'
                  ? 'No matching submissions found'
                  : 'No policy applications yet'}
              </h3>
              <p style={{ maxWidth: '440px', margin: '8px auto 20px' }}>
                {searchTerm || filterTab !== 'all'
                  ? 'Try adjusting your search query or switching the status filter.'
                  : 'You have not submitted any policy applications yet. Browse our available insurance categories and policies to get started.'}
              </p>
              {searchTerm || filterTab !== 'all' ? (
                <button
                  type="button"
                  onClick={() => { setSearchTerm(''); setFilterTab('all'); }}
                  className="btn btn-secondary btn-sm"
                >
                  Clear Filters
                </button>
              ) : (
                <Link to="/client/policies" className="btn btn-primary">
                  Browse Available Policies
                </Link>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
