import { useState, useMemo } from 'react';

/**
 * Renders the full eligibility assessment results:
 * - Verdict banner with calm, clear messaging
 * - Confidence score and executive summary
 * - Interactive filter tabs: Issues Found (active by default), Requirements Met, Needs Clarification, All Rules
 * - Document evidence and policy citations with collapsible details for satisfied rules
 * - Actionable CTA for resubmission if not eligible or needs review
 */
export default function EligibilityResultCard({
  submission,
  result,
  canResubmit,
  isRetrying,
  onRetryEligibility,
  onScrollToResubmit,
}) {
  if (!result) return null;

  const currentStatus = submission?.status || result.verdict;
  const isOverridden = Boolean(
    submission?.status &&
    result?.verdict &&
    submission.status !== result.verdict
  );

  const reasons = Array.isArray(result.reasons) ? result.reasons : [];

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

    // Sort issues so blocking ones appear first
    issuesList.sort((a, b) => (b.severity === 'blocking' ? 1 : 0) - (a.severity === 'blocking' ? 1 : 0));

    return { issues: issuesList, unclear: unclearList, satisfied: satisfiedList };
  }, [reasons]);

  // Default active tab to 'issues' if issues exist, else 'unclear', else 'satisfied'
  const defaultTab = issues.length > 0 ? 'issues' : unclear.length > 0 ? 'unclear' : 'satisfied';
  const [activeTab, setActiveTab] = useState(defaultTab);

  // Configure banner appearance and copy per current status
  const bannerConfig = {
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
    approved: {
      themeClass: 'verdict-banner-eligible',
      title: "Application Approved",
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
      title: "Application Not Approved",
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
    needs_review: {
      themeClass: 'verdict-banner-needs-review',
      title: 'Your application needs manual review',
      subtitle: 'Some information in your documents requires further verification. An insurance administrator will review your application and follow up.',
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
      {/* ── 1. VERDICT BANNER ── */}
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

      {/* Human Review / Override Callout */}
      {isOverridden && (
        <div className="verdict-override-callout">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="override-callout-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </span>
            <span style={{ fontWeight: 600, fontSize: '0.875rem', color: '#1e293b' }}>
              This decision was reviewed and updated by our team
            </span>
          </div>
          <p style={{ margin: '4px 0 0 23px', fontSize: '0.8125rem', color: '#64748b' }}>
            Our underwriting specialists conducted a manual review of your documents and updated the application status accordingly.
          </p>
        </div>
      )}

      <div style={{ padding: '24px 28px' }}>
        {/* ── 2. SUMMARY & CONFIDENCE OVERVIEW ── */}
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
                AI Assessment Summary
              </h3>
            </div>
            <div className="eligibility-meta-tags">
              {typeof result.confidence_score === 'number' && (
                <span className="confidence-pill" title="AI model confidence score based on document clarity">
                  <span className="confidence-dot" />
                  {result.confidence_score}% Confidence
                </span>
              )}
              {result.generated_at && (
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

          {result.summary && (
            <p className="eligibility-summary-text">
              {result.summary}
            </p>
          )}

          {onRetryEligibility && (result.confidence_score === 0 || reasons.length === 0) && (
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
          <div className="eligibility-metrics-bar">
            <button
              type="button"
              className={`metric-chip ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
              title="Show all rules verified"
            >
              <span className="metric-label">Rules Verified</span>
              <span className="metric-value">{reasons.length}</span>
            </button>
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
            {satisfied.length > 0 && (
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
        </div>

        {/* ── 3. FILTER TABS & GROUPED REASONS LIST ── */}
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
          {satisfied.length > 0 && (
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
        </div>

        <div className="reasons-section">
          {/* GROUP A: ISSUES FOUND (Violations & Blocking) */}
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

          {/* GROUP B: NEEDS CLARIFICATION (Unclear / Warnings) */}
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

          {/* GROUP C: REQUIREMENTS MET (Satisfied) */}
          {(activeTab === 'satisfied' || activeTab === 'all') && satisfied.length > 0 && (
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

        {/* ── 4. RESUBMISSION CALL TO ACTION ── */}
        {canResubmit && (
          <div className="resubmission-cta-card">
            <div className="resubmission-cta-content">
              <div className="resubmission-cta-badge">Action Available</div>
              <h4>Ready to update your documents?</h4>
              <p>
                {currentStatus === 'not_eligible' || currentStatus === 'rejected'
                  ? 'Review the issues identified above, make the necessary corrections to your proof documents, and reapply below.'
                  : 'You can submit updated or clearer documents below to help resolve any open questions.'}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary resubmit-cta-btn"
              onClick={onScrollToResubmit}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M19 12l-7 7-7-7" />
              </svg>
              <span>Reapply with Corrected Documents</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Individual Rule Item Card
 */
function ReasonItem({ reason, type }) {
  const isBlocking = reason.severity === 'blocking';
  // For satisfied items, collapse evidence by default to eliminate long vertical scrolling
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

          {/* Toggle for satisfied evidence */}
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

      {/* Client Evidence Callout */}
      {showEvidence && reason.client_evidence && (
        <div className="reason-evidence-block">
          <div className="evidence-header">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>Evidence from your documents</span>
          </div>
          <p className="evidence-text">{reason.client_evidence}</p>
        </div>
      )}

      {/* Policy Source Citation */}
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
