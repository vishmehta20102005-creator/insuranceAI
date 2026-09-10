import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  fetchClientApprovedPolicies,
  getSubmissionDocumentSignedUrl,
} from '../../lib/submissions';

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDocTypeLabel(type) {
  const PRESET = {
    id_proof: 'Government ID Proof',
    medical_report: 'Recent Medical Report',
    income_proof: 'Income Proof',
    age_proof: 'Age Proof',
    vehicle_rc: 'Vehicle Registration (RC)',
    driving_license: 'Driving License',
    address_proof: 'Proof of Address',
    property_deed: 'Property Deed / Title Document',
  };
  if (PRESET[type]) return PRESET[type];
  return (type || '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getCategoryIcon(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('car') || n.includes('motor') || n.includes('vehicle') || n.includes('auto')) return '🚗';
  if (n.includes('health') || n.includes('med')) return '🏥';
  if (n.includes('life') || n.includes('term')) return '🛡️';
  if (n.includes('home') || n.includes('property')) return '🏠';
  if (n.includes('travel')) return '✈️';
  return '📋';
}

export default function ClientCurrentPolicies() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();

  const [approvedPolicies, setApprovedPolicies] = useState([]);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState('');
  const [searchTerm,       setSearchTerm]       = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [viewingDocId,     setViewingDocId]     = useState(null);
  const [expandedDocs,     setExpandedDocs]     = useState({});

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const policies = await fetchClientApprovedPolicies(user.id);
        setApprovedPolicies(policies || []);
      } catch (err) {
        console.error('Error fetching approved policies:', err);
        setError(err.message || 'Failed to load your active policies.');
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  async function handleViewDoc(doc) {
    if (!doc.file_path) {
      alert('File path not found for this document.');
      return;
    }
    setViewingDocId(doc.id);
    try {
      const url = await getSubmissionDocumentSignedUrl(doc.file_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      alert('Could not open document: ' + err.message);
    } finally {
      setViewingDocId(null);
    }
  }

  function toggleDocs(policyId) {
    setExpandedDocs((prev) => ({
      ...prev,
      [policyId]: !prev[policyId],
    }));
  }

  // Derive unique categories among active policies
  const categories = ['all', ...new Set(
    approvedPolicies
      .map((p) => p.policy?.policy_categories?.name || p.policy?.category)
      .filter(Boolean)
  )];

  // Filtered policies
  const filteredPolicies = approvedPolicies.filter((item) => {
    const polName = item.policy?.name?.toLowerCase() || '';
    const catName = (item.policy?.policy_categories?.name || item.policy?.category || '').toLowerCase();
    const term = searchTerm.toLowerCase().trim();

    if (selectedCategory !== 'all') {
      const itemCat = item.policy?.policy_categories?.name || item.policy?.category;
      if (itemCat !== selectedCategory) return false;
    }

    if (term) {
      return polName.includes(term) || catName.includes(term);
    }
    return true;
  });

  const totalVerifiedDocs = approvedPolicies.reduce((acc, p) => acc + (p.documents?.length || 0), 0);
  const uniqueCategoriesCount = new Set(
    approvedPolicies.map((p) => p.policy?.policy_categories?.name || p.policy?.category).filter(Boolean)
  ).size;

  return (
    <div className="dashboard-layout">
      {/* Top Header */}
      <header className="dashboard-header">
        <div className="dashboard-header-inner">
          <div className="dashboard-brand">
            <Link to="/client/policies" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                <rect width="32" height="32" rx="8" fill="var(--color-accent)" />
                <path d="M16 6L22 10V18L16 26L10 18V10L16 6Z" fill="white" opacity="0.9" />
                <path d="M16 10L19 12.5V17.5L16 22L13 17.5V12.5L16 10Z" fill="var(--color-accent)" />
              </svg>
              <span className="dashboard-brand-name">InsuranceAI</span>
            </Link>
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
            <Link to="/client/current-policies" className="advisor-nav-link active">
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
            <span className="dashboard-user-name">
              {profile?.full_name || user?.email?.split('@')[0] || 'Client'}
            </span>
            <button
              onClick={handleSignOut}
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="dashboard-main" style={{ maxWidth: '1120px', margin: '0 auto', padding: '32px 24px 60px' }}>
        {/* Title & Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '28px' }}>
          <div>
            <h1 style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 8px', letterSpacing: '-0.02em' }}>
              My Current Policies
            </h1>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.95rem', margin: 0, maxWidth: '640px' }}>
              Active policies approved by our underwriting team. View your policy terms, active documents on file, and coverage details.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <Link to="/client/policies" className="btn btn-primary">
              + Browse & Apply for Policies
            </Link>
            <Link to="/client/submissions" className="btn btn-ghost">
              View All Submissions
            </Link>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="stats-grid" style={{ marginBottom: '32px' }}>
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-card-title">Active Policies</span>
              <div className="stat-card-icon" style={{ background: '#dcfce7', color: '#16a34a' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
            </div>
            <div className="stat-card-value" style={{ color: '#16a34a' }}>
              {approvedPolicies.length}
            </div>
            <div className="stat-card-subtitle">
              {approvedPolicies.length === 1 ? '1 policy fully active' : `${approvedPolicies.length} policies fully active`}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-card-title">Coverage Status</span>
              <div className="stat-card-icon" style={{ background: '#dcfce7', color: '#16a34a' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>
            <div className="stat-card-value" style={{ color: '#15803d', fontSize: '1.4rem' }}>
              {approvedPolicies.length > 0 ? 'Active & Covered' : 'No Active Policies'}
            </div>
            <div className="stat-card-subtitle">
              {approvedPolicies.length > 0 ? 'Underwriting approval confirmed' : 'Submit an application to activate'}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-card-title">Categories Covered</span>
              <div className="stat-card-icon" style={{ background: 'var(--color-surface-sunken)', color: 'var(--color-accent)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18" />
                </svg>
              </div>
            </div>
            <div className="stat-card-value">
              {uniqueCategoriesCount}
            </div>
            <div className="stat-card-subtitle">
              {uniqueCategoriesCount === 1 ? '1 insurance category' : `${uniqueCategoriesCount} insurance categories`}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-card-title">Verified Documents</span>
              <div className="stat-card-icon" style={{ background: 'var(--color-surface-sunken)', color: 'var(--color-text-secondary)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
            </div>
            <div className="stat-card-value">
              {totalVerifiedDocs}
            </div>
            <div className="stat-card-subtitle">
              Underwriting verified files
            </div>
          </div>
        </div>

        {/* Filters & Search */}
        {approvedPolicies.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`btn btn-sm ${selectedCategory === cat ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ textTransform: 'capitalize' }}
                >
                  {cat === 'all' ? 'All Active Policies' : cat}
                </button>
              ))}
            </div>

            <div style={{ minWidth: '240px' }}>
              <input
                type="text"
                className="input"
                placeholder="Search active policies..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="page-loader" style={{ minHeight: '300px' }}>
            <div className="spinner" />
          </div>
        ) : error ? (
          <div className="card" style={{ padding: '36px', textAlign: 'center' }}>
            <p style={{ color: 'var(--color-error)', margin: '0 0 16px' }}>{error}</p>
            <button onClick={() => window.location.reload()} className="btn btn-primary">
              Retry
            </button>
          </div>
        ) : filteredPolicies.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {filteredPolicies.map((item) => {
              const policy = item.policy;
              const categoryName = policy?.policy_categories?.name || policy?.category || 'Insurance';
              const icon = getCategoryIcon(categoryName);
              const isDocsExpanded = Boolean(expandedDocs[item.id]);

              const approvedDate = new Date(item.updated_at || item.submitted_at).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              });

              return (
                <div
                  key={item.id}
                  className="card"
                  style={{
                    padding: '24px 28px',
                    border: '1px solid var(--color-border)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                  }}
                >
                  {/* Top Bar */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div
                        style={{
                          width: '48px',
                          height: '48px',
                          borderRadius: '12px',
                          background: 'rgba(22, 163, 74, 0.1)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1.6rem',
                          flexShrink: 0,
                        }}
                      >
                        {icon}
                      </div>

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              background: 'var(--color-surface-sunken)',
                              color: 'var(--color-text-secondary)',
                            }}
                          >
                            {categoryName}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                            Policy Ref: {item.policy_id.slice(0, 8)}…
                          </span>
                        </div>

                        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
                          {policy?.name || 'Insurance Policy'}
                        </h2>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '12px',
                          fontWeight: 700,
                          padding: '4px 12px',
                          borderRadius: '20px',
                          background: '#dcfce7',
                          color: '#15803d',
                          border: '1px solid rgba(22, 163, 74, 0.25)',
                        }}
                      >
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16a34a' }} />
                        Active Coverage
                      </span>

                      <span
                        style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          padding: '4px 10px',
                          borderRadius: '20px',
                          background: 'var(--color-surface-sunken)',
                          color: 'var(--color-text-secondary)',
                          border: '1px solid var(--color-border)',
                        }}
                      >
                        Approved on {approvedDate}
                      </span>
                    </div>
                  </div>

                  {/* Policy Description */}
                  {policy?.description && (
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.925rem', lineHeight: '1.5', margin: '0 0 20px', maxWidth: '780px' }}>
                      {policy.description}
                    </p>
                  )}

                  {/* Key Highlights / Coverage Badges */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '20px',
                      padding: '14px 18px',
                      background: 'rgba(22, 163, 74, 0.04)',
                      borderRadius: '10px',
                      border: '1px solid rgba(22, 163, 74, 0.15)',
                      marginBottom: '20px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#15803d' }}>
                        Underwriting Verified & Approved
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#15803d' }}>
                        {item.documents?.length || 0} Required Documents Verified
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#15803d' }}>
                        Coverage Certificate Active
                      </span>
                    </div>
                  </div>

                  {/* Documents Toggle & Section */}
                  <div style={{ marginBottom: '20px' }}>
                    <button
                      type="button"
                      onClick={() => toggleDocs(item.id)}
                      className="btn btn-ghost btn-sm"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontWeight: 600,
                        color: 'var(--color-accent)',
                        padding: '6px 12px',
                        background: 'var(--color-surface-sunken)',
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                      <span>
                        {isDocsExpanded ? 'Hide Verified Documents' : `View Verified Documents (${item.documents?.length || 0})`}
                      </span>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        style={{
                          transform: isDocsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s',
                        }}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>

                    {isDocsExpanded && (
                      <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {item.documents && item.documents.length > 0 ? (
                          item.documents.map((doc) => {
                            const label = formatDocTypeLabel(doc.document_type);
                            const isViewing = viewingDocId === doc.id;
                            return (
                              <div
                                key={doc.id}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '10px 14px',
                                  background: 'var(--color-surface-sunken)',
                                  borderRadius: '8px',
                                  border: '1px solid var(--color-border)',
                                  gap: '12px',
                                  flexWrap: 'wrap',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-text)' }}>
                                        {label}
                                      </span>
                                    </div>
                                    <div
                                      style={{
                                        fontSize: '0.775rem',
                                        color: 'var(--color-text-muted)',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                      title={doc.filename}
                                    >
                                      {doc.filename} • {formatFileSize(doc.file_size)}
                                    </div>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => handleViewDoc(doc)}
                                  disabled={isViewing}
                                  style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                                >
                                  {isViewing ? 'Opening…' : 'View Document'}
                                </button>
                              </div>
                            );
                          })
                        ) : (
                          <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', padding: '8px 0' }}>
                            No document files found.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Actions Footer */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderTop: '1px solid var(--color-border)',
                      paddingTop: '16px',
                      flexWrap: 'wrap',
                      gap: '12px',
                    }}
                  >
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                      Application #{item.id.slice(0, 8)} • Covered since {approvedDate}
                    </div>

                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <Link
                        to={`/client/submissions/${item.id}`}
                        className="btn btn-sm btn-ghost"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        View Approved Application
                      </Link>

                      <Link
                        to={`/client/policies/${item.policy_id}`}
                        className="btn btn-sm btn-primary"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      >
                        Policy Details & Terms →
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Empty State */
          <div
            className="card empty-state"
            style={{
              padding: '60px 24px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              background: 'var(--color-surface)',
              borderRadius: '16px',
              border: '1px solid var(--color-border)',
            }}
          >
            <div
              style={{
                width: '68px',
                height: '68px',
                borderRadius: '50%',
                background: 'rgba(37,99,235,0.08)',
                color: 'var(--color-accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
              }}
            >
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>

            <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 8px' }}>
              {searchTerm || selectedCategory !== 'all' ? 'No Matching Active Policies' : 'No Active Policies Yet'}
            </h2>

            <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.925rem', maxWidth: '480px', margin: '0 0 24px', lineHeight: '1.5' }}>
              {searchTerm || selectedCategory !== 'all'
                ? 'Try adjusting your search query or category filter.'
                : 'You do not have any approved insurance policies at the moment. Browse our catalog to apply, or check the status of your existing submissions.'}
            </p>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
              <Link to="/client/policies" className="btn btn-primary">
                Browse Available Policies →
              </Link>
              <Link to="/client/submissions" className="btn btn-ghost">
                Check My Submissions
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
