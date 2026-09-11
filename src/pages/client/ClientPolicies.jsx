import { useState, useEffect, Fragment } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  fetchPublishedPolicies,
  fetchPolicyCategories,
  getDocumentSignedUrl,
} from '../../lib/policies';
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

function getCategoryIcon(name) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('car') || lower.includes('motor') || lower.includes('auto') || lower.includes('vehicle')) {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8C2.1 11.1 2 11.5 2 12v4c0 .6.4 1 1 1h2" />
        <circle cx="7" cy="17" r="2" />
        <path d="M9 17h6" />
        <circle cx="17" cy="17" r="2" />
      </svg>
    );
  }
  if (lower.includes('health') || lower.includes('medical') || lower.includes('care')) {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    );
  }
  if (lower.includes('life') || lower.includes('term')) {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    );
  }
  if (lower.includes('travel') || lower.includes('flight') || lower.includes('trip')) {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
      </svg>
    );
  }
  if (lower.includes('home') || lower.includes('property')) {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    );
  }
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </svg>
  );
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

function PolicyTableRow({
  policy,
  showCategory = false,
  isExpanded,
  onToggle,
  docs = [],
  isLoadingDocs = false,
  onViewDocument,
  viewingDocId,
  submissions = [],
}) {
  // Find submissions for this policy
  const policySubs = submissions.filter((s) => s.policy_id === policy.id);
  const approvedSub = policySubs.find((s) => ['approved', 'eligible'].includes(s.status));
  const latestSub = [...policySubs].sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0];
  const isApproved = Boolean(approvedSub);
  const subStatus = isApproved ? approvedSub.status : (latestSub?.status ?? null);

  return (
    <Fragment>
      <tr className="clickable-row" onClick={onToggle}>
        {/* Expand Chevron */}
        <td style={{ paddingRight: 0, width: '36px' }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="var(--color-text-muted)"
            strokeWidth="2"
            strokeLinecap="round"
            style={{
              display: 'block',
              margin: '0 auto',
              transform: isExpanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.2s ease',
            }}
          >
            <polyline points="5 2 10 7 5 12" />
          </svg>
        </td>

        {/* Policy Name & Description */}
        <td>
          <div className="policy-name-cell">
            <span className="policy-title">{policy.name}</span>
            {policy.description && (
              <span className="policy-desc-snippet">{policy.description}</span>
            )}
          </div>
        </td>

        {/* Category (if in global search) */}
        {showCategory && (
          <td>
            <span className="badge-category">
              {policy.category}
            </span>
          </td>
        )}

        {/* Documents */}
        <td>
          <span className="doc-count-pill">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            {policy.documentsCount} {policy.documentsCount === 1 ? 'doc' : 'docs'}
          </span>
        </td>

        {/* Last Updated */}
        <td className="cell-muted">
          {new Date(policy.updated_at || policy.created_at).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </td>

        {/* Action button */}
        <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
          {isApproved || (subStatus && !['rejected', 'not_eligible', 'needs_review'].includes(subStatus)) ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <SubmissionStatusBadge status={subStatus} />
              <Link to={`/client/policies/${policy.id}`} className="btn btn-ghost btn-sm">
                View
              </Link>
            </div>
          ) : (
            <Link to={`/client/policies/${policy.id}`} className="btn btn-primary btn-sm">
              {['rejected', 'not_eligible', 'needs_review'].includes(subStatus) ? 'Reapply' : 'Apply'}
            </Link>
          )}
        </td>
      </tr>

      {/* Expanded documents row */}
      {isExpanded && (
        <tr>
          <td style={{ border: 'none', padding: 0 }} />
          <td colSpan={showCategory ? 5 : 4} style={{ paddingTop: '4px', paddingBottom: '16px', borderTop: 'none' }}>
            {isLoadingDocs ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-muted)', fontSize: '14px', padding: '8px 0' }}>
                <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px' }} />
                Loading policy documents…
              </div>
            ) : docs.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', margin: '8px 0 0' }}>
                No documents attached to this policy yet.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                {docs.map((doc) => (
                  <div
                    key={doc.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      background: 'var(--color-surface-2)',
                      borderRadius: '8px',
                      border: '1px solid var(--color-border)',
                      gap: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="var(--color-accent)"
                        strokeWidth="1.75"
                        style={{ flexShrink: 0 }}
                      >
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
                      onClick={() => onViewDocument(doc)}
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
}

export default function ClientPolicies() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Active category selected from URL parameter (e.g. ?category=Car+Insurance)
  const activeCategory = searchParams.get('category') || null;

  const [categoriesList, setCategoriesList] = useState([]);
  const [policies,       setPolicies]       = useState([]);
  const [submissions,    setSubmissions]    = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');

  // Two search states: "Out" (search all policies/categories) and "In" (search within active category)
  const [outSearchTerm, setOutSearchTerm] = useState('');
  const [inSearchTerm,  setInSearchTerm]  = useState('');

  // Expandable policy documents
  const [expandedId,   setExpandedId]   = useState(null);
  const [policyDocs,   setPolicyDocs]   = useState({});
  const [docsLoading,  setDocsLoading]  = useState({});
  const [viewingDocId, setViewingDocId] = useState(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [cats, pols, subs] = await Promise.all([
          fetchPolicyCategories().catch(() => []),
          fetchPublishedPolicies(),
          fetchClientSubmissions(user.id),
        ]);
        setCategoriesList(cats || []);
        setPolicies(pols || []);
        setSubmissions(subs || []);
      } catch (err) {
        setError(err.message || 'Failed to load policies.');
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
    if (expandedId === policyId) {
      setExpandedId(null);
      return;
    }
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

  // Build category groups with description and policies
  const categoryMap = {};

  // First seed with categories from DB
  categoriesList.forEach((cat) => {
    categoryMap[cat.name] = {
      id: cat.id,
      name: cat.name,
      description: cat.description,
      policies: [],
    };
  });

  // Distribute published policies into their categories
  policies.forEach((policy) => {
    const catName = policy.category || 'General Insurance';
    if (!categoryMap[catName]) {
      categoryMap[catName] = {
        name: catName,
        description: policy.policy_categories?.description || null,
        policies: [],
      };
    }
    categoryMap[catName].policies.push(policy);
  });

  // Only show categories that have published policies available
  const availableCategories = Object.values(categoryMap).filter((g) => g.policies.length > 0);

  // Active category group (if drilled into a category)
  const currentCategoryGroup = activeCategory
    ? availableCategories.find((g) => g.name.toLowerCase() === activeCategory.toLowerCase()) || null
    : null;

  // Policies inside current category filtered by inSearchTerm
  const categoryFilteredPolicies = currentCategoryGroup
    ? currentCategoryGroup.policies.filter((p) => {
        if (!inSearchTerm.trim()) return true;
        const term = inSearchTerm.toLowerCase();
        return (
          p.name.toLowerCase().includes(term) ||
          (p.description && p.description.toLowerCase().includes(term))
        );
      })
    : [];

  // Global search results across all policies when searching outside
  const globalMatchingPolicies = outSearchTerm.trim()
    ? policies.filter((p) => {
        const term = outSearchTerm.toLowerCase();
        return (
          p.name.toLowerCase().includes(term) ||
          (p.description && p.description.toLowerCase().includes(term)) ||
          (p.category && p.category.toLowerCase().includes(term))
        );
      })
    : [];

  function handleSelectCategory(catName) {
    setInSearchTerm('');
    setSearchParams({ category: catName });
  }

  function handleBackToCategories() {
    setInSearchTerm('');
    setSearchParams({});
  }

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
            <Link to="/client/policies" className="advisor-nav-link active">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="9" x2="15" y2="9" />
                <line x1="9" y1="13" x2="15" y2="13" />
                <line x1="9" y1="17" x2="13" y2="17" />
              </svg>
              <span>Browse Policies</span>
            </Link>
            <Link to="/client/current-policies" className="advisor-nav-link">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>Current Policies</span>
            </Link>
            <Link to="/client/submissions" className="advisor-nav-link">
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

          {/* ── Advisor Promo Banner ── */}
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
            <div className="page-loader" style={{ minHeight: '260px' }}>
              <div className="spinner" />
            </div>
          ) : currentCategoryGroup ? (
            /* ══════════════════════════════════════════════════════════════
               VIEW A: INSIDE SPECIFIC CATEGORY ("IN" VIEW WITH IN-SEARCH)
               ══════════════════════════════════════════════════════════════ */
            <div>
              {/* Category Header Banner */}
              <div className="category-detail-banner">
                <div className="category-detail-nav">
                  <button
                    type="button"
                    onClick={handleBackToCategories}
                    className="category-back-btn"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="19" y1="12" x2="5" y2="12" />
                      <polyline points="12 19 5 12 12 5" />
                    </svg>
                    <span>All Insurance Categories</span>
                  </button>
                </div>

                <div className="category-detail-title-row">
                  <div className="category-detail-info">
                    <div className="category-detail-icon-box">
                      {getCategoryIcon(currentCategoryGroup.name)}
                    </div>
                    <div>
                      <h1 className="category-detail-heading">
                        <span>{currentCategoryGroup.name}</span>
                        <span className="badge-category" style={{ fontSize: '12px', fontWeight: 600 }}>
                          {currentCategoryGroup.policies.length} {currentCategoryGroup.policies.length === 1 ? 'Policy' : 'Policies'}
                        </span>
                      </h1>
                      {currentCategoryGroup.description && (
                        <p className="category-detail-desc">
                          {currentCategoryGroup.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Quick Category Switcher */}
                  {availableCategories.length > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontWeight: 500 }}>Category:</span>
                      <select
                        className="form-input"
                        style={{ padding: '6px 12px', fontSize: '13px', width: 'auto' }}
                        value={currentCategoryGroup.name}
                        onChange={(e) => handleSelectCategory(e.target.value)}
                      >
                        {availableCategories.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name} ({c.policies.length})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* In-Category Search Toolbar */}
              <div className="content-toolbar" style={{ marginTop: '0', marginBottom: '16px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>
                  {inSearchTerm.trim()
                    ? `Matching Policies (${categoryFilteredPolicies.length})`
                    : `Available Policies (${currentCategoryGroup.policies.length})`}
                </div>

                <div className="search-bar-container">
                  <svg className="search-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    placeholder={`Search within ${currentCategoryGroup.name}...`}
                    value={inSearchTerm}
                    onChange={(e) => setInSearchTerm(e.target.value)}
                    className="search-input-with-icon"
                  />
                  {inSearchTerm && (
                    <button
                      type="button"
                      onClick={() => setInSearchTerm('')}
                      className="search-clear-btn"
                      title="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* Policies Table for Active Category */}
              {categoryFilteredPolicies.length > 0 ? (
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
                        {categoryFilteredPolicies.map((policy) => (
                          <PolicyTableRow
                            key={policy.id}
                            policy={policy}
                            showCategory={false}
                            isExpanded={expandedId === policy.id}
                            onToggle={() => handleTogglePolicy(policy.id)}
                            docs={policyDocs[policy.id]}
                            isLoadingDocs={!!docsLoading[policy.id]}
                            onViewDocument={handleViewDocument}
                            viewingDocId={viewingDocId}
                            submissions={submissions}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="empty-state" style={{ padding: '36px 24px', background: 'var(--color-surface)', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                  <div className="empty-state-icon">
                    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                      <circle cx="18" cy="18" r="12" stroke="var(--color-text-muted)" strokeWidth="1.75" />
                      <line x1="27" y1="27" x2="35" y2="35" stroke="var(--color-text-muted)" strokeWidth="1.75" strokeLinecap="round" />
                    </svg>
                  </div>
                  <h3>No matching policies in {currentCategoryGroup.name}</h3>
                  <p>No policies match your search term "{inSearchTerm}".</p>
                  <button
                    type="button"
                    onClick={() => setInSearchTerm('')}
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: '12px' }}
                  >
                    Clear Filter
                  </button>
                </div>
              )}
            </div>
          ) : outSearchTerm.trim() ? (
            /* ══════════════════════════════════════════════════════════════
               VIEW B: GLOBAL SEARCH RESULTS (MATCHES ACROSS ALL CATEGORIES)
               ══════════════════════════════════════════════════════════════ */
            <div>
              <div className="dashboard-welcome">
                <h1>Search Results</h1>
                <p>
                  Found <strong>{globalMatchingPolicies.length}</strong> {globalMatchingPolicies.length === 1 ? 'policy' : 'policies'} matching "{outSearchTerm}".
                </p>
              </div>

              <div className="content-toolbar" style={{ marginBottom: '20px' }}>
                <button
                  type="button"
                  onClick={() => setOutSearchTerm('')}
                  className="btn btn-secondary btn-sm"
                >
                  ← Back to Categories Overview
                </button>

                <div className="search-bar-container">
                  <svg className="search-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search all policies or categories..."
                    value={outSearchTerm}
                    onChange={(e) => setOutSearchTerm(e.target.value)}
                    className="search-input-with-icon"
                  />
                  <button
                    type="button"
                    onClick={() => setOutSearchTerm('')}
                    className="search-clear-btn"
                    title="Clear search"
                  >
                    ×
                  </button>
                </div>
              </div>

              {globalMatchingPolicies.length > 0 ? (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div className="table-responsive">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th style={{ width: '36px' }} />
                          <th>Policy Name</th>
                          <th>Category</th>
                          <th>Documents</th>
                          <th>Last Updated</th>
                          <th style={{ textAlign: 'right' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {globalMatchingPolicies.map((policy) => (
                          <PolicyTableRow
                            key={policy.id}
                            policy={policy}
                            showCategory={true}
                            isExpanded={expandedId === policy.id}
                            onToggle={() => handleTogglePolicy(policy.id)}
                            docs={policyDocs[policy.id]}
                            isLoadingDocs={!!docsLoading[policy.id]}
                            onViewDocument={handleViewDocument}
                            viewingDocId={viewingDocId}
                            submissions={submissions}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                      <circle cx="20" cy="20" r="14" stroke="var(--color-text-muted)" strokeWidth="2" />
                      <line x1="30" y1="30" x2="42" y2="42" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </div>
                  <h3>No matching policies found</h3>
                  <p>We couldn't find any policies matching "{outSearchTerm}". Try another keyword or explore categories.</p>
                  <button
                    type="button"
                    onClick={() => setOutSearchTerm('')}
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: '12px' }}
                  >
                    Clear Search
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* ══════════════════════════════════════════════════════════════
               VIEW C: CATEGORIES OVERVIEW ("OUT" VIEW WITH CATEGORY CARDS)
               ══════════════════════════════════════════════════════════════ */
            <div>
              <div className="dashboard-welcome">
                <h1>Insurance Types & Categories</h1>
                <p>
                  Select an insurance category below to explore its available policies, or search across all policies.
                </p>
              </div>

              {/* Global "Out" Search Bar */}
              <div className="content-toolbar" style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  {availableCategories.length} {availableCategories.length === 1 ? 'Category' : 'Categories'} Available
                </div>

                <div className="search-bar-container">
                  <svg className="search-input-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search all policies or categories..."
                    value={outSearchTerm}
                    onChange={(e) => setOutSearchTerm(e.target.value)}
                    className="search-input-with-icon"
                  />
                  {outSearchTerm && (
                    <button
                      type="button"
                      onClick={() => setOutSearchTerm('')}
                      className="search-clear-btn"
                      title="Clear search"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* Category Cards Grid */}
              {availableCategories.length > 0 ? (
                <div className="category-cards-grid">
                  {availableCategories.map((group) => (
                    <div
                      key={group.name}
                      className="category-card"
                      onClick={() => handleSelectCategory(group.name)}
                    >
                      <div>
                        <div className="category-card-top">
                          <div className="category-card-icon-box">
                            {getCategoryIcon(group.name)}
                          </div>
                          <span className="category-card-count-badge">
                            {group.policies.length} {group.policies.length === 1 ? 'Policy' : 'Policies'}
                          </span>
                        </div>

                        <h3 className="category-card-title">{group.name}</h3>

                        <p className="category-card-desc">
                          {group.description || 'Comprehensive coverage tailored to protect what matters most to you.'}
                        </p>
                      </div>

                      <div className="category-card-footer">
                        <span className="category-card-link-text">
                          Browse {group.name}
                          <svg className="category-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="5" y1="12" x2="19" y2="12" />
                            <polyline points="12 5 19 12 12 19" />
                          </svg>
                        </span>
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
                  <h3>No policies available yet</h3>
                  <p>Published policies will appear here grouped by their respective category.</p>
                </div>
              )}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
