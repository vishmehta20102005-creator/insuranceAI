import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  fetchSubmissionById,
  fetchAllSubmissionsForPolicyByClient,
  fetchEligibilityResult,
  getSubmissionDocumentSignedUrl,
} from '../../lib/submissions';
import { fetchClientSubmissionAuditLogs } from '../../lib/audit';
import EligibilityResultCard from '../../components/client/EligibilityResultCard';

function extractReviewReason(submission, result, auditLogs) {
  // 1. Check if admin left an explicit note in audit log
  const adminLog = (auditLogs || []).find(
    (l) => (l.new_status === 'needs_review' || l.action === 'admin_override') && l.reason && l.reason.trim()
  );
  if (adminLog?.reason) {
    return {
      headline: adminLog.reason.trim(),
      details: 'Recorded by insurance underwriter during manual assessment.',
      source: 'Underwriter Audit Note',
    };
  }

  // 2. Check for unclear or warning rules from the AI evaluation
  const reasons = Array.isArray(result?.reasons) ? result.reasons : [];

  // Check for rules marked 'unclear'
  const unclear = reasons.filter((r) => r.status === 'unclear');
  if (unclear.length > 0) {
    const item = unclear[0];
    return {
      headline: item.rule_checked || item.rule || 'Document Clarification Required',
      details: item.client_evidence
        ? `Evidence note: ${item.client_evidence}`
        : 'Submitted document information requires manual review by an underwriter to confirm compliance.',
      source: item.policy_source || 'Policy Guidelines',
    };
  }

  // Check for rules with warning severity or mentioning underwriting/medical terms
  const underwritingRule = reasons.find((r) => {
    const text = `${r.rule_checked || r.rule || ''} ${r.client_evidence || ''} ${r.policy_source || ''}`.toLowerCase();
    return (
      r.severity === 'warning' ||
      text.includes('underwriting') ||
      text.includes('medical underwriting') ||
      text.includes('manual review') ||
      text.includes('blood pressure') ||
      text.includes('clarification') ||
      text.includes('requires additional')
    );
  });

  if (underwritingRule) {
    return {
      headline: underwritingRule.rule_checked || underwritingRule.rule || 'Specialized Underwriting Review Triggered',
      details: underwritingRule.client_evidence
        ? `Evidence note: ${underwritingRule.client_evidence}`
        : 'This specific condition or document clause requires manual underwriter clearance before approval.',
      source: underwritingRule.policy_source || 'Policy Underwriting Guidelines',
    };
  }

  // 3. If AI summary mentions needs review or specific reasons
  if (result?.summary && result.verdict === 'needs_review') {
    return {
      headline: result.summary,
      details: 'Automated document analysis flagged this submission for secondary underwriter verification.',
      source: 'AI Assessment Finding',
    };
  }

  // 4. Default fallback
  return {
    headline: 'Mandatory Policy Underwriting Protocol',
    details: 'Baseline documents were received. Policy terms require formal underwriter sign-off before policy activation.',
    source: 'Policy Underwriting Protocol',
  };
}

function extractStatusResolution(submission, isSupersededByApproved, policyApprovedSub) {
  if (submission?.status === 'rejected' || submission?.status === 'not_eligible') {
    const dateStr = policyApprovedSub?.submitted_at
      ? new Date(policyApprovedSub.submitted_at).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '';
    return {
      headline: '✗ Application Not Approved',
      details: isSupersededByApproved
        ? `This specific application did not meet policy requirements and was rejected based on the documents submitted. (Note: You hold active approved coverage under this policy from a subsequent application${dateStr ? ` on ${dateStr}` : ''}).`
        : 'This application did not meet policy underwriting requirements based on the submitted documents.',
      isSuccess: false,
    };
  }

  if (isSupersededByApproved) {
    const dateStr = policyApprovedSub?.submitted_at
      ? new Date(policyApprovedSub.submitted_at).toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '';
    return {
      headline: '✓ Resolved — Approved & Active Coverage',
      details: `A subsequent application for this policy was approved${dateStr ? ` on ${dateStr}` : ''}. You are actively covered under this policy.`,
      isSuccess: true,
    };
  }

  if (submission?.status === 'approved') {
    return {
      headline: '✓ Approved & Active Coverage',
      details: 'Underwriter review has been completed and your policy was fully approved.',
      isSuccess: true,
    };
  }

  if (submission?.status === 'needs_review') {
    return {
      headline: '⏳ Review In Progress with Underwriting Team',
      details: 'An insurance specialist is evaluating your submitted documents. No further action is required from you at this time.',
      isSuccess: false,
    };
  }

  return {
    headline: `Status: ${submission?.status || 'Pending'}`,
    details: 'Application evaluation is currently underway.',
    isSuccess: false,
  };
}

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

