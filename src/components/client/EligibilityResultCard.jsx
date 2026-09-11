import { useState, useMemo } from 'react';

/**
 * Parses inline bold **...** and clean text for display without raw markdown asterisks
 */
function renderFormattedText(text) {
  if (!text || typeof text !== 'string') return text;
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g);
  return boldParts.map((bPart, bIdx) => {
    if (bPart.startsWith('**') && bPart.endsWith('**') && bPart.length >= 4) {
      return <strong key={`b-${bIdx}`}>{bPart.slice(2, -2)}</strong>;
    }
    return bPart;
  });
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DOC_TYPE_LABELS = {
  id_proof: 'Government ID Proof',
  medical_report: 'Recent Medical Report',
  income_proof: 'Income Proof',
  age_proof: 'Age Proof',
  vehicle_rc: 'Vehicle Registration (RC)',
  driving_license: 'Driving License',
  address_proof: 'Proof of Address',
  property_deed: 'Property Deed / Title Document',
};

/**
 * Renders the eligibility assessment and application outcome:
 * - When successful (approved or eligible): Displays a clean, reassuring success card with ZERO red color,
 *   keeping all submitted documents and verification audit trails in a dedicated History section.
 * - When action required (not eligible or rejected): Highlights specific issues to resolve with
 *   clear blocking reasons and a direct path to re-upload.
 */
