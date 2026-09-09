import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchAdminPolicies, deletePolicy, getCachedAdminPolicies } from '../../lib/policies';
import { fetchAllSubmissionsForAdmin, getCachedSubmissions } from '../../lib/submissions';
import CreatePolicyModal from '../../components/admin/CreatePolicyModal';
import ReviewSubmissionModal from '../../components/admin/ReviewSubmissionModal';

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

export default function AdminDashboard() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab');
  // Active top-level view: 'policies' | 'submissions'
  const [activeView, setActiveView] = useState(tabParam === 'submissions' ? 'submissions' : 'policies');

  useEffect(() => {
    if (tabParam === 'submissions') {
      setActiveView('submissions');
    } else if (tabParam === 'policies' || !tabParam) {
      setActiveView('policies');
    }
  }, [tabParam]);

  const cachedPolicies = getCachedAdminPolicies();
  const cachedSubs = getCachedSubmissions();

  // Policies state
  const [policies, setPolicies] = useState(cachedPolicies || []);
  const [loading, setLoading] = useState(!cachedPolicies);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'published', 'draft'
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  // Submissions state
  const [submissions, setSubmissions] = useState(cachedSubs || []);
  const [subsLoading, setSubsLoading] = useState(!cachedSubs);
  const [subStatusFilter, setSubStatusFilter] = useState('all'); // 'all', 'pending', 'approved', 'rejected'
  const [subSearch, setSubSearch] = useState('');
  const [selectedSub, setSelectedSub] = useState(null);
  const [isReviewOpen, setIsReviewOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    if (!getCachedAdminPolicies()) setLoading(true);
    if (!getCachedSubmissions()) setSubsLoading(true);
    setError('');

    try {
      const [policiesData, subsData] = await Promise.all([
        fetchAdminPolicies(),
        fetchAllSubmissionsForAdmin(),
      ]);
      setPolicies(policiesData || []);
      setSubmissions(subsData || []);
    } catch (err) {
      if (!getCachedAdminPolicies() && !getCachedSubmissions()) {
        setError(err.message || 'Failed to load dashboard data.');
      }
    } finally {
      setLoading(false);
      setSubsLoading(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  function handlePolicyCreated(newPolicy) {
    setIsModalOpen(false);
    navigate(`/admin/policies/${newPolicy.id}`);
  }

  async function handleDeletePolicy(e, id) {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this policy and its documents?')) {
      return;
    }

    setDeletingId(id);
    try {
      await deletePolicy(id);
      setPolicies((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      alert('Failed to delete policy: ' + err.message);
    } finally {
      setDeletingId(null);
    }
  }

  function handleOpenReview(sub) {
    setSelectedSub(sub);
    setIsReviewOpen(true);
  }

  function handleStatusUpdated(updatedSub) {
    setSubmissions((prev) =>
      prev.map((s) => (s.id === updatedSub.id ? { ...s, ...updatedSub } : s))
    );
    setSelectedSub((prev) => (prev?.id === updatedSub.id ? { ...prev, ...updatedSub } : prev));
  }

  // Filtered policies
  const filteredPolicies = policies.filter((p) => {
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    const matchesSearch =
      searchTerm.trim() === '' ||
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.description && p.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
      p.category.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  // Filtered submissions
  const filteredSubmissions = submissions.filter((s) => {
    const matchesStatus = subStatusFilter === 'all' || s.status === subStatusFilter;
    const term = subSearch.trim().toLowerCase();
    const clientName = (s.client?.full_name || '').toLowerCase();
    const clientEmail = (s.client?.email || '').toLowerCase();
    const policyName = (s.policy?.name || '').toLowerCase();
    const matchesSearch =
      term === '' ||
      clientName.includes(term) ||
      clientEmail.includes(term) ||
      policyName.includes(term);
    return matchesStatus && matchesSearch;
  });

  // Policies Stats
  const totalPolicies = policies.length;
  const publishedCount = policies.filter((p) => p.status === 'published').length;
  const draftCount = policies.filter((p) => p.status === 'draft').length;
  const totalDocsCount = policies.reduce((acc, p) => acc + (p.documentsCount || 0), 0);

  // Submissions Stats
  const totalSubsCount = submissions.length;
  const pendingSubsCount = submissions.filter((s) => s.status === 'pending').length;
  const approvedSubsCount = submissions.filter((s) => s.status === 'approved').length;
  const rejectedSubsCount = submissions.filter((s) => s.status === 'rejected').length;

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
            <span className="role-badge role-badge-admin">Admin</span>
          </div>
          <div className="dashboard-user">
            <span className="dashboard-user-name">{profile?.full_name || profile?.email}</span>
            <button onClick={handleSignOut} className="btn btn-ghost btn-sm">
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="dashboard-main">
        <div className="dashboard-container">

          {/* Navigation View Switcher */}
          <div className="admin-nav-tabs">
            <button
              className={`admin-nav-tab ${activeView === 'policies' ? 'active' : ''}`}
              onClick={() => {
                setActiveView('policies');
                setSearchParams({});
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              Policy Management
            </button>
            <button
              className={`admin-nav-tab ${activeView === 'submissions' ? 'active' : ''}`}
              onClick={() => {
                setActiveView('submissions');
                setSearchParams({ tab: 'submissions' });
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <polyline points="17 11 19 13 23 9" />
              </svg>
              Client Submissions & Documents
            </button>
            <Link
              to="/admin/audit-log"
              className="admin-nav-tab"
              style={{ textDecoration: 'none' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Audit Log
            </Link>
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

          {/* ══════════════════════════════════════════════════════════════
              VIEW 1: POLICIES MANAGEMENT
             ══════════════════════════════════════════════════════════════ */}
          {activeView === 'policies' && (
            <>
              {/* Welcome & Action */}
              <div className="dashboard-header-action">
                <div className="dashboard-welcome">
                  <h1>Policy Management</h1>
                  <p>Create and configure insurance policies, upload official rulebooks, and manage visibility.</p>
                </div>
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="btn btn-primary"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="8" y1="3" x2="8" y2="13" />
                    <line x1="3" y1="8" x2="13" y2="8" />
                  </svg>
                  New Policy
                </button>
              </div>

              {/* Stats Grid */}
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-label">Total Policies</div>
                  <div className="stat-value">{totalPolicies}</div>
                  <div className="stat-note">Across all categories</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Published</div>
                  <div className="stat-value">{publishedCount}</div>
                  <div className="stat-note">Live & accessible to clients</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Drafts</div>
                  <div className="stat-value">{draftCount}</div>
                  <div className="stat-note">In preparation (Admin only)</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Rule Documents</div>
                  <div className="stat-value">{totalDocsCount}</div>
                  <div className="stat-note">T&Cs, criteria & exclusions</div>
                </div>
              </div>

              {/* Controls Bar */}
              <div className="content-toolbar">
                <div className="filter-tabs">
                  <button
                    className={`filter-tab ${statusFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('all')}
                  >
                    All Policies ({totalPolicies})
                  </button>
                  <button
                    className={`filter-tab ${statusFilter === 'published' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('published')}
                  >
                    Published ({publishedCount})
                  </button>
                  <button
                    className={`filter-tab ${statusFilter === 'draft' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('draft')}
                  >
                    Drafts ({draftCount})
                  </button>
                </div>

                <div className="search-input-wrapper" style={{ flex: '0 1 300px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="search-icon">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search policies..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="table-search-input"
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
              </div>

              {/* Policies Table */}
              {loading ? (
                <div className="page-loader" style={{ minHeight: '200px' }}>
                  <div className="spinner" />
                </div>
              ) : filteredPolicies.length > 0 ? (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div className="table-responsive">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Policy Name</th>
                          <th>Category</th>
                          <th>Status</th>
                          <th>Rule Docs</th>
                          <th>Applications</th>
                          <th>Created</th>
                          <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPolicies.map((policy) => {
                          const policySubs = submissions.filter((s) => s.policy_id === policy.id);
                          const pendingPolicySubs = policySubs.filter((s) => s.status === 'pending').length;

                          return (
                            <tr
                              key={policy.id}
                              className="clickable-row"
                              onClick={() => navigate(`/admin/policies/${policy.id}`)}
                            >
                              <td>
                                <div className="policy-name-cell">
                                  <span className="policy-title">{policy.name}</span>
                                  {policy.description && (
                                    <span className="policy-desc-snippet">{policy.description}</span>
                                  )}
                                </div>
                              </td>
                              <td>
                                <span className={`badge-category badge-category-${policy.category}`}>
                                  {policy.category}
                                </span>
                              </td>
                              <td>
                                <span className={`badge-status badge-status-${policy.status}`}>
                                  {policy.status === 'published' ? '● Published' : '○ Draft'}
                                </span>
                              </td>
                              <td>
                                <span className="doc-count-pill">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                  </svg>
                                  {policy.documentsCount} {policy.documentsCount === 1 ? 'doc' : 'docs'}
                                </span>
                              </td>
                              <td>
                                {policySubs.length > 0 ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSubSearch(policy.name);
                                      setActiveView('submissions');
                                    }}
                                    className="doc-count-pill"
                                    style={{
                                      border: pendingPolicySubs > 0 ? '1px solid var(--color-warning-border)' : undefined,
                                      background: pendingPolicySubs > 0 ? 'var(--color-warning-bg)' : undefined,
                                      color: pendingPolicySubs > 0 ? 'var(--color-warning)' : undefined,
                                      cursor: 'pointer',
                                    }}
                                    title="View client submissions for this policy"
                                  >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                      <circle cx="9" cy="7" r="4" />
                                    </svg>
                                    {policySubs.length} applied
                                    {pendingPolicySubs > 0 && ` (${pendingPolicySubs} new)`}
                                  </button>
                                ) : (
                                  <span className="cell-muted" style={{ fontSize: '0.8125rem' }}>0 applied</span>
                                )}
                              </td>
                              <td className="cell-muted">
                                {new Date(policy.created_at).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                })}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <div className="table-row-actions" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => navigate(`/admin/policies/${policy.id}`)}
                                    className="btn btn-ghost btn-sm"
                                    title="Manage documents & details"
                                  >
                                    Manage
                                  </button>
                                  <button
                                    onClick={(e) => handleDeletePolicy(e, policy.id)}
                                    className="btn btn-danger-ghost btn-sm"
                                    disabled={deletingId === policy.id}
                                    title="Delete policy"
                                  >
                                    {deletingId === policy.id ? 'Deleting...' : 'Delete'}
                                  </button>
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
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="12" y1="18" x2="12" y2="12" />
                      <line x1="9" y1="15" x2="15" y2="15" />
                    </svg>
                  </div>
                  <h3>{searchTerm ? 'No matching policies' : 'No policies yet'}</h3>
                  <p>
                    {searchTerm
                      ? 'Try adjusting your search query or filter criteria.'
                      : 'Get started by creating your first insurance policy and uploading its official documents.'}
                  </p>
                  {!searchTerm && (
                    <button
                      onClick={() => setIsModalOpen(true)}
                      className="btn btn-primary btn-sm"
                      style={{ marginTop: '16px' }}
                    >
                      Create Policy
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════
              VIEW 2: CLIENT SUBMISSIONS & DOCUMENTS
             ══════════════════════════════════════════════════════════════ */}
          {activeView === 'submissions' && (
            <>
              {/* Header */}
              <div className="dashboard-welcome">
                <h1>Client Submissions & Verification Documents</h1>
                <p>
                  Review documents uploaded by applicants (ID proof, medical reports, income proof, age proof)
                  and approve or reject client applications.
                </p>
              </div>

              {/* Stats Grid */}
              <div className="stats-grid">
                <div className="stat-card">
                  <div className="stat-label">Total Applications</div>
                  <div className="stat-value">{totalSubsCount}</div>
                  <div className="stat-note">Across all policies</div>
                </div>
                <div className="stat-card" style={{ borderLeft: '3px solid var(--color-warning)' }}>
                  <div className="stat-label">Pending Review</div>
                  <div className="stat-value" style={{ color: 'var(--color-warning)' }}>{pendingSubsCount}</div>
                  <div className="stat-note">Awaiting admin review</div>
                </div>
                <div className="stat-card" style={{ borderLeft: '3px solid var(--color-success)' }}>
                  <div className="stat-label">Approved</div>
                  <div className="stat-value" style={{ color: 'var(--color-success)' }}>{approvedSubsCount}</div>
                  <div className="stat-note">Eligible & verified</div>
                </div>
                <div className="stat-card" style={{ borderLeft: '3px solid var(--color-error)' }}>
                  <div className="stat-label">Rejected</div>
                  <div className="stat-value" style={{ color: 'var(--color-error)' }}>{rejectedSubsCount}</div>
                  <div className="stat-note">Documents failed criteria</div>
                </div>
              </div>

              {/* Submissions Controls Bar */}
              <div className="content-toolbar">
                <div className="filter-tabs">
                  <button
                    className={`filter-tab ${subStatusFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setSubStatusFilter('all')}
                  >
                    All ({totalSubsCount})
                  </button>
                  <button
                    className={`filter-tab ${subStatusFilter === 'pending' ? 'active' : ''}`}
                    onClick={() => setSubStatusFilter('pending')}
                  >
                    Pending ({pendingSubsCount})
                  </button>
                  <button
                    className={`filter-tab ${subStatusFilter === 'approved' ? 'active' : ''}`}
                    onClick={() => setSubStatusFilter('approved')}
                  >
                    Approved ({approvedSubsCount})
                  </button>
                  <button
                    className={`filter-tab ${subStatusFilter === 'rejected' ? 'active' : ''}`}
                    onClick={() => setSubStatusFilter('rejected')}
                  >
                    Rejected ({rejectedSubsCount})
                  </button>
                </div>

                <div className="search-input-wrapper" style={{ flex: '0 1 300px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="search-icon">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search applicant or policy..."
                    value={subSearch}
                    onChange={(e) => setSubSearch(e.target.value)}
                    className="table-search-input"
                  />
                  {subSearch && (
                    <button
                      type="button"
                      className="search-clear-btn"
                      onClick={() => setSubSearch('')}
                      title="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* Submissions Table */}
              {subsLoading ? (
                <div className="page-loader" style={{ minHeight: '200px' }}>
                  <div className="spinner" />
                </div>
              ) : filteredSubmissions.length > 0 ? (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div className="table-responsive">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Applicant</th>
                          <th>Policy Applied</th>
                          <th>Status</th>
                          <th>Submitted Docs</th>
                          <th>Submitted Date</th>
                          <th style={{ textAlign: 'right' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSubmissions.map((sub) => {
                          const clientName = sub.client?.full_name || sub.client?.email || 'Unknown Client';
                          const clientEmail = sub.client?.email;
                          const docs = sub.documents || [];

                          return (
                            <tr
                              key={sub.id}
                              className="clickable-row"
                              onClick={() => handleOpenReview(sub)}
                            >
                              <td>
                                <div className="policy-name-cell">
                                  <span className="policy-title">{clientName}</span>
                                  {clientEmail && (
                                    <span className="policy-desc-snippet">{clientEmail}</span>
                                  )}
                                </div>
                              </td>

                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
                                    {sub.policy?.name || '—'}
                                  </span>
                                  {sub.policy?.category && (
                                    <span className={`badge-category badge-category-${sub.policy.category}`}>
                                      {sub.policy.category}
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td>
                                <SubmissionStatusBadge status={sub.status} />
                              </td>

                              <td>
                                <span className="doc-count-pill" title="Click Review to view submitted documents">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                    <polyline points="14 2 14 8 20 8" />
                                  </svg>
                                  {docs.length} {docs.length === 1 ? 'doc' : 'docs'}
                                </span>
                              </td>

                              <td className="cell-muted">
                                {new Date(sub.submitted_at).toLocaleDateString(undefined, {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </td>

                              <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  onClick={() => handleOpenReview(sub)}
                                  className="btn btn-primary btn-sm"
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                  Review Documents
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="8.5" cy="7" r="4" />
                      <polyline points="17 11 19 13 23 9" />
                    </svg>
                  </div>
                  <h3>{subSearch || subStatusFilter !== 'all' ? 'No matching submissions' : 'No submissions yet'}</h3>
                  <p>
                    {subSearch || subStatusFilter !== 'all'
                      ? 'Try adjusting your search query or status filter.'
                      : 'When clients apply for published policies and upload their verification documents, they will appear here for review.'}
                  </p>
                </div>
              )}
            </>
          )}

        </div>
      </main>

      {/* Creation Modal */}
      <CreatePolicyModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onPolicyCreated={handlePolicyCreated}
      />

      {/* Submission Review Modal */}
      <ReviewSubmissionModal
        isOpen={isReviewOpen}
        onClose={() => setIsReviewOpen(false)}
        submission={selectedSub}
        onStatusUpdated={handleStatusUpdated}
      />
    </div>
  );
}
