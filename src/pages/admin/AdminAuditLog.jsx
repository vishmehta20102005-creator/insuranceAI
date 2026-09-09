import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchAllAuditLogsForAdmin, getCachedAuditLogs } from '../../lib/audit';
import ReviewSubmissionModal from '../../components/admin/ReviewSubmissionModal';

function StatusPill({ status }) {
  const cfg = {
    pending:      { cls: 'sub-badge-pending',      label: 'Pending' },
    processing:   { cls: 'sub-badge-processing',   label: 'Processing' },
    eligible:     { cls: 'sub-badge-eligible',     label: 'Eligible' },
    not_eligible: { cls: 'sub-badge-not_eligible', label: 'Not Eligible' },
    needs_review: { cls: 'sub-badge-needs_review', label: 'Needs Review' },
    approved:     { cls: 'sub-badge-approved',     label: 'Approved' },
    rejected:     { cls: 'sub-badge-rejected',     label: 'Rejected' },
  }[status] ?? { cls: '', label: status };

  return <span className={`sub-status-badge ${cfg.cls}`} style={{ fontSize: '0.75rem', padding: '2px 8px' }}>{cfg.label}</span>;
}

export default function AdminAuditLog() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const cached = getCachedAuditLogs();
  const [logs, setLogs] = useState(cached || []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState('');

  // Search and Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState('all'); // 'all', 'ai_verdict', 'admin_override'
  const [statusFilter, setStatusFilter] = useState('all');

  // Modal inspection
  const [selectedSub, setSelectedSub] = useState(null);
  const [isReviewOpen, setIsReviewOpen] = useState(false);

  useEffect(() => {
    loadLogs();
  }, []);

  async function loadLogs() {
    if (!getCachedAuditLogs()) setLoading(true);
    setError('');
    try {
      const data = await fetchAllAuditLogsForAdmin();
      setLogs(data || []);
    } catch (err) {
      if (!getCachedAuditLogs()) {
        setError(err.message || 'Failed to load audit logs.');
      }
    } finally {
      setLoading(false);
    }
  }

  // Filtered logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Action filter
      if (actionFilter !== 'all' && log.action !== actionFilter) return false;

      // Status filter
      if (statusFilter !== 'all' && log.new_status !== statusFilter) return false;

      // Search term
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const applicant = (log.client?.full_name || log.client?.email || '').toLowerCase();
        const policy = (log.policy?.name || '').toLowerCase();
        const performer = (log.performer?.full_name || log.performer?.email || '').toLowerCase();
        const reason = (log.reason || '').toLowerCase();

        return (
          applicant.includes(term) ||
          policy.includes(term) ||
          performer.includes(term) ||
          reason.includes(term)
        );
      }

      return true;
    });
  }, [logs, actionFilter, statusFilter, searchTerm]);

  // Aggregate stats
  const totalEvents = logs.length;
  const aiVerdicts = logs.filter((l) => l.action === 'ai_verdict').length;
  const adminOverrides = logs.filter((l) => l.action === 'admin_override').length;

  return (
    <div className="dashboard-layout">
      {/* Top Header */}
      <header className="dashboard-header">
        <div className="dashboard-header-inner">
          <div className="dashboard-brand">
            <Link to="/admin/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                <rect width="32" height="32" rx="8" fill="var(--color-accent)" />
                <path d="M16 6L22 10V18L16 26L10 18V10L16 6Z" fill="white" opacity="0.9" />
                <path d="M16 10L19 12.5V17.5L16 22L13 17.5V12.5L16 10Z" fill="var(--color-accent)" />
              </svg>
              <span className="dashboard-brand-name">InsuranceAI</span>
            </Link>
            <span className="role-badge role-badge-admin">Admin</span>
          </div>
          <div className="dashboard-user">
            <span className="dashboard-user-name">{profile?.full_name || profile?.email}</span>
            <button onClick={() => signOut().then(() => navigate('/login'))} className="btn btn-ghost btn-sm">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-container">
          {/* Navigation View Switcher (Unified across admin portal) */}
          <div className="admin-nav-tabs">
            <Link
              to="/admin/dashboard"
              className="admin-nav-tab"
              style={{ textDecoration: 'none' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Policy Management
            </Link>
            <Link
              to="/admin/dashboard?tab=submissions"
              className="admin-nav-tab"
              style={{ textDecoration: 'none' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <polyline points="17 11 19 13 23 9" />
              </svg>
              Client Submissions & Documents
            </Link>
            <div className="admin-nav-tab active">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Audit Log
            </div>
          </div>

          {/* Header Action */}
          <div className="dashboard-header-action" style={{ marginBottom: '24px' }}>
            <div className="dashboard-welcome" style={{ marginBottom: 0 }}>
              <h1>System Audit Log</h1>
              <p>
                Complete immutable record of all automated AI verdicts and manual administrator overrides across client applications.
              </p>
            </div>
            <button onClick={loadLogs} className="btn btn-ghost btn-sm" disabled={loading}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l6 5.67" />
              </svg>
              Refresh
            </button>
          </div>

          {/* Metrics Grid */}
          <div className="stats-grid" style={{ marginBottom: '24px' }}>
            <div className="stat-card">
              <div className="stat-label">Total Logged Events</div>
              <div className="stat-value">{totalEvents}</div>
              <div className="stat-note">AI decisions & manual overrides</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">AI Verdicts</div>
              <div className="stat-value" style={{ color: 'var(--color-accent)' }}>{aiVerdicts}</div>
              <div className="stat-note">Automated rule evaluations</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Manual Overrides</div>
              <div className="stat-value" style={{ color: '#2563eb' }}>{adminOverrides}</div>
              <div className="stat-note">Administrator updates with reasoning</div>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="table-controls-bar">
            <div className="search-input-wrapper">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="search-icon">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="table-search-input"
                placeholder="Search by applicant, policy, admin, or reason..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchTerm('')}
                  title="Clear search"
                >
                  ×
                </button>
              )}
            </div>

            <div className="table-filters-group">
              <select
                className="table-filter-select"
                value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
              >
                <option value="all">All Event Types</option>
                <option value="ai_verdict">AI Verdicts Only</option>
                <option value="admin_override">Admin Overrides Only</option>
              </select>

              <select
                className="table-filter-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Target Statuses</option>
                <option value="eligible">Eligible</option>
                <option value="not_eligible">Not Eligible</option>
                <option value="needs_review">Needs Review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>

              {(searchTerm || actionFilter !== 'all' || statusFilter !== 'all') && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setSearchTerm('');
                    setActionFilter('all');
                    setStatusFilter('all');
                  }}
                  style={{ fontSize: '0.8125rem' }}
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="form-error" style={{ marginBottom: '20px' }}>
              {error}
            </div>
          )}

          {/* Audit Log Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {loading ? (
              <div style={{ padding: '48px', textAlign: 'center' }}>
                <div className="spinner" style={{ width: '32px', height: '32px', margin: '0 auto 12px' }} />
                <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>Loading audit trail...</p>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                <p style={{ margin: 0, fontSize: '1rem' }}>No audit entries match your filters.</p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '155px' }}>Timestamp</th>
                      <th>Applicant & Policy</th>
                      <th style={{ width: '145px' }}>Action Type</th>
                      <th style={{ width: '190px' }}>Status Transition</th>
                      <th style={{ width: '150px' }}>Performed By</th>
                      <th>Reason / Justification</th>
                      <th style={{ width: '90px', textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLogs.map((log) => {
                      const isOverride = log.action === 'admin_override';
                      const applicantName = log.client?.full_name || log.client?.email || 'Applicant';
                      const applicantEmail = log.client?.email || '—';
                      const policyName = log.policy?.name || 'Policy';

                      return (
                        <tr key={log.id}>
                          {/* Timestamp */}
                          <td className="cell-muted" style={{ fontSize: '0.8125rem' }}>
                            <div>{new Date(log.created_at).toLocaleDateString()}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                              {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </div>
                          </td>

                          {/* Applicant & Policy */}
                          <td>
                            <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                              {applicantName}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                              {applicantEmail}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-accent)', marginTop: '2px', fontWeight: 500 }}>
                              {policyName}
                            </div>
                          </td>

                          {/* Action Type */}
                          <td>
                            <span className={`sub-status-badge ${isOverride ? 'badge-override' : 'badge-ai'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              {isOverride ? '⚡ Override' : '🤖 AI Verdict'}
                            </span>
                          </td>

                          {/* Status Transition */}
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              {log.previous_status ? (
                                <>
                                  <StatusPill status={log.previous_status} />
                                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>→</span>
                                </>
                              ) : null}
                              <StatusPill status={log.new_status} />
                            </div>
                          </td>

                          {/* Performed By */}
                          <td>
                            {isOverride ? (
                              <div>
                                <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--color-text-primary)' }}>
                                  {log.performer?.full_name || 'Administrator'}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                  {log.performer?.email || 'Admin User'}
                                </div>
                              </div>
                            ) : (
                              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <span>🤖</span> AI Pipeline
                              </span>
                            )}
                          </td>

                          {/* Reason */}
                          <td>
                            {log.reason ? (
                              <div className="audit-reason-bubble">
                                <div className="audit-reason-text">{log.reason}</div>
                              </div>
                            ) : (
                              <span className="cell-muted" style={{ fontSize: '0.8125rem', fontStyle: 'italic' }}>
                                Automated eligibility assessment
                              </span>
                            )}
                          </td>

                          {/* Action Button */}
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setSelectedSub({
                                  id: log.submission_id,
                                  status: log.new_status,
                                  policy: log.policy,
                                  client: log.client,
                                  submitted_at: log.client_submissions?.submitted_at,
                                });
                                setIsReviewOpen(true);
                              }}
                              title="Inspect application details"
                              style={{ padding: '6px 12px', fontSize: '0.8125rem', gap: '6px' }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                              Inspect
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Review Modal */}
      {selectedSub && (
        <ReviewSubmissionModal
          isOpen={isReviewOpen}
          onClose={() => {
            setIsReviewOpen(false);
            setSelectedSub(null);
          }}
          submission={selectedSub}
          onStatusUpdated={() => {
            loadLogs();
          }}
        />
      )}
    </div>
  );
}
