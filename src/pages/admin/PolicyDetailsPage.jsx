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
  fetchPolicyCategories,
  createPolicyCategory,
  fetchPolicyRequiredDocuments,
  addPolicyRequiredDocument,
  updatePolicyRequiredDocument,
  deletePolicyRequiredDocument,
  reorderPolicyRequiredDocuments,
} from '../../lib/policies';
import { fetchSubmissionsForPolicyAdmin } from '../../lib/submissions';
import ReviewSubmissionModal from '../../components/admin/ReviewSubmissionModal';

const PRESET_REQUIRED_DOCS = [
  { key: 'vehicle_rc', label: 'Vehicle Registration Certificate (RC)' },
  { key: 'driving_license', label: 'Valid Driving License' },
  { key: 'vehicle_photos', label: 'Vehicle Inspection Photographs' },
  { key: 'id_proof', label: 'Government Photo ID' },
  { key: 'income_proof', label: 'Income Proof / Salary Slip' },
  { key: 'medical_report', label: 'Recent Medical Examination Report' },
  { key: 'age_proof', label: 'Age Proof Certificate' },
  { key: 'previous_policy', label: 'Previous Insurance Policy Copy' },
  { key: 'address_proof', label: 'Proof of Permanent Address' },
];

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

  // Category state
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState('');
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState('');

  // Required documents state
  const [requiredDocs, setRequiredDocs] = useState([]);
  const [loadingReqDocs, setLoadingReqDocs] = useState(false);
  const [isReqDocModalOpen, setIsReqDocModalOpen] = useState(false);
  const [editingReqDoc, setEditingReqDoc] = useState(null);
  const [docTypeKey, setDocTypeKey] = useState('');
  const [docLabel, setDocLabel] = useState('');
  const [docOrder, setDocOrder] = useState(1);
  const [savingReqDoc, setSavingReqDoc] = useState(false);
  const [reqDocError, setReqDocError] = useState('');
  const [deletingReqDocId, setDeletingReqDocId] = useState(null);
  const [confirmingReqDocId, setConfirmingReqDocId] = useState(null);

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
      const [data, subsData, catsData, reqDocsData] = await Promise.all([
        fetchPolicyById(id),
        fetchSubmissionsForPolicyAdmin(id),
        fetchPolicyCategories(),
        fetchPolicyRequiredDocuments(id),
      ]);
      setPolicy(data);
      setSubmissions(subsData || []);
      setCategories(catsData || []);
      setRequiredDocs(reqDocsData || []);
      setName(data.name || '');
      setCategoryId(data.category_id || (catsData && catsData.length > 0 ? catsData[0].id : ''));
      setCategory(data.category || 'health');
      setStatus(data.status || 'draft');
      setDescription(data.description || '');
    } catch (err) {
      setError(err.message || 'Failed to load policy.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCategoryInline(e) {
    if (e) e.preventDefault();
    setCategoryError('');
    if (!newCatName.trim()) {
      setCategoryError('Category name is required.');
      return;
    }
    setSavingCategory(true);
    try {
      const created = await createPolicyCategory({
        name: newCatName.trim(),
        description: newCatDesc.trim() || null,
      });
      setNewCatName('');
      setNewCatDesc('');
      setIsCreatingCategory(false);
      const allCats = await fetchPolicyCategories();
      setCategories(allCats);
      setCategoryId(created.id);
    } catch (err) {
      setCategoryError(err.message || 'Failed to create category.');
    } finally {
      setSavingCategory(false);
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
      const matchedCat = categories.find((c) => c.id === categoryId);
      const updated = await updatePolicy(id, {
        name: name.trim(),
        category_id: categoryId || null,
        category: matchedCat ? matchedCat.name : category,
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

  function openAddReqDocModal() {
    setEditingReqDoc(null);
    setDocTypeKey('');
    setDocLabel('');
    setDocOrder(requiredDocs.length + 1);
    setReqDocError('');
    setIsReqDocModalOpen(true);
  }

  function openEditReqDocModal(doc) {
    setEditingReqDoc(doc);
    setDocTypeKey(doc.document_type);
    setDocLabel(doc.label);
    setDocOrder(doc.display_order || 1);
    setReqDocError('');
    setIsReqDocModalOpen(true);
  }

  function handleSelectPresetDoc(preset) {
    setDocTypeKey(preset.key);
    setDocLabel(preset.label);
    setReqDocError('');
  }

  async function handleSaveReqDoc(e) {
    if (e) e.preventDefault();
    setReqDocError('');

    if (!docLabel.trim()) {
      setReqDocError('Document display label is required.');
      return;
    }

    const cleanKey = docTypeKey
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '');

    if (!cleanKey) {
      setReqDocError('Machine-readable document type key is required.');
      return;
    }

    // Check duplicate key
    const isDuplicate = requiredDocs.some(
      (d) => d.document_type === cleanKey && (!editingReqDoc || d.id !== editingReqDoc.id)
    );
    if (isDuplicate) {
      setReqDocError(`Document type key "${cleanKey}" already exists for this policy.`);
      return;
    }

    setSavingReqDoc(true);
    try {
      if (editingReqDoc) {
        const updated = await updatePolicyRequiredDocument(editingReqDoc.id, {
          document_type: cleanKey,
          label: docLabel.trim(),
          display_order: Number(docOrder) || 1,
        });
        setRequiredDocs((prev) =>
          prev.map((d) => (d.id === editingReqDoc.id ? updated : d)).sort((a, b) => a.display_order - b.display_order)
        );
      } else {
        const created = await addPolicyRequiredDocument(id, {
          document_type: cleanKey,
          label: docLabel.trim(),
          display_order: Number(docOrder) || requiredDocs.length + 1,
        });
        setRequiredDocs((prev) => [...prev, created].sort((a, b) => a.display_order - b.display_order));
      }
      setIsReqDocModalOpen(false);
    } catch (err) {
      setReqDocError(err.message || 'Failed to save required document.');
    } finally {
      setSavingReqDoc(false);
    }
  }

  async function handleDeleteReqDoc(docId) {
    setDeletingReqDocId(docId);
    try {
      await deletePolicyRequiredDocument(docId);
      const remaining = requiredDocs.filter((d) => d.id !== docId);
      setRequiredDocs(remaining);
      setConfirmingReqDocId(null);
      await reorderPolicyRequiredDocuments(remaining);
    } catch (err) {
      alert('Failed to delete required document: ' + err.message);
    } finally {
      setDeletingReqDocId(null);
    }
  }

  async function handleMoveReqDoc(index, direction) {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= requiredDocs.length) return;

    const newDocs = [...requiredDocs];
    const temp = newDocs[index];
    newDocs[index] = newDocs[targetIdx];
    newDocs[targetIdx] = temp;

    const reordered = newDocs.map((doc, idx) => ({ ...doc, display_order: idx + 1 }));
    setRequiredDocs(reordered);

    try {
      await reorderPolicyRequiredDocuments(reordered);
    } catch (err) {
      console.error('Failed to save reordered documents:', err);
    }
  }

  async function handlePopulateStandardDefaults() {
    if (!window.confirm('Add the 4 standard insurance documents (ID, Medical, Income, Age Proof) to this policy?')) {
      return;
    }
    setLoadingReqDocs(true);
    try {
      const standard = [
        { document_type: 'id_proof', label: 'Government Photo ID', display_order: 1 },
        { document_type: 'medical_report', label: 'Recent Medical Report', display_order: 2 },
        { document_type: 'income_proof', label: 'Income Proof / Salary Slip', display_order: 3 },
        { document_type: 'age_proof', label: 'Age Proof Certificate', display_order: 4 },
      ];

      for (const item of standard) {
        if (!requiredDocs.some((d) => d.document_type === item.document_type)) {
          await addPolicyRequiredDocument(id, item);
        }
      }

      const refreshed = await fetchPolicyRequiredDocuments(id);
      setRequiredDocs(refreshed);
    } catch (err) {
      alert('Failed to populate default documents: ' + err.message);
    } finally {
      setLoadingReqDocs(false);
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
                  {categories.find((c) => c.id === (policy.category_id || categoryId))?.name || policy.category}
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <label htmlFor="edit-category" style={{ margin: 0 }}>Category</label>
                    {!isCreatingCategory && (
                      <button
                        type="button"
                        onClick={() => setIsCreatingCategory(true)}
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: '11px', padding: '2px 6px', height: 'auto' }}
                      >
                        + New
                      </button>
                    )}
                  </div>
                  {!isCreatingCategory ? (
                    <select
                      id="edit-category"
                      value={categoryId}
                      onChange={(e) => {
                        if (e.target.value === '__create_new__') {
                          setIsCreatingCategory(true);
                        } else {
                          setCategoryId(e.target.value);
                        }
                      }}
                      className="form-select"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                      <option value="__create_new__">+ Create New Category...</option>
                    </select>
                  ) : (
                    <div style={{
                      padding: '8px',
                      background: 'var(--color-surface-sunken)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '6px',
                      marginTop: '4px'
                    }}>
                      {categoryError && (
                        <div style={{ color: 'var(--color-danger)', fontSize: '11px', marginBottom: '4px' }}>
                          {categoryError}
                        </div>
                      )}
                      <input
                        type="text"
                        placeholder="Category name"
                        value={newCatName}
                        onChange={(e) => setNewCatName(e.target.value)}
                        style={{ width: '100%', marginBottom: '4px', padding: '4px 6px', fontSize: '12px' }}
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setIsCreatingCategory(false);
                            setCategoryError('');
                          }}
                          disabled={savingCategory}
                          style={{ fontSize: '11px', padding: '2px 6px' }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={handleCreateCategoryInline}
                          disabled={savingCategory || !newCatName.trim()}
                          style={{ fontSize: '11px', padding: '2px 6px' }}
                        >
                          {savingCategory ? 'Saving...' : 'Add'}
                        </button>
                      </div>
                    </div>
                  )}
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

          {/* ── Required Application Documents Card ── */}
          <div className="card" style={{ marginBottom: '28px' }}>
            <div className="card-header">
              <div>
                <h2>Required Application Documents</h2>
                <p className="card-subtitle">
                  Configure what documents applicants must upload when applying for this specific policy.
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span className="doc-count-badge">
                  {requiredDocs.length} {requiredDocs.length === 1 ? 'Required Doc' : 'Required Docs'}
                </span>
                <button
                  type="button"
                  onClick={openAddReqDocModal}
                  className="btn btn-primary btn-sm"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>Add Document Requirement</span>
                </button>
              </div>
            </div>

            {requiredDocs.length === 0 ? (
              <div style={{
                padding: '36px 20px',
                textAlign: 'center',
                background: 'var(--color-surface-sunken)',
                borderRadius: '8px',
                border: '1px dashed var(--color-border)',
                margin: '16px 0'
              }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>📋</div>
                <h4 style={{ margin: '0 0 6px' }}>No required documents configured</h4>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '13px', maxWidth: '460px', margin: '0 auto 16px' }}>
                  Applicants currently won't have a required checklist for this policy. Add custom document requirements or load standard defaults.
                </p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={openAddReqDocModal}
                    className="btn btn-primary btn-sm"
                  >
                    + Add Custom Requirement
                  </button>
                  <button
                    type="button"
                    onClick={handlePopulateStandardDefaults}
                    className="btn btn-secondary btn-sm"
                    disabled={loadingReqDocs}
                  >
                    Load Standard 4 Documents (Health/Life)
                  </button>
                </div>
              </div>
            ) : (
              <div className="req-docs-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '60px', textAlign: 'center' }}>Order</th>
                      <th>Document Display Label</th>
                      <th>Machine Key</th>
                      <th style={{ width: '100px', textAlign: 'center' }}>Reorder</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requiredDocs.map((doc, idx) => (
                      <tr key={doc.id} className="req-doc-row">
                        <td style={{ textAlign: 'center' }}>
                          <span className="req-doc-order-badge">{idx + 1}</span>
                        </td>
                        <td>
                          <strong style={{ fontSize: '14px', color: 'var(--color-text)' }}>
                            {doc.label}
                          </strong>
                        </td>
                        <td>
                          <span className="req-doc-key-code">{doc.document_type}</span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div className="reorder-btn-group">
                            <button
                              type="button"
                              className="reorder-btn"
                              onClick={() => handleMoveReqDoc(idx, 'up')}
                              disabled={idx === 0}
                              title="Move up in checklist"
                            >
                              ▲
                            </button>
                            <button
                              type="button"
                              className="reorder-btn"
                              onClick={() => handleMoveReqDoc(idx, 'down')}
                              disabled={idx === requiredDocs.length - 1}
                              title="Move down in checklist"
                            >
                              ▼
                            </button>
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="table-row-actions">
                            <button
                              type="button"
                              onClick={() => openEditReqDocModal(doc)}
                              className="btn btn-ghost btn-sm"
                            >
                              Edit
                            </button>
                            {confirmingReqDocId === doc.id ? (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteReqDoc(doc.id)}
                                  className="btn btn-danger btn-sm"
                                  disabled={deletingReqDocId === doc.id}
                                >
                                  {deletingReqDocId === doc.id ? 'Deleting...' : 'Confirm'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmingReqDocId(null)}
                                  className="btn btn-ghost btn-sm"
                                  disabled={deletingReqDocId === doc.id}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmingReqDocId(doc.id)}
                                className="btn btn-danger-ghost btn-sm"
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
            )}
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

      {/* ── Add / Edit Required Document Modal ── */}
      {isReqDocModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsReqDocModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '540px' }}>
            <div className="modal-header">
              <h2>{editingReqDoc ? 'Edit Required Document' : 'Add Required Application Document'}</h2>
              <button
                className="modal-close-btn"
                onClick={() => setIsReqDocModalOpen(false)}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSaveReqDoc} className="modal-form">
              {reqDocError && (
                <div className="form-error" role="alert">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  {reqDocError}
                </div>
              )}

              {!editingReqDoc && (
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '4px', display: 'block' }}>
                    Quick Presets (click to autofill):
                  </label>
                  <div className="req-doc-preset-chips">
                    {PRESET_REQUIRED_DOCS.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        className="req-doc-preset-chip"
                        onClick={() => handleSelectPresetDoc(p)}
                      >
                        <span>{p.label}</span>
                        <code style={{ fontSize: '10px', opacity: 0.75 }}>({p.key})</code>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="req-doc-label">Display Label (shown to applicants) *</label>
                <input
                  id="req-doc-label"
                  type="text"
                  placeholder="e.g. Vehicle Registration Certificate (RC) or Driving License"
                  value={docLabel}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDocLabel(val);
                    if (!editingReqDoc && (!docTypeKey || docTypeKey === docLabel.toLowerCase().replace(/[^a-z0-9_]/g, '_'))) {
                      setDocTypeKey(val.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, ''));
                    }
                  }}
                  required
                  autoFocus
                />
              </div>

              <div className="form-row">
                <div className="form-group flex-2">
                  <label htmlFor="req-doc-key">Machine Key (system identifier) *</label>
                  <input
                    id="req-doc-key"
                    type="text"
                    placeholder="e.g. vehicle_rc, driving_license"
                    value={docTypeKey}
                    onChange={(e) => setDocTypeKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                    required
                  />
                  <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '3px', display: 'block' }}>
                    Alphanumeric and underscores only (e.g. <code>vehicle_rc</code>).
                  </span>
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="req-doc-order">Display Order</label>
                  <input
                    id="req-doc-order"
                    type="number"
                    min="1"
                    value={docOrder}
                    onChange={(e) => setDocOrder(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setIsReqDocModalOpen(false)}
                  disabled={savingReqDoc}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingReqDoc}
                >
                  {savingReqDoc ? <span className="btn-spinner" /> : null}
                  {savingReqDoc ? 'Saving...' : editingReqDoc ? 'Update Requirement' : 'Add Requirement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
