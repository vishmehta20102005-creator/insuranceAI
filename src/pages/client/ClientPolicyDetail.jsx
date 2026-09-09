import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import {
  REQUIRED_DOC_TYPES,
  fetchLatestSubmissionForPolicy,
  createSubmission,
  uploadSubmissionDocument,
  getSubmissionDocumentSignedUrl,
  fetchEligibilityResult,
} from '../../lib/submissions';
import EligibilityResultCard from '../../components/client/EligibilityResultCard';

// ─── helpers ────────────────────────────────────────────────────────────────

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

// ─── main component ──────────────────────────────────────────────────────────

export default function ClientPolicyDetail() {
  const { id: policyId } = useParams();
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();

  // ── page-level state
  const [policy,     setPolicy]     = useState(null);
  const [submission, setSubmission] = useState(null); // most recent submission or null
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError,   setPageError]   = useState('');

  // ── upload form state (one file per type)
  // { id_proof: File|null, medical_report: File|null, ... }
  const initialFiles = () =>
    Object.fromEntries(REQUIRED_DOC_TYPES.map(({ type }) => [type, null]));

  const [files,         setFiles]         = useState(initialFiles);
  const [submitting,    setSubmitting]    = useState(false);
  const [uploadStep,    setUploadStep]    = useState(''); // progress message
  const [submitError,   setSubmitError]   = useState('');
  const [isProcessingEligibility, setIsProcessingEligibility] = useState(false);
  const [eligibilityResult, setEligibilityResult] = useState(null);
  const [loadingResult,     setLoadingResult]     = useState(false);
  const [viewingDocId,  setViewingDocId]  = useState(null);
  const [showSubmittedDocs, setShowSubmittedDocs] = useState(false);

  const fileInputRefs = useRef({}); // { [type]: HTMLInputElement }

  // ── fetch eligibility result whenever submission has an AI verdict
  useEffect(() => {
    if (!submission?.id) {
      setEligibilityResult(null);
      return;
    }

    if (['eligible', 'not_eligible', 'needs_review', 'approved', 'rejected'].includes(submission.status)) {
      let isMounted = true;
      setLoadingResult(true);
      (async () => {
        try {
          const res = await fetchEligibilityResult(submission.id);
          if (isMounted) setEligibilityResult(res);
        } catch (err) {
          console.error('Failed to load eligibility result:', err);
        } finally {
          if (isMounted) setLoadingResult(false);
        }
      })();
      return () => {
        isMounted = false;
      };
    } else {
      setEligibilityResult(null);
    }
  }, [submission?.id, submission?.status]);

  // ── load policy + check existing submission
  useEffect(() => {
    if (!user) return;
    (async () => {
      setPageLoading(true);
      setPageError('');
      try {
        // Fetch the published policy
        const { data: pol, error: polErr } = await supabase
          .from('policies')
          .select('*')
          .eq('id', policyId)
          .eq('status', 'published')
          .single();
        if (polErr) throw polErr;
        setPolicy(pol);

        // Check for the most recent submission by this client for this policy
        const existing = await fetchLatestSubmissionForPolicy(policyId, user.id);
        setSubmission(existing);
      } catch (err) {
        setPageError(err.message || 'Failed to load policy.');
      } finally {
        setPageLoading(false);
      }
    })();
  }, [policyId, user]);

  // ── auto-poll if submission is currently processing in background
  useEffect(() => {
    if (submission?.status !== 'processing' || isProcessingEligibility) return;
    const interval = setInterval(async () => {
      try {
        const latest = await fetchLatestSubmissionForPolicy(policyId, user.id);
        if (latest && latest.status !== 'processing') {
          setSubmission(latest);
        }
      } catch (err) {
        console.error('Error polling submission:', err);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [submission?.status, isProcessingEligibility, policyId, user]);

  // ── file picker
  function handleFileChange(type, e) {
    const file = e.target.files?.[0] ?? null;
    setFiles((prev) => ({ ...prev, [type]: file }));
    // reset the input so the same file can be re-selected after clearing
    e.target.value = '';
  }

  function clearFile(type) {
    setFiles((prev) => ({ ...prev, [type]: null }));
  }

  const allSelected = REQUIRED_DOC_TYPES.every(({ type }) => files[type] !== null);

  // ── view submitted document in browser
  async function handleViewSubmissionDoc(doc) {
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

  // ── submit handler
  async function handleSubmit(e) {
    e.preventDefault();
    if (!allSelected) return;

    setSubmitting(true);
    setSubmitError('');
    setUploadStep('Creating submission…');

    let newSubmission;
    try {
      newSubmission = await createSubmission(user.id, policyId);
    } catch (err) {
      setSubmitError('Failed to create submission: ' + err.message);
      setSubmitting(false);
      setUploadStep('');
      return;
    }

    // Upload each document
    const uploadedDocs = [];
    for (let i = 0; i < REQUIRED_DOC_TYPES.length; i++) {
      const { type, label } = REQUIRED_DOC_TYPES[i];
      setUploadStep(`Uploading ${i + 1}/${REQUIRED_DOC_TYPES.length}: ${label}…`);
      try {
        const docRecord = await uploadSubmissionDocument(newSubmission.id, files[type], type);
        uploadedDocs.push(docRecord);
      } catch (err) {
        setSubmitError(`Failed uploading ${label}: ${err.message}`);
        setSubmitting(false);
        setUploadStep('');
        return;
      }
    }

    // Reset file selections
    setFiles(initialFiles());
    if (fileInputRefs.current) {
      Object.values(fileInputRefs.current).forEach((input) => {
        if (input) input.value = '';
      });
    }

    // Transition to processing state
    setSubmitting(false);
    setUploadStep('');
    setIsProcessingEligibility(true);
    setSubmission({ ...newSubmission, status: 'processing', submission_documents: uploadedDocs });

    // Automatically call check-eligibility Edge Function using client session token
    try {
      const { data: fnResult, error: fnErr } = await supabase.functions.invoke('check-eligibility', {
        body: { submission_id: newSubmission.id },
      });

      if (fnErr) {
        console.error('[check-eligibility] Function error:', fnErr);
      } else {
        console.log('[check-eligibility] Success:', fnResult);
      }
    } catch (callErr) {
      console.error('[check-eligibility] Call error:', callErr);
    } finally {
      // Refresh submission from database so view immediately reflects the new status
      try {
        const refreshed = await fetchLatestSubmissionForPolicy(policyId, user.id);
        if (refreshed) {
          setSubmission(refreshed);
          if (['eligible', 'not_eligible', 'needs_review'].includes(refreshed.status)) {
            try {
              const aiRes = await fetchEligibilityResult(refreshed.id);
              setEligibilityResult(aiRes);
            } catch (aiErr) {
              console.error('Error fetching eligibility result:', aiErr);
            }
          }
        }
      } catch (refreshErr) {
        console.error('[check-eligibility] Failed to refresh submission:', refreshErr);
      }
      setIsProcessingEligibility(false);
    }
  }

  // ── re-run AI assessment on existing submission without re-uploading
  async function handleRetryEligibility() {
    if (!submission?.id) return;
    setIsProcessingEligibility(true);
    try {
      const { data: fnResult, error: fnErr } = await supabase.functions.invoke('check-eligibility', {
        body: { submission_id: submission.id },
      });
      if (fnErr) {
        console.error('[check-eligibility] Retry error:', fnErr);
      } else {
        console.log('[check-eligibility] Retry success:', fnResult);
      }
    } catch (callErr) {
      console.error('[check-eligibility] Retry call error:', callErr);
    } finally {
      try {
        const refreshed = await fetchLatestSubmissionForPolicy(policyId, user.id);
        if (refreshed) {
          setSubmission(refreshed);
          const aiRes = await fetchEligibilityResult(refreshed.id);
          setEligibilityResult(aiRes);
        }
      } catch (refreshErr) {
        console.error('[check-eligibility] Failed to refresh submission:', refreshErr);
      }
      setIsProcessingEligibility(false);
    }
  }

  // ── sign out
  async function handleSignOut() {
    await signOut();
    navigate('/login', { replace: true });
  }

  // ─── render states ────────────────────────────────────────────────────────

  if (pageLoading) {
    return (
      <div className="page-loader">
        <div className="spinner" />
      </div>
    );
  }

  // Derive whether to show the upload form
  // Block on pending/processing (check in flight) and approved/eligible (already resolved).
  // Allow resubmission on rejected, not_eligible, or needs_review (recoverable outcomes).
  const BLOCKING_STATUSES = ['pending', 'processing', 'approved', 'eligible'];
  const RESUBMIT_STATUSES = ['rejected', 'not_eligible', 'needs_review'];
  const isBlocked = submission && BLOCKING_STATUSES.includes(submission.status);
  const canResubmit = submission && RESUBMIT_STATUSES.includes(submission.status);
  const showForm  = !isBlocked;

  return (
    <div className="dashboard-layout">
      {/* Header */}
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
          <div className="dashboard-user">
            <span className="dashboard-user-name">{profile?.full_name || profile?.email}</span>
            <button onClick={handleSignOut} className="btn btn-ghost btn-sm">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-container">
          {/* Breadcrumb */}
          <div className="breadcrumb">
            <Link to="/client/policies" className="breadcrumb-link">
              ← Back to Policies
            </Link>
          </div>

          {/* Page error */}
          {pageError && (
            <div className="form-error" style={{ marginBottom: '24px' }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {pageError}
            </div>
          )}

          {policy && (
            <>
              {/* Policy summary card */}
              <div className="card" style={{ marginBottom: '28px' }}>
                <div className="card-header">
                  <div>
                    <h1 style={{ fontSize: '1.375rem' }}>{policy.name}</h1>
                    {policy.description && (
                      <p className="card-subtitle" style={{ marginTop: '6px' }}>
                        {policy.description}
                      </p>
                    )}
                  </div>
                  <span className={`badge-category badge-category-${policy.category}`}>
                    {policy.category}
                  </span>
                </div>
              </div>

              {/* ── PROCESSING STATE OR SUBMISSION STATUS + FORM ── */}
              {isProcessingEligibility ? (
                /* Clear loading state while Edge Function evaluates eligibility */
                <div className="card processing-application-card" style={{ marginBottom: '28px', padding: '48px 24px' }}>
                  <div className="spinner" style={{ width: '40px', height: '40px', margin: '0 auto 18px' }} />
                  <h2 style={{ fontSize: '1.375rem', fontWeight: 600, color: 'var(--color-text)' }}>
                    Processing your application...
                  </h2>
                  <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9375rem', maxWidth: '480px', margin: '10px auto 16px', lineHeight: 1.5 }}>
                    Your documents have been uploaded successfully. Our AI system is currently evaluating your eligibility against the policy criteria. This may take several seconds...
                  </p>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '6px 16px', background: 'var(--color-surface-2)', borderRadius: '9999px', fontSize: '0.8125rem', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                    <span className="processing-pulse" />
                    <span>Analyzing documents with AI</span>
                  </div>
                </div>
              ) : (
                <>
                  {/* ── EXISTING SUBMISSION STATUS OR AI RESULTS ── */}
                  {submission && (
                    <>
                      {/* Loading state for eligibility results */}
                      {loadingResult && !eligibilityResult && (
                        <div className="card" style={{ marginBottom: '28px', padding: '36px', textAlign: 'center' }}>
                          <div className="spinner" style={{ width: '32px', height: '32px', margin: '0 auto 14px' }} />
                          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 6px' }}>
                            Loading eligibility analysis...
                          </h3>
                          <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem', margin: 0 }}>
                            Retrieving verification report and rule citations...
                          </p>
                        </div>
                      )}

                      {/* AI Eligibility Result Screen */}
                      {eligibilityResult && ['eligible', 'not_eligible', 'needs_review', 'approved', 'rejected'].includes(submission.status) ? (
                        <EligibilityResultCard
                          submission={submission}
                          result={eligibilityResult}
                          canResubmit={canResubmit}
                          isRetrying={isProcessingEligibility}
                          onRetryEligibility={handleRetryEligibility}
                          onScrollToResubmit={() => {
                            document.getElementById('upload-form-section')?.scrollIntoView({ behavior: 'smooth' });
                          }}
                        />
                      ) : null}

                      {/* Submitted Documents & Status Card (shown only if no AI eligibility result exists) */}
                      {(!eligibilityResult || !['eligible', 'not_eligible', 'needs_review', 'approved', 'rejected'].includes(submission.status)) ? (
                        <div className="card" style={{ marginBottom: '28px' }}>
                          <div className="card-header">
                            <div>
                              <h2>
                                {canResubmit
                                  ? 'Previous Submission'
                                  : 'Your Submission'}
                              </h2>
                              <p className="card-subtitle">
                                Submitted on{' '}
                                {new Date(submission.submitted_at).toLocaleDateString(undefined, {
                                  day: 'numeric', month: 'long', year: 'numeric',
                                })}
                              </p>
                            </div>
                            <SubmissionStatusBadge status={submission.status} />
                          </div>

                          {/* Docs list */}
                          {submission.submission_documents?.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {submission.submission_documents.map((doc) => {
                                const meta = REQUIRED_DOC_TYPES.find((d) => d.type === doc.document_type);
                                return (
                                  <div key={doc.id} className="doc-row-existing">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                                        stroke="var(--color-accent)" strokeWidth="1.75" style={{ flexShrink: 0 }}>
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                        <polyline points="14 2 14 8 20 8" />
                                      </svg>
                                      <div style={{ minWidth: 0 }}>
                                        <div className="doc-row-name" title={doc.filename}>{doc.filename}</div>
                                        <div className="doc-row-size">{formatFileSize(doc.file_size)}</div>
                                      </div>
                                    </div>
                                    <span className="doc-row-type">{meta?.label ?? doc.document_type}</span>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      style={{ flexShrink: 0 }}
                                      onClick={() => handleViewSubmissionDoc(doc)}
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
                                          View
                                        </>
                                      )}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {canResubmit && (
                            <div className="rejection-notice">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                              </svg>
                              {submission.status === 'rejected'
                                ? 'Your previous submission was rejected. You can submit new documents below.'
                                : submission.status === 'not_eligible'
                                ? 'You were found not eligible. You can resubmit with corrected documents.'
                                : 'Your submission needs review. You may resubmit with updated documents if needed.'}
                            </div>
                          )}

                          {isBlocked && (
                            <p style={{ marginTop: '16px', fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
                              {submission.status === 'pending'
                                ? 'Your application is currently under review. Document re-upload is locked while pending.'
                                : submission.status === 'processing'
                                ? 'Your documents are being analyzed by AI. Please wait for results.'
                                : submission.status === 'eligible'
                                ? 'Your application has been verified as eligible. Thank you!'
                                : submission.status === 'approved'
                                ? 'Your application has been approved. Thank you!'
                                : null}
                            </p>
                          )}
                        </div>
                      ) : (
                        /* Submitted Documents Card shown when EligibilityResultCard is visible */
                        <div className="card" style={{ marginBottom: '28px' }}>
                          <div
                            className="card-header"
                            style={{
                              marginBottom: showSubmittedDocs ? '14px' : '0',
                              cursor: 'pointer',
                              userSelect: 'none',
                            }}
                            onClick={() => setShowSubmittedDocs((prev) => !prev)}
                          >
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <h3 style={{ fontSize: '1.0625rem', fontWeight: 600, margin: 0, color: 'var(--color-text-primary)' }}>
                                  Submitted Application Documents
                                </h3>
                                <span className="doc-count-pill">
                                  {submission.submission_documents?.length || 0} documents
                                </span>
                              </div>
                              <p className="card-subtitle" style={{ marginTop: '4px' }}>
                                Uploaded on{' '}
                                {new Date(submission.submitted_at).toLocaleDateString(undefined, {
                                  day: 'numeric', month: 'long', year: 'numeric',
                                })}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              style={{ gap: '6px' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowSubmittedDocs((prev) => !prev);
                              }}
                            >
                              <span>{showSubmittedDocs ? 'Hide Documents' : 'View Documents'}</span>
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                style={{
                                  transform: showSubmittedDocs ? 'rotate(180deg)' : 'rotate(0deg)',
                                  transition: 'transform 0.15s ease',
                                }}
                              >
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </button>
                          </div>

                          {showSubmittedDocs && submission.submission_documents?.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                              {submission.submission_documents.map((doc) => {
                                const meta = REQUIRED_DOC_TYPES.find((d) => d.type === doc.document_type);
                                return (
                                  <div key={doc.id} className="doc-row-existing">
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                                        stroke="var(--color-accent)" strokeWidth="1.75" style={{ flexShrink: 0 }}>
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                        <polyline points="14 2 14 8 20 8" />
                                      </svg>
                                      <div style={{ minWidth: 0 }}>
                                        <div className="doc-row-name" title={doc.filename}>{doc.filename}</div>
                                        <div className="doc-row-size">{formatFileSize(doc.file_size)}</div>
                                      </div>
                                    </div>
                                    <span className="doc-row-type">{meta?.label ?? doc.document_type}</span>
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-sm"
                                      style={{ flexShrink: 0 }}
                                      onClick={() => handleViewSubmissionDoc(doc)}
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
                                          View
                                        </>
                                      )}
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* ── UPLOAD FORM ── */}
                  {showForm && (
                    <div className="card" id="upload-form-section">
                      <div className="card-header" style={{ marginBottom: '8px' }}>
                        <div>
                          <h2>
                            {canResubmit
                              ? 'Resubmit Application'
                              : 'Apply for this Policy'}
                          </h2>
                          <p className="card-subtitle">
                            Upload one file for each required document type. All four are required.
                          </p>
                        </div>
                      </div>

                    {submitError && (
                      <div className="form-error" style={{ marginBottom: '20px' }}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                        {submitError}
                      </div>
                    )}

                    <form onSubmit={handleSubmit}>
                      <div className="upload-checklist">
                        {REQUIRED_DOC_TYPES.map(({ type, label, hint }) => {
                          const selectedFile = files[type];
                          return (
                            <div
                              key={type}
                              className={`upload-checklist-row ${selectedFile ? 'row-ready' : ''}`}
                            >
                              {/* Status indicator */}
                              <div className="checklist-indicator">
                                {selectedFile ? (
                                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                                    <circle cx="10" cy="10" r="10" fill="var(--color-accent)" />
                                    <polyline points="5 10 8.5 13.5 15 7"
                                      stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                ) : (
                                  <div className="checklist-empty-dot" />
                                )}
                              </div>

                              {/* Label + hint */}
                              <div className="checklist-label-group">
                                <span className="checklist-label">{label}</span>
                                <span className="checklist-hint">{hint}</span>
                              </div>

                              {/* File info or picker */}
                              <div className="checklist-file-area">
                                {selectedFile ? (
                                  <div className="checklist-file-selected">
                                    <span className="checklist-filename" title={selectedFile.name}>
                                      {selectedFile.name}
                                    </span>
                                    <span className="checklist-filesize">
                                      {formatFileSize(selectedFile.size)}
                                    </span>
                                    <button
                                      type="button"
                                      className="checklist-clear-btn"
                                      onClick={() => clearFile(type)}
                                      title="Remove file"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => fileInputRefs.current[type]?.click()}
                                  >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                                      stroke="currentColor" strokeWidth="2">
                                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                      <polyline points="17 8 12 3 7 8" />
                                      <line x1="12" y1="3" x2="12" y2="15" />
                                    </svg>
                                    Choose file
                                  </button>
                                )}
                                <input
                                  ref={(el) => { fileInputRefs.current[type] = el; }}
                                  type="file"
                                  accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                                  onChange={(e) => handleFileChange(type, e)}
                                  style={{ display: 'none' }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Progress */}
                      {submitting && uploadStep && (
                        <div className="upload-progress-row">
                          <div className="btn-spinner-dark" />
                          <span>{uploadStep}</span>
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
                        <button
                          type="submit"
                          className="btn btn-primary"
                          disabled={!allSelected || submitting}
                        >
                          {submitting ? (
                            <>
                              <span className="btn-spinner" />
                              Uploading…
                            </>
                          ) : (
                            <>
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                                stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="17 8 12 3 7 8" />
                                <line x1="12" y1="3" x2="12" y2="15" />
                              </svg>
                              Submit Application
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
      </main>
    </div>
  );
}