export default function EligibilityResultCard({
  submission,
  result,
  policy,
  canResubmit,
  isRetrying,
  isSupersededByApproved,
  auditLogs = [],
  onRetryEligibility,
  onScrollToResubmit,
  onViewDoc,
  viewingDocId,
}) {
  if (!result && !submission) return null;

  const currentStatus = submission?.status || result?.verdict || 'pending';
  const isApproved = currentStatus === 'approved';
  const isEligible = currentStatus === 'eligible';
  const isSuccess = isApproved || isEligible;

  const isOverridden = Boolean(
    submission?.status &&
    result?.verdict &&
    submission.status !== result.verdict
  );

  const docs = submission?.submission_documents || [];
  const reasons = Array.isArray(result?.reasons) ? result.reasons : [];

  // Group reasons by outcome for clear scannability
  const { issues, unclear, satisfied } = useMemo(() => {
    const issuesList = [];
    const unclearList = [];
    const satisfiedList = [];

    reasons.forEach((r) => {
      if (r.status === 'violated' || r.severity === 'blocking') {
        issuesList.push(r);
      } else if (r.status === 'unclear') {
        unclearList.push(r);
      } else {
        satisfiedList.push(r);
      }
    });

    issuesList.sort((a, b) => (b.severity === 'blocking' ? 1 : 0) - (a.severity === 'blocking' ? 1 : 0));
    return { issues: issuesList, unclear: unclearList, satisfied: satisfiedList };
  }, [reasons]);

  // Tab state for non-approved detailed rule breakdown
  const defaultTab = isSuccess
    ? 'satisfied'
    : currentStatus === 'needs_review'
    ? (issues.length > 0 ? 'issues' : unclear.length > 0 ? 'unclear' : '')
    : issues.length > 0
    ? 'issues'
    : unclear.length > 0
    ? 'unclear'
    : 'all';
  const [activeTab, setActiveTab] = useState(defaultTab);

  // History tab state: 'docs' | 'audit'
  const [historyTab, setHistoryTab] = useState('docs');
  const [showArchivedNotes, setShowArchivedNotes] = useState(false);

  // Configure banner appearance and copy per current status
  const bannerConfig = {
    approved: {
      themeClass: 'verdict-banner-eligible',
      title: 'Application Approved',
      subtitle: 'Your application has been manually reviewed and approved by our underwriting team.',
      iconBg: '#dcfce7',
      iconColor: '#16a34a',
      badgeClass: 'sub-badge-approved',
      badgeText: '✓ Approved',
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
    },
    eligible: {
      themeClass: 'verdict-banner-eligible',
      title: "You're eligible for this policy",
      subtitle: 'Your submitted documents satisfy all eligibility and documentation criteria outlined in the policy terms.',
      iconBg: '#dcfce7',
      iconColor: '#16a34a',
      badgeClass: 'sub-badge-eligible',
      badgeText: '✓ Eligible',
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ),
    },
    not_eligible: {
      themeClass: 'verdict-banner-not-eligible',
      title: "You're not eligible for this policy",
      subtitle: 'Based on your submitted documents, one or more eligibility criteria were not met. Please review the specific issues below.',
      iconBg: '#fee2e2',
      iconColor: '#dc2626',
      badgeClass: 'sub-badge-not_eligible',
      badgeText: '✗ Not Eligible',
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      ),
    },
    rejected: {
      themeClass: 'verdict-banner-not-eligible',
      title: 'Application Not Approved',
      subtitle: 'Your application was reviewed and could not be approved based on policy requirements.',
      iconBg: '#fee2e2',
      iconColor: '#dc2626',
      badgeClass: 'sub-badge-rejected',
      badgeText: '✗ Rejected',
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      ),
    },
    needs_review: issues.length === 0 && unclear.length === 0
      ? {
          themeClass: 'verdict-banner-needs-review',
          title: 'Pending Underwriter Sign-off',
          subtitle: 'Preliminary AI screening passed with all requirements met. Application is queued for standard underwriter sign-off.',
          iconBg: '#fef3c7',
          iconColor: '#d97706',
          badgeClass: 'sub-badge-needs_review',
          badgeText: '⏳ In Review',
          icon: (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          ),
        }
      : {
          themeClass: 'verdict-banner-needs-review',
          title: 'Your application needs manual review',
          subtitle: 'Some information in your documents requires further verification by an underwriting specialist.',
          iconBg: '#fef3c7',
          iconColor: '#d97706',
          badgeClass: 'sub-badge-needs_review',
          badgeText: '⚠ Needs Review',
          icon: (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ),
        },
  }[currentStatus] ?? {
    themeClass: 'verdict-banner-neutral',
    title: 'Application Assessment',
    subtitle: 'Review the eligibility findings below.',
    iconBg: '#f3f4f6',
    iconColor: '#4b5563',
    badgeClass: 'sub-badge-processing',
    badgeText: currentStatus,
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
      </svg>
    ),
  };

  return (
    <div className="card eligibility-results-container" style={{ marginBottom: '28px', padding: 0, overflow: 'hidden' }}>
      {/* ── 1. HERO VERDICT BANNER ── */}
      <div className={`verdict-banner ${bannerConfig.themeClass}`}>
        <div className="verdict-banner-icon" style={{ background: bannerConfig.iconBg, color: bannerConfig.iconColor }}>
          {bannerConfig.icon}
        </div>
        <div className="verdict-banner-content">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
            <h2 className="verdict-banner-title">{bannerConfig.title}</h2>
            <span className={`sub-status-badge ${bannerConfig.badgeClass}`}>{bannerConfig.badgeText}</span>
          </div>
          <p className="verdict-banner-subtitle">{bannerConfig.subtitle}</p>
        </div>
      </div>

      <div style={{ padding: '24px 28px' }}>
        {/* ── 2. SUCCESS VIEW (APPROVED OR ELIGIBLE): CLEAN, REASSURING, ZERO RED COLOR ── */}
        {isApproved && (
          <div className="approved-hero-card">
            <div className="approved-hero-header">
              <div className="approved-hero-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
              </div>
              <div>
                <h3 className="approved-hero-title">Policy Coverage Active & Confirmed</h3>
                <p className="approved-hero-subtitle">
                  Your application has been manually reviewed and fully approved by our underwriting team.
                </p>
              </div>
            </div>

            <div className="approved-metrics-grid">
              <div className="approved-metric-tile">
                <div className="approved-metric-label">Application Status</div>
                <div className="approved-metric-value" style={{ color: '#16a34a' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16a34a' }} />
                  Approved & Active
                </div>
              </div>

              <div className="approved-metric-tile">
                <div className="approved-metric-label">Review Outcome</div>
                <div className="approved-metric-value">Underwriter Approved</div>
              </div>

              <div className="approved-metric-tile">
                <div className="approved-metric-label">Documents on File</div>
                <div className="approved-metric-value">
                  {docs.length > 0 ? `${docs.length} Verified Documents` : 'All Required Docs Verified'}
                </div>
              </div>

              {submission?.updated_at && (
                <div className="approved-metric-tile">
                  <div className="approved-metric-label">Decision Date</div>
                  <div className="approved-metric-value" style={{ fontSize: '0.875rem' }}>
                    {new Date(submission.updated_at).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="approved-reassurance-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: '2px' }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <div>
                <strong>You are fully covered under this policy.</strong> All documentation requirements have been verified and signed off. No further action is required from you. You can consult the Policy Advisor anytime if you have questions regarding your coverage or benefits.
              </div>
            </div>
          </div>
        )}

        {isEligible && !isApproved && (
          <div className="eligibility-summary-box" style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}>
            <div className="eligibility-summary-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: '#14532d' }}>
                  Eligibility Verification Passed
                </h3>
              </div>
              <div className="eligibility-meta-tags">
                {typeof result?.confidence_score === 'number' && (
                  <span className="confidence-pill" style={{ borderColor: '#bbf7d0', color: '#15803d' }}>
                    <span className="confidence-dot" style={{ background: '#16a34a' }} />
                    {result.confidence_score}% Confidence
                  </span>
                )}
              </div>
            </div>

            {result?.summary && (
              <p className="eligibility-summary-text" style={{ color: '#166534', marginBottom: '12px' }}>
                {renderFormattedText(result.summary)}
              </p>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#15803d', fontSize: '0.875rem', fontWeight: 600 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{satisfied.length} of {reasons.length} Requirements Verified & Met</span>
            </div>
          </div>
        )}

        {/* ── 3. NON-SUCCESS VIEW (NOT ELIGIBLE, REJECTED, NEEDS REVIEW) ── */}
        {!isSuccess && (
          <>
            <div className="eligibility-summary-box">
              <div className="eligibility-summary-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)' }}>
                    {isSupersededByApproved
                      ? 'AI Document Pre-Screening (Historical Record)'
                      : currentStatus === 'needs_review' && issues.length === 0 && unclear.length === 0
                      ? 'AI Document Pre-Screening: Criteria Met'
                      : 'AI Assessment Summary'}
                  </h3>
                </div>
                <div className="eligibility-meta-tags">
                  {typeof result?.confidence_score === 'number' && (
                    <span className="confidence-pill" title="AI model confidence score based on document clarity">
                      <span className="confidence-dot" />
                      {result.confidence_score}% Confidence
                    </span>
                  )}
                  {result?.generated_at && (
                    <span className="timestamp-pill">
                      {new Date(result.generated_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                </div>
              </div>

              {result?.summary && (
                <p className="eligibility-summary-text">
                  {renderFormattedText(result.summary)}
                </p>
              )}

              {isSupersededByApproved && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#15803d', fontSize: '0.85rem', fontWeight: 500, marginTop: '8px' }}>
                  <span>✓ Preliminary criteria were verified by AI. Application resolved by approved subsequent submission.</span>
                </div>
              )}

              {!isSupersededByApproved && currentStatus === 'needs_review' && issues.length === 0 && unclear.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#d97706', fontSize: '0.85rem', fontWeight: 500, marginTop: '8px' }}>
                  <span>⏳ Automated pre-screening passed. Final policy issuance is pending standard underwriter sign-off.</span>
                </div>
              )}

              {onRetryEligibility && (result?.confidence_score === 0 || reasons.length === 0) && (
                <div style={{ marginTop: '12px', marginBottom: '16px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={onRetryEligibility}
                    disabled={isRetrying}
                  >
                    {isRetrying ? (
                      <>
                        <span className="btn-spinner" />
                        <span>Analyzing Documents with Gemini...</span>
                      </>
                    ) : (
                      <>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                        <span>Retry AI Verification</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Scannable interactive metrics bar */}
              {(issues.length > 0 || unclear.length > 0 || (currentStatus !== 'needs_review' && (satisfied.length > 0 || reasons.length > 0))) && (
                <div className="eligibility-metrics-bar">
                  {currentStatus !== 'needs_review' && (
                    <button
                      type="button"
                      className={`metric-chip ${activeTab === 'all' ? 'active' : ''}`}
                      onClick={() => setActiveTab('all')}
                      title="Show all rules verified"
                    >
                      <span className="metric-label">Rules Verified</span>
                      <span className="metric-value">{reasons.length}</span>
                    </button>
                  )}
                  {issues.length > 0 && (
                    <button
                      type="button"
                      className={`metric-chip metric-chip-issues ${activeTab === 'issues' ? 'active' : ''}`}
                      onClick={() => setActiveTab('issues')}
                      title="Filter to issues to resolve"
                    >
                      <span className="metric-label">Issues Found</span>
                      <span className="metric-value" style={{ color: '#dc2626' }}>{issues.length}</span>
                    </button>
                  )}
                  {unclear.length > 0 && (
                    <button
                      type="button"
                      className={`metric-chip metric-chip-unclear ${activeTab === 'unclear' ? 'active' : ''}`}
                      onClick={() => setActiveTab('unclear')}
                      title="Filter to items needing clarification"
                    >
                      <span className="metric-label">Needs Clarification</span>
                      <span className="metric-value" style={{ color: '#d97706' }}>{unclear.length}</span>
                    </button>
                  )}
                  {satisfied.length > 0 && currentStatus !== 'needs_review' && (
                    <button
                      type="button"
                      className={`metric-chip metric-chip-satisfied ${activeTab === 'satisfied' ? 'active' : ''}`}
                      onClick={() => setActiveTab('satisfied')}
                      title="Filter to requirements met"
                    >
                      <span className="metric-label">Requirements Met</span>
                      <span className="metric-value" style={{ color: '#16a34a' }}>{satisfied.length}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Filter Tabs for Issues / Rules */}
            {(issues.length > 0 || unclear.length > 0 || (currentStatus !== 'needs_review' && (satisfied.length > 0 || reasons.length > 0))) && (
              <div className="rules-tab-bar" role="tablist" aria-label="Filter rules by status">
                {issues.length > 0 && (
                  <button
                    type="button"
                    className={`rules-tab-btn tab-issues ${activeTab === 'issues' ? 'active' : ''}`}
                    onClick={() => setActiveTab('issues')}
                    role="tab"
                    aria-selected={activeTab === 'issues'}
                  >
                    <span className="rules-tab-dot dot-issue" />
                    <span>Issues to Resolve</span>
                    <span className="rules-tab-count badge-issues">{issues.length}</span>
                  </button>
                )}
                {unclear.length > 0 && (
                  <button
                    type="button"
                    className={`rules-tab-btn tab-unclear ${activeTab === 'unclear' ? 'active' : ''}`}
                    onClick={() => setActiveTab('unclear')}
                    role="tab"
                    aria-selected={activeTab === 'unclear'}
                  >
                    <span className="rules-tab-dot dot-unclear" />
                    <span>Needs Clarification</span>
                    <span className="rules-tab-count badge-unclear">{unclear.length}</span>
                  </button>
                )}
                {satisfied.length > 0 && currentStatus !== 'needs_review' && (
                  <button
                    type="button"
                    className={`rules-tab-btn tab-satisfied ${activeTab === 'satisfied' ? 'active' : ''}`}
                    onClick={() => setActiveTab('satisfied')}
                    role="tab"
                    aria-selected={activeTab === 'satisfied'}
                  >
                    <span className="rules-tab-dot dot-satisfied" />
                    <span>Requirements Met</span>
                    <span className="rules-tab-count badge-satisfied">{satisfied.length}</span>
                  </button>
                )}
                {currentStatus !== 'needs_review' && (
                  <button
                    type="button"
                    className={`rules-tab-btn tab-all ${activeTab === 'all' ? 'active' : ''}`}
                    onClick={() => setActiveTab('all')}
                    role="tab"
                    aria-selected={activeTab === 'all'}
                  >
                    <span>All Rules</span>
                    <span className="rules-tab-count badge-neutral">{reasons.length}</span>
                  </button>
                )}
              </div>
            )}

            {/* Grouped Reasons List */}
            <div className="reasons-section">
              {(activeTab === 'issues' || activeTab === 'all') && issues.length > 0 && (
                <div className="reasons-group issues-group">
                  <div className="reasons-group-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="reasons-group-icon issues-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                      </span>
                      <h3 className="reasons-group-title" style={{ color: '#b91c1c' }}>
                        Issues to Resolve ({issues.length})
                      </h3>
                    </div>
                    <span className="reasons-group-hint">Requires document correction before approval</span>
                  </div>

                  <div className="reasons-list">
                    {issues.map((r, idx) => (
                      <ReasonItem key={`issue-${idx}`} reason={r} type="issue" />
                    ))}
                  </div>
                </div>
              )}

              {(activeTab === 'unclear' || activeTab === 'all') && unclear.length > 0 && (
                <div className="reasons-group unclear-group">
                  <div className="reasons-group-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="reasons-group-icon unclear-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                      </span>
                      <h3 className="reasons-group-title" style={{ color: '#b45309' }}>
                        Needs Clarification ({unclear.length})
                      </h3>
                    </div>
                    <span className="reasons-group-hint">Under review by insurance specialist</span>
                  </div>

                  <div className="reasons-list">
                    {unclear.map((r, idx) => (
                      <ReasonItem key={`unclear-${idx}`} reason={r} type="unclear" />
                    ))}
                  </div>
                </div>
              )}

              {currentStatus !== 'needs_review' && (activeTab === 'satisfied' || activeTab === 'all') && satisfied.length > 0 && (
                <div className="reasons-group satisfied-group">
                  <div className="reasons-group-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="reasons-group-icon satisfied-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      <h3 className="reasons-group-title" style={{ color: '#15803d' }}>
                        Requirements Met ({satisfied.length})
                      </h3>
                    </div>
                    <span className="reasons-group-hint">Verified and satisfied</span>
                  </div>

                  <div className="reasons-list">
                    {satisfied.map((r, idx) => (
                      <ReasonItem key={`satisfied-${idx}`} reason={r} type="satisfied" />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Resubmission Action Card */}
            {canResubmit && (
              <div className="resubmission-cta-card">
                <div className="resubmission-cta-content">
                  <div className="resubmission-cta-badge">Action Available</div>
                  <h4>Ready to update your documents?</h4>
                  <p>
                    Review the issues identified above, make the necessary corrections to your proof documents, and reapply below.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary resubmit-cta-btn"
                  onClick={onScrollToResubmit}
                >
                  <span>Update Documents & Reapply</span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <polyline points="19 12 12 19 5 12" />
                  </svg>
                </button>
              </div>
            )}
          </>
        )}

        {/* ── 4. APPLICATION & DOCUMENT HISTORY SECTION ── */}
        <div className="app-history-section">
          <div className="app-history-header">
            <div>
              <h3 className="app-history-header-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span>Application & Document History</span>
              </h3>
              <p className="app-history-header-subtitle">
                {isSuccess
                  ? 'Your submitted files and verification audit trail are archived below for your records.'
                  : 'Review your submitted documents and previous verification history.'}
              </p>
            </div>
          </div>

          <div className="app-history-tabs">
            <button
              type="button"
              className={`app-history-tab-btn ${historyTab === 'docs' ? 'active' : ''}`}
              onClick={() => setHistoryTab('docs')}
            >
              <span>Submitted Documents</span>
              <span className="history-pill">{docs.length}</span>
            </button>
            <button
              type="button"
              className={`app-history-tab-btn ${historyTab === 'audit' ? 'active' : ''}`}
              onClick={() => setHistoryTab('audit')}
            >
              <span>Verification & Audit Trail</span>
            </button>
          </div>

          <div className="app-history-content">
            {historyTab === 'docs' && (
              <div className="history-docs-list">
                {docs.length === 0 ? (
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', margin: 0 }}>
                    No documents uploaded for this application.
                  </p>
                ) : (
                  docs.map((doc) => (
                    <div key={doc.id} className="history-doc-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.75" style={{ flexShrink: 0 }}>
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-text-primary)' }} title={doc.filename}>
                            {doc.filename}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                            {formatFileSize(doc.file_size)}
                          </div>
                        </div>
                      </div>

                      <span className="doc-row-type">
                        {DOC_TYPE_LABELS[doc.document_type] || doc.document_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </span>

                      {onViewDoc && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ flexShrink: 0 }}
                          onClick={() => onViewDoc(doc)}
                          disabled={viewingDocId === doc.id}
                          title="Open document in new tab"
                        >
                          {viewingDocId === doc.id ? (
                            <>
                              <span className="btn-spinner-dark" />
                              <span>Opening…</span>
                            </>
                          ) : (
                            <>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                              </svg>
                              <span>View</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {historyTab === 'audit' && (
              <div className="history-timeline">
                {/* Real recorded audit log events if available */}
                {auditLogs.map((log, idx) => (
                  <div key={log.id || `audit-${idx}`} className="history-timeline-step">
                    <div className={`history-step-dot ${log.new_status === 'approved' ? 'step-dot-success' : 'step-dot-neutral'}`}>
                      {log.new_status === 'approved' ? '✓' : log.new_status === 'needs_review' ? '⚠' : '•'}
                    </div>
                    <div className="history-step-content">
                      <h4 className="history-step-title">
                        {log.action === 'admin_override'
                          ? `Underwriter Action: ${log.new_status ? log.new_status.replace('_', ' ').toUpperCase() : 'Updated'}`
                          : log.action === 'ai_verdict'
                          ? `Automated AI Evaluation: ${log.new_status ? log.new_status.replace('_', ' ').toUpperCase() : 'Completed'}`
                          : `Status Change: ${log.new_status}`}
                      </h4>
                      <div className="history-step-meta">
                        {log.created_at &&
                          new Date(log.created_at).toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                      </div>
                      {log.reason && (
                        <p className="history-step-desc" style={{ color: 'var(--color-text)', fontWeight: 500, marginTop: '4px' }}>
                          Underwriting Note: {log.reason}
                        </p>
                      )}
                    </div>
                  </div>
                ))}

                {/* Step 1: Latest Status */}
                <div className="history-timeline-step">
                  <div className={`history-step-dot ${isSuccess ? 'step-dot-success' : 'step-dot-neutral'}`}>
                    {isSuccess ? '✓' : '1'}
                  </div>
                  <div className="history-step-content">
                    <h4 className="history-step-title">
                      {isApproved
                        ? 'Underwriting Review Completed — Application Approved'
                        : isEligible
                        ? 'Automated Eligibility Verification Passed'
                        : currentStatus === 'needs_review'
                        ? 'Application In Review'
                        : 'Application Evaluation Completed'}
                    </h4>
                    <div className="history-step-meta">
                      {submission?.updated_at
                        ? new Date(submission.updated_at).toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Current Status'}
                    </div>
                    <p className="history-step-desc">
                      {isApproved
                        ? 'An underwriting specialist conducted a manual review of your documents and updated the application status to Approved.'
                        : isEligible
                        ? 'Your submitted documents were verified against all policy guidelines and confirmed eligible.'
                        : 'Application status evaluated based on current document criteria.'}
                    </p>
                  </div>
                </div>

                {/* Step 2: Initial Automated Assessment */}
                {result && (
                  <div className="history-timeline-step">
                    <div className="history-step-dot step-dot-neutral">
                      ℹ
                    </div>
                    <div className="history-step-content">
                      <h4 className="history-step-title">
                        Initial Automated Check
                        {isApproved && <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', fontSize: '0.75rem', marginLeft: '6px' }}>(Superseded by Underwriting Approval)</span>}
                      </h4>
                      {result.generated_at && (
                        <div className="history-step-meta">
                          {new Date(result.generated_at).toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {typeof result.confidence_score === 'number' && ` • ${result.confidence_score}% Model Confidence`}
                        </div>
                      )}
                      <p className="history-step-desc">
                        {isApproved
                          ? 'Automated preliminary scan was completed upon document submission. Any preliminary flags were reviewed and resolved by our underwriting team.'
                          : 'Automated document analysis completed.'}
                      </p>

                      {/* Optional historical notes toggle for approved apps */}
                      {isApproved && result.summary && (
                        <div style={{ marginTop: '8px' }}>
                          <button
                            type="button"
                            className="reason-evidence-toggle"
                            onClick={() => setShowArchivedNotes((prev) => !prev)}
                            style={{ fontSize: '0.75rem' }}
                          >
                            <span>{showArchivedNotes ? 'Hide Archived Pre-Check Notes' : 'View Archived Pre-Check Notes'}</span>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: showArchivedNotes ? 'rotate(180deg)' : 'none' }}>
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </button>

                          {showArchivedNotes && (
                            <div className="archived-precheck-box">
                              <span className="archived-precheck-badge">Historical Pre-Check Archive</span>
                              <p style={{ margin: 0, lineHeight: 1.5 }}>
                                {renderFormattedText(result.summary)}
                              </p>
                              <div style={{ marginTop: '8px', fontSize: '0.75rem', color: '#64748b' }}>
                                ✓ <em>Cleared and resolved during manual underwriting.</em>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Individual Rule Item Card for non-approved states
 */
function ReasonItem({ reason, type }) {
  const isBlocking = reason.severity === 'blocking';
  const [showEvidence, setShowEvidence] = useState(type !== 'satisfied');
  const hasEvidence = Boolean(reason.client_evidence || reason.policy_source);

  return (
    <div className={`reason-card reason-card-${type} ${isBlocking ? 'reason-blocking' : ''}`}>
      <div className="reason-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flex: 1, minWidth: 0 }}>
          <span className={`reason-status-indicator indicator-${type}`}>
            {type === 'issue' && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            {type === 'unclear' && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <circle cx="12" cy="12" r="1" />
              </svg>
            )}
            {type === 'satisfied' && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="reason-rule-title">
              {reason.rule_checked}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {isBlocking && (
            <span className="severity-tag severity-blocking" title="This requirement is a blocking criteria">
              Blocking
            </span>
          )}

          {type === 'satisfied' && hasEvidence && (
            <button
              type="button"
              className="reason-evidence-toggle"
              onClick={() => setShowEvidence((prev) => !prev)}
              title={showEvidence ? 'Hide verification evidence' : 'View verification evidence'}
            >
              <span>{showEvidence ? 'Hide Details' : 'View Details'}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  transform: showEvidence ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.15s ease',
                }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {showEvidence && reason.client_evidence && (
        <div className="reason-evidence-block">
          <div className="evidence-header">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>Evidence from your documents</span>
          </div>
          <p className="evidence-text">{renderFormattedText(reason.client_evidence)}</p>
        </div>
      )}

      {showEvidence && reason.policy_source && (
        <div className="reason-source-citation">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>Policy rule source: <strong>{reason.policy_source}</strong></span>
        </div>
      )}
    </div>
  );
}
