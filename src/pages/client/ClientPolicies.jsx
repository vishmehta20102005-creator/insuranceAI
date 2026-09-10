import { useState, useEffect, Fragment } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchPublishedPolicies, getDocumentSignedUrl } from '../../lib/policies';
import { fetchClientSubmissions } from '../../lib/submissions';
import { supabase } from '../../lib/supabase';

function SubmissionStatusBadge({ status }) {
  const cfg = {
    pending:      { cls: 'sub-badge-pending',      label: '⏳ Pending' },
    processing:   { cls: 'sub-badge-processing',   label: 'Processing...' },
    eligible:     { cls: 'sub-badge-eligible',     label: 'Eligible' },
    not_eligible: { cls: 'sub-badge-not_eligible', label: 'Not Eligible' },
    needs_review: { cls: 'sub-badge-needs_review', label: 'Needs Review' },
    approved:     { cls: 'sub-badge-approved',     label: '✓ Approved' },
    rejected:     { cls: 'sub-badge-rejected',     label: '✗ Rejected' },
  }[status] ?? { cls: '', label: status };
  return <span className={`sub-status-badge ${cfg.cls}`}>{cfg.label}</span>;
}

export default function ClientPolicies() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const [policies,     setPolicies]     = useState([]);
  const [submissions,  setSubmissions]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [searchTerm,   setSearchTerm]   = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  // expandable policy docs
  const [expandedId,  setExpandedId]  = useState(null);
  const [policyDocs,  setPolicyDocs]  = useState({});
  const [docsLoading, setDocsLoading] = useState({});
  const [viewingDocId, setViewingDocId] = useState(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [pols, subs] = await Promise.all([
          fetchPublishedPolicies(),
          fetchClientSubmissions(user.id),
        ]);
        setPolicies(pols);
        setSubmissions(subs);
      } catch (err) {
        setError(err.message || 'Failed to load data.');
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  async function handleTogglePolicy(policyId) {
    if (expandedId === policyId) { setExpandedId(null); return; }
    setExpandedId(policyId);
    if (policyDocs[policyId]) return;

    setDocsLoading((prev) => ({ ...prev, [policyId]: true }));
    try {
      const { data, error: err } = await supabase
        .from('policy_documents')
        .select('*')
        .eq('policy_id', policyId)
        .order('uploaded_at', { ascending: true });
      if (err) throw err;
      setPolicyDocs((prev) => ({ ...prev, [policyId]: data || [] }));
    } catch {
      setPolicyDocs((prev) => ({ ...prev, [policyId]: [] }));
    } finally {
      setDocsLoading((prev) => ({ ...prev, [policyId]: false }));
    }
  }

  async function handleViewDocument(doc) {
    setViewingDocId(doc.id);
    try {
      const url = await getDocumentSignedUrl(doc.file_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      alert('Could not open document: ' + err.message);
    } finally {
      setViewingDocId(null);
    }
  }

  function renderDocTypeBadge(type) {
    const map = {
      terms_and_conditions: ['doc-tag-tc',         'Terms & Conditions'],
      eligibility_criteria: ['doc-tag-criteria',   'Eligibility Criteria'],
      exclusions:           ['doc-tag-exclusions',  'Exclusions'],
    };
    const [cls, label] = map[type] ?? ['doc-tag-other', 'Other'];
    return <span className={`doc-tag ${cls}`}>{label}</span>;
  }

  function formatFileSize(bytes) {
    if (!bytes) return '—';
    const kb = bytes / 1024;
    return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`;
  }

  const categories = ['all', ...new Set(policies.map((p) => p.category))];
  const filteredPolicies = policies.filter((p) => {
    const matchesCat    = categoryFilter === 'all' || p.category === categoryFilter;
    const matchesSearch =
      searchTerm.trim() === '' ||
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.description && p.description.toLowerCase().includes(searchTerm.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  const categoryGroups = Object.values(
    filteredPolicies.reduce((acc, policy) => {
      const catName = policy.category || 'General Insurance';
      if (!acc[catName]) {
        acc[catName] = {
          name: catName,
          description: policy.policy_categories?.description || null,
          policies: [],
        };
      }
      acc[catName].policies.push(policy);
      return acc;
    }, {})
  );

  return (
    <div className="dashboard-layout">
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
            <Link to="/client/policies" className="advisor-nav-link active">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="9" x2="15" y2="9" />
                <line x1="9" y1="13" x2="15" y2="13" />
                <line x1="9" y1="17" x2="13" y2="17" />
              </svg>
              <span>Browse Policies</span>
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

          {/* ── Advisor Banner ── */}
          <div className="advisor-promo-banner">
            <div className="advisor-promo-content">
              <div className="advisor-promo-badge">AI Assistant</div>
              <h3>Unsure which policy best fits your profile?</h3>
              <p>Chat with our interactive AI Advisor or upload a document to get instant, personalized policy recommendations.</p>
            </div>
            <Link to="/client/advisor" className="btn btn-primary advisor-promo-btn">
              <span>Open Policy Advisor</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
          </div>

          {/* ── Available Policies ── */}
          <div className="dashboard-welcome">
            <h1>Available Policies</h1>
            <p>Browse published insurance policies grouped by category. Click a policy row to preview official documents, or click <strong>Apply</strong> to start your application.</p>
          </div>

          <div className="content-toolbar">
            <div className="filter-tabs">
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={`filter-tab ${categoryFilter === cat ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat === 'all' ? `All (${policies.length})` : cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              ))}
            </div>
            <div className="toolbar-search">
              <input
                type="text"
                placeholder="Search policies..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
              />
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

          {loading ? (
            <div className="page-loader" style={{ minHeight: '200px' }}>
              <div className="spinner" />
            </div>
          ) : categoryGroups.length > 0 ? (
            <div className="policy-category-groups">
              {categoryGroups.map((group) => (
                <div key={group.name} className="policy-category-group" style={{ marginBottom: '36px' }}>
                  {/* Category Header */}
                  <div className="policy-category-header" style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    marginBottom: '12px',
                    paddingBottom: '8px',
                    borderBottom: '2px solid var(--color-border)',
                  }}>
                    <div>
                      <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>{group.name}</span>
                        <span className="badge-category" style={{ fontSize: '11px', fontWeight: 600 }}>
                          {group.policies.length} {group.policies.length === 1 ? 'Policy' : 'Policies'}
                        </span>
                      </h2>
                      {group.description && (
                        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                          {group.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Category Policies Table */}
                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div className="table-responsive">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th style={{ width: '36px' }} />
                            <th>Policy Name</th>
                            <th>Documents</th>
                            <th>Last Updated</th>
                            <th style={{ textAlign: 'right' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.policies.map((policy) => {
                            const isExpanded    = expandedId === policy.id;
                            const docs          = policyDocs[policy.id] || [];
                            const isLoadingDocs = !!docsLoading[policy.id];

                            // Find latest submission status for this policy
                            const latestSub = submissions
                              .filter((s) => s.policy_id === policy.id)
                              .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0];
                            const subStatus = latestSub?.status ?? null;

                            return (
                              <Fragment key={policy.id}>
                                {/* Policy row */}
                                <tr
                                  className="clickable-row"
                                  onClick={() => handleTogglePolicy(policy.id)}
                                >
                                  {/* Chevron */}
                                  <td style={{ paddingRight: 0, width: '36px' }}>
                                    <svg
                                      width="14" height="14" viewBox="0 0 14 14" fill="none"
                                      stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round"
                                      style={{
                                        display: 'block', margin: '0 auto',
                                        transform: isExpanded ? 'rotate(90deg)' : 'none',
                                        transition: 'transform 0.2s ease',
                                      }}
                                    >
                                      <polyline points="5 2 10 7 5 12" />
                                    </svg>
                                  </td>

                                  <td>
                                    <div className="policy-name-cell">
                                      <span className="policy-title">{policy.name}</span>
                                      {policy.description && (
                                        <span className="policy-desc-snippet">{policy.description}</span>
                                      )}
                                    </div>
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

                                  <td className="cell-muted">
                                    {new Date(policy.updated_at || policy.created_at).toLocaleDateString(undefined, {
                                      month: 'short', day: 'numeric', year: 'numeric',
                                    })}
                                  </td>

                                  <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                                    {subStatus && !['rejected', 'not_eligible', 'needs_review'].includes(subStatus) ? (
                                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                        <SubmissionStatusBadge status={subStatus} />
                                        <Link
                                          to={`/client/policies/${policy.id}`}
                                          className="btn btn-ghost btn-sm"
                                        >
                                          View
                                        </Link>
                                      </div>
                                    ) : (
                                      <Link
                                        to={`/client/policies/${policy.id}`}
                                        className="btn btn-primary btn-sm"
                                      >
                                        {['rejected', 'not_eligible', 'needs_review'].includes(subStatus) ? 'Reapply' : 'Apply'}
                                      </Link>
                                    )}
                                  </td>
                                </tr>

                                {/* Expanded docs sub-row */}
                                {isExpanded && (
                                  <tr>
                                    <td style={{ border: 'none', padding: 0 }} />
                                    <td colSpan={4} style={{ paddingTop: '4px', paddingBottom: '16px', borderTop: 'none' }}>
                                      {isLoadingDocs ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-muted)', fontSize: '14px', padding: '8px 0' }}>
                                          <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
                                          Loading documents…
                                        </div>
                                      ) : docs.length === 0 ? (
                                        <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', margin: '8px 0 0' }}>
                                          No documents attached to this policy yet.
                                        </p>
                                      ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                                          {docs.map((doc) => (
                                            <div key={doc.id} style={{
                                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                              padding: '10px 14px',
                                              background: 'var(--color-surface-2)',
                                              borderRadius: '8px',
                                              border: '1px solid var(--color-border)',
                                              gap: '12px',
                                            }}>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                                                  stroke="var(--color-accent)" strokeWidth="1.75" style={{ flexShrink: 0 }}>
                                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                                  <polyline points="14 2 14 8 20 8" />
                                                </svg>
                                                <div style={{ minWidth: 0 }}>
                                                  <div style={{ fontWeight: 500, fontSize: '14px', color: 'var(--color-text)' }}>
                                                    {doc.filename}
                                                  </div>
                                                  <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                                                    {renderDocTypeBadge(doc.document_type)}
                                                    <span style={{ margin: '0 6px' }}>•</span>
                                                    {formatFileSize(doc.file_size)}
                                                  </div>
                                                </div>
                                              </div>

                                              <button
                                                type="button"
                                                onClick={() => handleViewDocument(doc)}
                                                className="btn btn-ghost btn-sm"
                                                disabled={viewingDocId === doc.id}
                                                style={{ flexShrink: 0 }}
                                              >
                                                {viewingDocId === doc.id ? 'Opening…' : (
                                                  <>
                                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                                      <polyline points="15 3 21 3 21 9" />
                                                      <line x1="10" y1="14" x2="21" y2="3" />
                                                    </svg>
                                                    View
                                                  </>
                                                )}
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                  <rect x="6" y="8" width="36" height="32" rx="4" stroke="var(--color-text-muted)" strokeWidth="2" />
                  <path d="M14 18h20M14 24h16M14 30h12" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <h3>{searchTerm || categoryFilter !== 'all' ? 'No matching policies' : 'No policies yet'}</h3>
              <p>
                {searchTerm || categoryFilter !== 'all'
                  ? 'Try adjusting your search or category filter.'
                  : 'Policies will appear here once your insurance provider publishes them.'}
              </p>
            </div>
          )}

          {/* ── Your Submissions ── */}
          <div style={{ marginTop: '48px' }}>
            <div className="dashboard-welcome" style={{ marginBottom: '16px' }}>
              <h1 style={{ fontSize: '1.25rem' }}>Your Submissions</h1>
              <p>Track the status of your insurance applications.</p>
            </div>

            {loading ? (
              <div className="page-loader" style={{ minHeight: '100px' }}>
                <div className="spinner" />
              </div>
            ) : submissions.length === 0 ? (
              <div className="empty-state" style={{ padding: '36px 24px' }}>
                <div className="empty-state-icon">
                  <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                    <rect x="5" y="7" width="30" height="26" rx="4" stroke="var(--color-text-muted)" strokeWidth="1.75" />
                    <path d="M12 15h16M12 20h12M12 25h8" stroke="var(--color-text-muted)" strokeWidth="1.75" strokeLinecap="round" />
                  </svg>
                </div>
                <h3>No submissions yet</h3>
                <p>Apply for a policy above to get started.</p>
              </div>
            ) : (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Policy</th>
                        <th>Category</th>
                        <th>Status</th>
                        <th>Submitted</th>
                        <th style={{ textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map((sub) => (
                        <tr key={sub.id}>
                          <td>
                            <span className="policy-title">{sub.policy?.name ?? '—'}</span>
                          </td>
                          <td>
                            {sub.policy?.category && (
                              <span className={`badge-category badge-category-${sub.policy.category}`}>
                                {sub.policy.category}
                              </span>
                            )}
                          </td>
                          <td>
                            <SubmissionStatusBadge status={sub.status} />
                          </td>
                          <td className="cell-muted">
                            {new Date(sub.submitted_at).toLocaleDateString(undefined, {
                              day: 'numeric', month: 'short', year: 'numeric',
                            })}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <Link
                              to={`/client/policies/${sub.policy_id}`}
                              className="btn btn-ghost btn-sm"
                            >
                              {['rejected', 'not_eligible', 'needs_review'].includes(sub.status) ? 'Reapply' : 'View'}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
