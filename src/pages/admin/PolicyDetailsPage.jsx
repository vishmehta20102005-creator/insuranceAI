import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  fetchPolicyById,
  updatePolicy,
  deletePolicy,
  uploadPolicyDocument,
  deletePolicyDocument,
  getDocumentSignedUrl,
} from '../../lib/policies';
import { fetchSubmissionsForPolicyAdmin } from '../../lib/submissions';
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

export default function PolicyDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { signOut, profile } = useAuth();
  const fileInputRef = useRef(null);

  const [policy, setPolicy] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [selectedSub, setSelectedSub] = useState(null);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Form state for policy updates
  const [name, setName] = useState('');
  const [category, setCategory] = useState('health');
  const [status, setStatus] = useState('draft');
  const [description, setDescription] = useState('');
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Staged files for upload
  const [stagedFiles, setStagedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  // Deleting state
  const [confirmingDocId, setConfirmingDocId] = useState(null);
  const [deletingDocId, setDeletingDocId] = useState(null);
  const [deletingPolicy, setDeletingPolicy] = useState(false);

  useEffect(() => {
    loadPolicy();
  }, [id]);

  async function loadPolicy() {
    setLoading(true);
    setError('');
    try {
      const [data, subsData] = await Promise.all([
        fetchPolicyById(id),
        fetchSubmissionsForPolicyAdmin(id),
      ]);
      setPolicy(data);
      setSubmissions(subsData || []);
      setName(data.name || '');
      setCategory(data.category || 'health');
      setStatus(data.status || 'draft');
      setDescription(data.description || '');
    } catch (err) {
      setError(err.message || 'Failed to load policy.');
    } finally {
      setLoading(false);
    }
  }

  function handleOpenReview(sub) {
    setSelectedSub({ ...sub, policy });
    setIsReviewOpen(true);
  }

  function handleStatusUpdated(updatedSub) {
    setSubmissions((prev) =>
      prev.map((s) => (s.id === updatedSub.id ? { ...s, ...updatedSub } : s))
    );
    setSelectedSub((prev) => (prev?.id === updatedSub.id ? { ...prev, ...updatedSub } : prev));
  }

  async function handleUpdatePolicy(e) {
    e.preventDefault();
    setSavingPolicy(true);
    setError('');
    setSaveSuccess(false);

    try {
      const updated = await updatePolicy(id, {
        name: name.trim(),
        category,
        status,
        description: description.trim() || null,
      });
      setPolicy((prev) => ({ ...prev, ...updated }));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err.message || 'Failed to update policy.');
    } finally {
      setSavingPolicy(false);
    }
  }

  async function handleDeletePolicy() {
    if (!window.confirm('Are you sure you want to delete this policy and all its documents? This action cannot be undone.')) {
      return;
    }

    setDeletingPolicy(true);
    try {
      await deletePolicy(id);
      navigate('/admin/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || 'Failed to delete policy.');
      setDeletingPolicy(false);
    }
  }

  function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const newStaged = files.map((file) => ({
      file,
      documentType: 'terms_and_conditions', // default tag
      id: Math.random().toString(36).substring(2),
    }));

    setStagedFiles((prev) => [...prev, ...newStaged]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function updateStagedFileType(stagedId, newType) {
    setStagedFiles((prev) =>
      prev.map((item) => (item.id === stagedId ? { ...item, documentType: newType } : item))
    );
  }

  function removeStagedFile(stagedId) {
    setStagedFiles((prev) => prev.filter((item) => item.id !== stagedId));
  }

  async function handleUploadAll() {
    if (!stagedFiles.length) return;

    setUploading(true);
    setError('');
    let successCount = 0;

    for (let i = 0; i < stagedFiles.length; i++) {
      const item = stagedFiles[i];
      setUploadProgress(`Uploading ${i + 1} of ${stagedFiles.length}: ${item.file.name}...`);
      try {
        await uploadPolicyDocument(id, item.file, item.documentType);
        successCount++;
      } catch (err) {
        setError(`Failed uploading ${item.file.name}: ${err.message}`);
        break;
      }
    }

    setUploading(false);
    setUploadProgress('');
    setStagedFiles([]);
    // Reload policy documents
    loadPolicy();
  }

  async function handleViewDocument(filePath) {
    try {
      const url = await getDocumentSignedUrl(filePath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      alert('Could not open document: ' + err.message);
    }
  }

  async function handleDeleteDocument(docId, filePath) {
    setDeletingDocId(docId);
    try {
      await deletePolicyDocument(docId, filePath);
      setPolicy((prev) => ({
        ...prev,
        documents: prev.documents.filter((d) => d.id !== docId),
      }));
      setConfirmingDocId(null);
    } catch (err) {
      alert('Failed to delete document: ' + err.message);
    } finally {
      setDeletingDocId(null);
    }
  }

  function formatFileSize(bytes) {
    if (!bytes) return '—';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  }

  function renderDocumentTypeBadge(type) {
    switch (type) {
      case 'terms_and_conditions':
        return <span className="doc-tag doc-tag-tc">Terms & Conditions</span>;
      case 'eligibility_criteria':
        return <span className="doc-tag doc-tag-criteria">Eligibility Criteria</span>;
      case 'exclusions':
        return <span className="doc-tag doc-tag-exclusions">Exclusions</span>;
      default:
        return <span className="doc-tag doc-tag-other">Other</span>;
    }
  }

  if (loading) {
    return (
      <div className="page-loader">
        <div className="spinner" />
      </div>
    );
  }

  if (!policy) {
    return (
      <div className="dashboard-layout">
        <div className="dashboard-container" style={{ padding: '40px 0', textAlign: 'center' }}>
          <h2>Policy not found</h2>
          <p style={{ color: 'var(--color-text-muted)', marginTop: '8px' }}>
            The policy you are looking for may have been removed.
          </p>
          <Link to="/admin/dashboard" className="btn btn-primary" style={{ marginTop: '16px' }}>
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

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
          {/* Breadcrumb */}
          <div className="breadcrumb">
            <Link to="/admin/dashboard" className="breadcrumb-link">
              ← Back to Policies
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

          {saveSuccess && (
            <div className="alert-success" style={{ marginBottom: '20px' }}>
              Policy details updated successfully!
            </div>
          )}

          {/* Policy Overview & Edit Card */}
          <div className="card" style={{ marginBottom: '28px' }}>
            <div className="card-header">
              <div>
                <h2>Policy Details</h2>
                <p className="card-subtitle">Edit policy metadata, target category, and publication status.</p>
              </div>
              <div className="policy-header-badges">
                <span className={`badge-status badge-status-${policy.status}`}>
                  {policy.status === 'published' ? '● Published' : '○ Draft'}
                </span>
                <span className={`badge-category badge-category-${policy.category}`}>
                  {policy.category}
                </span>
              </div>
            </div>

            <form onSubmit={handleUpdatePolicy} className="policy-edit-form">
              <div className="form-row">
                <div className="form-group flex-2">
                  <label htmlFor="edit-name">Policy Name</label>
                  <input
                    id="edit-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="edit-category">Category</label>
                  <select
                    id="edit-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="form-select"
                  >
                    <option value="health">Health Insurance</option>
                    <option value="life">Life Insurance</option>
                    <option value="vehicle">Vehicle Insurance</option>
                    <option value="travel">Travel Insurance</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="edit-status">Status</label>
                  <select
                    id="edit-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="form-select"
                  >
                    <option value="draft">Draft (Admin only)</option>
                    <option value="published">Published (Live to clients)</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="edit-description">Description</label>
                <textarea
                  id="edit-description"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="form-textarea"
                  placeholder="Summary of terms, benefits, and coverage limits..."
                />
              </div>

              <div className="form-actions-split">
                <button
                  type="button"
                  onClick={handleDeletePolicy}
                  className="btn btn-danger-ghost btn-sm"
                  disabled={deletingPolicy}
                >
                  {deletingPolicy ? 'Deleting...' : 'Delete Policy'}
                </button>

                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={savingPolicy}
                >
                  {savingPolicy ? <span className="btn-spinner" /> : null}
                  {savingPolicy ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>

          {/* Policy Documents Section */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2>Official Policy Documents</h2>
                <p className="card-subtitle">
                  Upload terms & conditions, eligibility rules, and exclusion lists. These documents are referenced by the AI during client evaluation.
                </p>
              </div>
              <div className="doc-count-badge">
                {policy.documents?.length || 0} {policy.documents?.length === 1 ? 'Document' : 'Documents'}
              </div>
            </div>

            {/* Upload Dropzone */}
            <div className="upload-dropzone">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                onChange={handleFileSelect}
                id="file-upload-input"
                style={{ display: 'none' }}
              />
              <div className="dropzone-inner" onClick={() => fileInputRef.current?.click()}>
                <div className="dropzone-icon">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div className="dropzone-text">
                  <span className="dropzone-primary-text">Click to browse or drag & drop files</span>
                  <span className="dropzone-secondary-text">PDF, DOCX, TXT, or scanned document images</span>
                </div>
              </div>
            </div>

            {/* Staged files waiting to be uploaded */}
            {stagedFiles.length > 0 && (
              <div className="staged-files-container">
                <div className="staged-files-header">
                  <h3>Staged Documents ({stagedFiles.length}) — Set Document Tags</h3>
                  <span className="staged-subtitle">Tag each document so the AI knows its exact role:</span>
                </div>

                <div className="staged-files-list">
                  {stagedFiles.map((item) => (
                    <div key={item.id} className="staged-file-row">
                      <div className="staged-file-info">
                        <span className="staged-file-name">{item.file.name}</span>
                        <span className="staged-file-size">({formatFileSize(item.file.size)})</span>
                      </div>

                      <div className="staged-file-tagging">
                        <label htmlFor={`tag-${item.id}`} className="staged-tag-label">Tag:</label>
                        <select
                          id={`tag-${item.id}`}
                          value={item.documentType}
                          onChange={(e) => updateStagedFileType(item.id, e.target.value)}
                          className="form-select form-select-sm"
                        >
                          <option value="terms_and_conditions">Terms & Conditions</option>
                          <option value="eligibility_criteria">Eligibility Criteria</option>
                          <option value="exclusions">Exclusions</option>
                          <option value="other">Other Supporting Doc</option>
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeStagedFile(item.id)}
                        className="btn-icon-danger"
                        title="Remove file"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>

                <div className="staged-actions">
                  <button
                    type="button"
                    onClick={() => setStagedFiles([])}
                    className="btn btn-ghost btn-sm"
                    disabled={uploading}
                  >
                    Clear All
                  </button>
                  <button
                    type="button"
                    onClick={handleUploadAll}
                    className="btn btn-primary btn-sm"
                    disabled={uploading}
                  >
                    {uploading ? <span className="btn-spinner" /> : null}
                    {uploading ? (uploadProgress || 'Uploading...') : `Upload ${stagedFiles.length} ${stagedFiles.length === 1 ? 'Document' : 'Documents'}`}
                  </button>
                </div>
              </div>
            )}

            {/* Uploaded Documents List */}
            <div className="uploaded-docs-section">
              {policy.documents && policy.documents.length > 0 ? (
                <div className="table-responsive">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Document</th>
                        <th>Document Tag</th>
                        <th>File Size</th>
                        <th>Uploaded</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {policy.documents.map((doc) => (
                        <tr key={doc.id}>
                          <td>
                            <div className="doc-file-cell">
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="doc-icon">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="16" y1="13" x2="8" y2="13" />
                                <line x1="16" y1="17" x2="8" y2="17" />
                                <polyline points="10 9 9 9 8 9" />
                              </svg>
                              <span className="doc-name-text" title={doc.filename}>{doc.filename}</span>
                            </div>
                          </td>
                          <td>{renderDocumentTypeBadge(doc.document_type)}</td>
                          <td className="cell-muted">{formatFileSize(doc.file_size)}</td>
                          <td className="cell-muted">
                            {new Date(doc.uploaded_at).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div className="table-row-actions">
                              <button
                                onClick={() => handleViewDocument(doc.file_path)}
                                className="btn btn-ghost btn-sm"
                                title="View or download document"
                              >
                                View
                              </button>
                              {confirmingDocId === doc.id ? (
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  <button
                                    onClick={() => handleDeleteDocument(doc.id, doc.file_path)}
                                    className="btn btn-danger btn-sm"
                                    disabled={deletingDocId === doc.id}
                                    title="Confirm deletion"
                                  >
                                    {deletingDocId === doc.id ? 'Deleting...' : 'Confirm'}
                                  </button>
                                  <button
                                    onClick={() => setConfirmingDocId(null)}
                                    className="btn btn-ghost btn-sm"
                                    disabled={deletingDocId === doc.id}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmingDocId(doc.id)}
                                  className="btn btn-danger-ghost btn-sm"
                                  title="Delete document"
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-docs-placeholder">
                  <p>No documents uploaded yet. Add policy T&Cs, eligibility rules, or exclusion lists above.</p>
                </div>
              )}
            </div>
          </div>

          {/* Client Applications for this Policy */}
          <div className="card" style={{ marginTop: '28px' }}>
            <div className="card-header">
              <div>
                <h2>Client Applications & Submitted Documents ({submissions.length})</h2>
                <p className="card-subtitle">
                  Review applicant documents (ID proof, medical reports, income proof, age proof) submitted for this policy.
                </p>
              </div>
            </div>

            {submissions.length === 0 ? (
              <div className="empty-docs-placeholder">
                <p>No clients have submitted applications or documents for this policy yet.</p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Applicant</th>
                      <th>Status</th>
                      <th>Submitted Docs</th>
                      <th>Submitted Date</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((sub) => {
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
                            <SubmissionStatusBadge status={sub.status} />
                          </td>
                          <td>
                            <span className="doc-count-pill">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                              </svg>
                              {docs.length} {docs.length === 1 ? 'doc' : 'docs'}
                            </span>
                          </td>
                          <td className="cell-muted">
                            {new Date(sub.submitted_at).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
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
            )}
          </div>

        </div>
      </main>

      {/* Review Submission Modal */}
      <ReviewSubmissionModal
        isOpen={isReviewOpen}
        onClose={() => setIsReviewOpen(false)}
        submission={selectedSub}
        onStatusUpdated={handleStatusUpdated}
      />
    </div>
  );
}
