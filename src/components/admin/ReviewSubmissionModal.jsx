import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  REQUIRED_DOC_TYPES,
  getSubmissionDocumentSignedUrl,
  fetchEligibilityResult,
} from '../../lib/submissions';
import {
  overrideSubmissionVerdict,
  fetchAuditLogsForSubmission,
} from '../../lib/audit';

function formatFileSize(bytes) {
  if (!bytes) return '—';
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`;
}

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

export default function ReviewSubmissionModal({ isOpen, onClose, submission, onStatusUpdated }) {
  const { user, profile } = useAuth();

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [viewingDocId, setViewingDocId] = useState(null);

  // Override panel state
  const [isOverrideOpen, setIsOverrideOpen] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState('approved');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);

  // Associated data: AI eligibility results and audit history
  const [aiResult, setAiResult] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingExtras, setLoadingExtras] = useState(false);

  useEffect(() => {
    if (!isOpen || !submission?.id) {
      setAiResult(null);
      setAuditLogs([]);
      setIsOverrideOpen(false);
      setOverrideReason('');
      setError('');
      setSuccessMsg('');
      return;
    }

    // Set default target status based on current status
    if (submission.status === 'eligible' || submission.status === 'needs_review') {
      setOverrideStatus('approved');
    } else if (submission.status === 'not_eligible') {
      setOverrideStatus('eligible');
    } else {
      setOverrideStatus('eligible');
    }

    let isMounted = true;
    setLoadingExtras(true);
    (async () => {
      try {
        const [result, logs] = await Promise.all([
          fetchEligibilityResult(submission.id),
          fetchAuditLogsForSubmission(submission.id),
        ]);
        if (isMounted) {
          setAiResult(result);
          setAuditLogs(logs || []);
        }
      } catch (err) {
        console.warn('Error fetching extras in modal:', err);
      } finally {
        if (isMounted) setLoadingExtras(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [isOpen, submission?.id, submission?.status]);

  if (!isOpen || !submission) return null;

  async function handleOverrideSubmit(e) {
    if (e) e.preventDefault();
    if (!overrideReason.trim()) {
      setError('Please provide a mandatory reason for overriding the status.');
      return;
    }

    if (overrideStatus === submission.status) {
      setError('Selected target status is already the current status.');
      return;
    }

    setOverrideSubmitting(true);
    setError('');
    setSuccessMsg('');

    try {
      const adminId = profile?.id || user?.id;
      const { updatedSub, auditEntry } = await overrideSubmissionVerdict({
        submissionId: submission.id,
        previousStatus: submission.status,
        newStatus: overrideStatus,
        reason: overrideReason.trim(),
        adminId,
      });

      setSuccessMsg(`Status successfully updated to "${overrideStatus}".`);
      setOverrideReason('');
      setIsOverrideOpen(false);

      // Refresh audit logs
      setAuditLogs((prev) => [
        {
          ...auditEntry,
          performer: {
            id: adminId,
            email: user?.email,
            full_name: profile?.full_name || 'Admin',
          },
        },
        ...prev,
      ]);

      if (onStatusUpdated) {
        onStatusUpdated({ ...submission, ...updatedSub, status: overrideStatus });
      }

      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      setError(err.message || 'Failed to update submission status.');
    } finally {
      setOverrideSubmitting(false);
    }
  }

  async function handleViewDoc(doc) {
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

  const clientName = submission.client?.full_name || submission.client?.email || 'Unknown Client';
  const clientEmail = submission.client?.email || '—';
  const policyName = submission.policy?.name || 'Policy';
  const docs = submission.documents || submission.submission_documents || [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        style={{ maxWidth: '780px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ margin: 0 }}>Review Application</h2>
              <SubmissionStatusBadge status={submission.status} />
            </div>
            <p className="card-subtitle" style={{ marginTop: '4px' }}>
              Applied for <strong>{policyName}</strong>
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        {/* Scrollable Body */}
        <div style={{
          padding: '20px 24px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}>
          {error && (
            <div className="form-error">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {error}
            </div>
          )}

          {successMsg && (
            <div className="alert-success">
              {successMsg}
            </div>
          )}

          {/* Applicant Info Box */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '12px',
            padding: '14px 16px',
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            fontSize: '0.875rem',
          }}>
            <div>
              <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
                Applicant Name
              </div>
              <div style={{ fontWeight: 600, marginTop: '2px', color: 'var(--color-text-primary)' }}>
                {clientName}
              </div>
            </div>

            <div>
              <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
                Applicant Email
              </div>
              <div style={{ marginTop: '2px', color: 'var(--color-text-secondary)' }}>
                {clientEmail}
              </div>
            </div>

            <div>
              <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
                Submitted On
              </div>
              <div style={{ marginTop: '2px', color: 'var(--color-text-secondary)' }}>
                {new Date(submission.submitted_at).toLocaleDateString(undefined, {
                  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </div>
            </div>
          </div>

          {/* AI Assessment Summary (if available) */}
          {aiResult && (
            <div style={{
              background: 'var(--color-surface-2)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              padding: '16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2">
                    <path d="M12 2a10 10 0 0 1 10 10c0 5.52-4.48 10-10 10S2 17.52 2 12 6.48 2 12 2z" />
                    <path d="m9 12 2 2 4-4" />
                  </svg>
                  <h4 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)' }}>
                    AI Eligibility Assessment
                  </h4>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {typeof aiResult.confidence_score === 'number' && (
                    <span className="confidence-pill" style={{ fontSize: '0.75rem' }}>
                      {aiResult.confidence_score}% Confidence
                    </span>
                  )}
                  <SubmissionStatusBadge status={aiResult.verdict} />
                </div>
              </div>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                {aiResult.summary || 'No summary text available.'}
              </p>
            </div>
          )}

          {/* Submitted Documents Checklist */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <h3 style={{ fontSize: '0.9375rem', margin: 0, fontWeight: 600 }}>
                Submitted Documents ({docs.length})
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                Private personal verification files
              </span>
            </div>

            {docs.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                No documents were attached to this submission.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {docs.map((doc) => {
                  const meta = REQUIRED_DOC_TYPES.find((d) => d.type === doc.document_type);
                  return (
                    <div key={doc.id} className="doc-row-existing" style={{ background: 'var(--color-bg-card)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                          stroke="var(--color-accent)" strokeWidth="1.75" style={{ flexShrink: 0 }}>
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                        </svg>
                        <div style={{ minWidth: 0 }}>
                          <div className="doc-row-name" title={doc.filename}>
                            {doc.filename}
                          </div>
                          <div className="doc-row-size">
                            {formatFileSize(doc.file_size)}
                          </div>
                        </div>
                      </div>

                      <span className="doc-row-type">
                        {meta?.label ?? doc.document_type}
                      </span>

                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ flexShrink: 0 }}
                        onClick={() => handleViewDoc(doc)}
                        disabled={viewingDocId === doc.id}
                        title="Open in browser"
                      >
                        {viewingDocId === doc.id ? (
                          <><span className="btn-spinner-dark" /> Opening…</>
                        ) : (
                          <>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                            View Document
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── OVERRIDE PANEL (Step 6 Requirement) ── */}
          <div className={`admin-override-card ${isOverrideOpen ? 'open' : ''}`}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--color-text)' }}>
                  Manual Verdict Override & Audit
                </span>
              </div>
              <button
                type="button"
                className={`btn btn-sm ${isOverrideOpen ? 'btn-ghost' : 'btn-primary'}`}
                onClick={() => setIsOverrideOpen(!isOverrideOpen)}
              >
                {isOverrideOpen ? 'Close Form' : '⚡ Override Verdict'}
              </button>
            </div>

            {isOverrideOpen && (
              <form onSubmit={handleOverrideSubmit} className="admin-override-form">
                <div className="admin-override-banner">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px', color: 'var(--color-accent)' }}>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>
                    As an administrator, you may manually override the application's verdict. A detailed justification is required and will be permanently recorded in the immutable audit log.
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: '6px' }}>
                      Target Status <span style={{ color: 'var(--color-error)' }}>*</span>
                    </label>
                    <select
                      className="form-select"
                      value={overrideStatus}
                      onChange={(e) => setOverrideStatus(e.target.value)}
                      disabled={overrideSubmitting}
                      style={{ width: '100%', fontSize: '0.875rem' }}
                    >
                      <option value="eligible">eligible (AI Verdict)</option>
                      <option value="not_eligible">not_eligible (AI Verdict)</option>
                      <option value="needs_review">needs_review (AI Verdict)</option>
                      <option value="approved">approved (Final Admin)</option>
                      <option value="rejected">rejected (Final Admin)</option>
                    </select>
                  </div>
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
                      Reason for Override <span style={{ color: 'var(--color-error)' }}>*</span>
                    </label>
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, color: overrideReason.trim() ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                      {overrideReason.trim() ? '✓ Justification provided' : 'Justification required'}
                    </span>
                  </div>
                  <div className="override-textarea-wrapper">
                    <textarea
                      className="override-textarea"
                      rows={3}
                      placeholder="E.g., Client submitted verified proof of recurring salary offline; employer confirmed full-time tenure on Sept 6."
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      disabled={overrideSubmitting}
                    />
                    <div className="override-textarea-footer">
                      <div className="override-audit-indicator">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                        <span>Saved to system audit log with your admin identity</span>
                      </div>
                      <span>{overrideReason.length} characters</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={overrideSubmitting}
                    onClick={() => {
                      setIsOverrideOpen(false);
                      setOverrideReason('');
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={overrideSubmitting || !overrideReason.trim() || overrideStatus === submission.status}
                  >
                    {overrideSubmitting ? 'Recording Override...' : 'Confirm & Save Override'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Audit Trail for this Submission */}
          {auditLogs.length > 0 && (
            <div>
              <h4 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
                Decision History & Audit Trail ({auditLogs.length})
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`audit-history-item ${log.action === 'admin_override' ? 'is-override' : 'is-ai'}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={`sub-status-badge ${log.action === 'admin_override' ? 'badge-override' : 'badge-ai'}`}>
                          {log.action === 'admin_override' ? '⚡ Admin Override' : '🤖 AI Verdict'}
                        </span>
                        <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                          {log.previous_status ? `${log.previous_status} → ` : ''}{log.new_status}
                        </span>
                      </div>
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
                        {new Date(log.created_at).toLocaleString()}
                      </span>
                    </div>
                    {log.reason && (
                      <div className="audit-reason-quote">
                        "{log.reason}"
                      </div>
                    )}
                    <div style={{ marginTop: '6px', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      Recorded by: <strong style={{ color: 'var(--color-text-secondary)' }}>{log.performer?.full_name || log.performer?.email || (log.action === 'admin_override' ? 'Administrator' : 'AI System')}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div style={{
          borderTop: '1px solid var(--color-border)',
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          flexShrink: 0,
          background: 'var(--color-bg)',
        }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>Current Status:</span>
            <SubmissionStatusBadge status={submission.status} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {!isOverrideOpen && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setIsOverrideOpen(true)}
              >
                ⚡ Override Verdict
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