function SubmissionStatusBadge({ status }) {
  const cfg = {
    pending:      { cls: 'sub-badge-pending',      label: '⏳ Pending' },
    processing:   { cls: 'sub-badge-processing',   label: '⚙ Processing' },
    eligible:     { cls: 'sub-badge-eligible',     label: '✓ Eligible' },
    not_eligible: { cls: 'sub-badge-not_eligible', label: '✗ Not Eligible' },
    needs_review: { cls: 'sub-badge-needs_review', label: '⚠ Needs Review' },
    approved:     { cls: 'sub-badge-approved',     label: '✓ Approved' },
    rejected:     { cls: 'sub-badge-rejected',     label: '✗ Rejected' },
  }[status] ?? { cls: '', label: status };
  return <span className={`sub-status-badge ${cfg.cls}`}>{cfg.label}</span>;
}

export default function ClientSubmissionDetail() {
  const { id: submissionId } = useParams();
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();

  const [submission,          setSubmission]          = useState(null);
  const [eligibilityResult,   setEligibilityResult]   = useState(null);
  const [relatedSubmissions,  setRelatedSubmissions]  = useState([]);
  const [auditLogs,           setAuditLogs]           = useState([]);
  const [loading,             setLoading]             = useState(true);
  const [error,               setError]               = useState('');
  const [viewingDocId,        setViewingDocId]        = useState(null);

  useEffect(() => {
    if (!user || !submissionId) return;

    (async () => {
      setLoading(true);
      setError('');
      try {
        // 1. Fetch this specific submission
        const sub = await fetchSubmissionById(submissionId, user.id);
        if (!sub) throw new Error('Submission not found.');
        setSubmission(sub);

        // 2. Fetch eligibility result for this submission
        try {
          const res = await fetchEligibilityResult(sub.id);
          setEligibilityResult(res);
        } catch (resErr) {
          console.warn('Could not fetch eligibility result for submission:', resErr);
          setEligibilityResult(null);
        }

        // 3. Fetch client audit logs for this submission
        try {
          const logs = await fetchClientSubmissionAuditLogs(sub.id);
          setAuditLogs(logs || []);
        } catch (logErr) {
          console.warn('Could not fetch client audit logs:', logErr);
          setAuditLogs([]);
        }

        // 4. Fetch all submissions for this policy by this client to detect superseding
        if (sub.policy_id) {
          try {
            const relSubs = await fetchAllSubmissionsForPolicyByClient(sub.policy_id, user.id);
            setRelatedSubmissions(relSubs || []);
          } catch (relErr) {
            console.warn('Could not fetch related submissions for policy:', relErr);
          }
        }
      } catch (err) {
        console.error('Error loading submission details:', err);
        setError(err.message || 'Failed to load application details.');
      } finally {
        setLoading(false);
      }
    })();
  }, [submissionId, user]);

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

  if (loading) {
    return (
      <div className="page-loader">
        <div className="spinner" />
      </div>
    );
  }

  if (error || !submission) {
    return (
      <div className="dashboard-layout">
        <header className="dashboard-header">
          <div className="dashboard-header-inner">
            <div className="dashboard-brand">
              <span className="dashboard-brand-name">InsuranceAI</span>
            </div>
          </div>
        </header>
        <main className="dashboard-main" style={{ maxWidth: '800px', margin: '40px auto', padding: '0 20px' }}>
          <div className="card" style={{ padding: '36px', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>⚠️</div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '8px' }}>
              Application Not Found
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', marginBottom: '24px' }}>
              {error || 'The requested application could not be found or you do not have permission to view it.'}
            </p>
            <Link to="/client/submissions" className="btn btn-primary">
              ← Back to My Submissions
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const policy = submission.policy;
  const docs = submission.submission_documents || [];
  const categoryName = policy?.policy_categories?.name || policy?.category || 'General Insurance';

  // Check if there is a newer approved attempt for this policy
  const policyApprovedSub = relatedSubmissions.find((s) => ['approved', 'eligible'].includes(s.status));
  const isSupersededByApproved = policyApprovedSub && policyApprovedSub.id !== submission.id;
  const canReapply = !policyApprovedSub && ['needs_review', 'not_eligible', 'rejected'].includes(submission.status);

  const reviewReason = extractReviewReason(submission, eligibilityResult, auditLogs);
  const statusResolution = extractStatusResolution(submission, isSupersededByApproved, policyApprovedSub);
  const isReviewRelevant =
    submission.status === 'needs_review' ||
    isSupersededByApproved ||
    (auditLogs || []).some((l) => l.new_status === 'needs_review');

  const formattedDate = new Date(submission.submitted_at).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

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
            <Link to="/client/current-policies" className="advisor-nav-link">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>Current Policies</span>
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

      {/* Main Content */}
      <main className="dashboard-main" style={{ maxWidth: '1080px', margin: '0 auto', padding: '28px 24px 60px' }}>
        {/* Navigation Breadcrumb */}
        <div style={{ marginBottom: '20px' }}>
          <Link
            to="/client/submissions"
            className="btn btn-ghost btn-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--color-text-secondary)',
              padding: '6px 12px',
              borderRadius: '8px',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to My Submissions
          </Link>
        </div>

        {/* Application Header Card */}
        <div
          className="card"
          style={{
            marginBottom: '24px',
            padding: '24px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '8px' }}>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '3px 10px',
                    borderRadius: '20px',
                    background: 'var(--color-accent-subtle, rgba(37,99,235,0.08))',
                    color: 'var(--color-accent)',
                  }}
                >
                  {categoryName}
                </span>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                  Application ID: {submission.id.slice(0, 8)}…
                </span>
              </div>

              <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-text)', margin: '0 0 6px' }}>
                Application for {policy?.name || 'Insurance Policy'}
              </h1>

              <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                Submitted on {formattedDate}
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <SubmissionStatusBadge status={submission.status} />
                {isSupersededByApproved && (
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '3px 8px',
                      borderRadius: '12px',
                      background: 'var(--color-surface-sunken)',
                      color: 'var(--color-text-muted)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    Previous Attempt
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Active Coverage Notice (if this attempt was rejected, but policy is approved via another submission) ── */}
        {isSupersededByApproved && policyApprovedSub && (
          <div
            className="card"
            style={{
              marginBottom: '20px',
              padding: '16px 20px',
              background: 'rgba(22, 163, 74, 0.06)',
              border: '1px solid rgba(22, 163, 74, 0.25)',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text)' }}>
                  Active Approved Policy Coverage Confirmed
                </div>
                <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                  You hold active approved coverage under this policy from a subsequent application. Reapplication is closed.
                </div>
              </div>
            </div>
            <Link
              to={`/client/submissions/${policyApprovedSub.id}`}
              className="btn btn-sm btn-ghost"
              style={{ color: '#16a34a', borderColor: 'rgba(22, 163, 74, 0.3)' }}
            >
              View Approved Application →
            </Link>
          </div>
        )}

        {/* ── Underwriting Review Assessment & Resolution Breakdown ── */}
        {isReviewRelevant && (
          <div
            className="card"
            style={{
              marginBottom: '24px',
              padding: '24px 28px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: 'rgba(217, 119, 6, 0.1)',
                  color: '#d97706',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </div>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
                  Underwriting Review Assessment
                </h3>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', margin: '2px 0 0' }}>
                  Clear breakdown of why this application required manual review and its current resolution.
                </p>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '16px',
              }}
            >
              {/* Box 1: Why Review Was Required */}
              <div
                style={{
                  background: 'rgba(217, 119, 6, 0.04)',
                  border: '1px solid rgba(217, 119, 6, 0.25)',
                  borderRadius: '10px',
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#d97706' }} />
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: '#b45309',
                      }}
                    >
                      Why Review Was Required
                    </span>
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.4 }}>
                    {reviewReason.headline}
                  </div>
                  {reviewReason.details && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>
                      {reviewReason.details}
                    </div>
                  )}
                </div>
                {reviewReason.source && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '12px', borderTop: '1px dashed rgba(217, 119, 6, 0.2)', paddingTop: '6px' }}>
                    Source: {reviewReason.source}
                  </div>
                )}
              </div>

              {/* Box 2: Current Status & Resolution */}
              <div
                style={{
                  background: statusResolution.isSuccess ? 'rgba(22, 163, 74, 0.04)' : 'rgba(37, 99, 235, 0.04)',
                  border: `1px solid ${statusResolution.isSuccess ? 'rgba(22, 163, 74, 0.25)' : 'rgba(37, 99, 235, 0.25)'}`,
                  borderRadius: '10px',
                  padding: '16px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: statusResolution.isSuccess ? '#16a34a' : '#2563eb',
                      }}
                    />
                    <span
                      style={{
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: statusResolution.isSuccess ? '#15803d' : '#1d4ed8',
                      }}
                    >
                      Current Status & Resolution
                    </span>
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.4 }}>
                    {statusResolution.headline}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>
                    {statusResolution.details}
                  </div>
                </div>

                {isSupersededByApproved && policyApprovedSub && (
                  <div style={{ marginTop: '14px', borderTop: '1px dashed rgba(22, 163, 74, 0.2)', paddingTop: '10px' }}>
                    <Link
                      to={`/client/submissions/${policyApprovedSub.id}`}
                      className="btn btn-sm btn-primary"
                      style={{ fontSize: '0.8rem', padding: '6px 14px' }}
                    >
                      View Active Approved Application →
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Eligibility & Status Reasons Card ── */}
        {eligibilityResult ? (
          <EligibilityResultCard
            submission={submission}
            result={eligibilityResult}
            policy={policy}
            canResubmit={canReapply}
            isSupersededByApproved={isSupersededByApproved}
            auditLogs={auditLogs}
            onViewDoc={handleViewDoc}
            viewingDocId={viewingDocId}
            onScrollToResubmit={() => {
              navigate(`/client/policies/${submission.policy_id}`);
            }}
          />
        ) : (
          <div className="card" style={{ marginBottom: '24px', padding: '28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '10px',
                  background: 'var(--color-surface-sunken)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-text-secondary)',
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div>
                <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 4px' }}>
                  Application Under Evaluation
                </h2>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', margin: 0 }}>
                  This application was recorded on {formattedDate}. An underwriting evaluation is currently associated with this file.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
