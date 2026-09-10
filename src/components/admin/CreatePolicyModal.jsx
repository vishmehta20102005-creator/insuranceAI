import { useState, useEffect } from 'react';
import { createPolicy, fetchPolicyCategories, createPolicyCategory } from '../../lib/policies';
import { useAuth } from '../../contexts/AuthContext';

export default function CreatePolicyModal({ isOpen, onClose, onPolicyCreated }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('draft');
  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [loadingCategories, setLoadingCategories] = useState(false);

  // Inline category creation state
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryError, setCategoryError] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadCategories();
    }
  }, [isOpen]);

  async function loadCategories(selectIdAfterLoad = null) {
    setLoadingCategories(true);
    try {
      const data = await fetchPolicyCategories();
      setCategories(data || []);
      if (selectIdAfterLoad) {
        setSelectedCategoryId(selectIdAfterLoad);
      } else if (!selectedCategoryId && data && data.length > 0) {
        setSelectedCategoryId(data[0].id);
      }
    } catch (err) {
      console.error('Failed to load categories:', err);
    } finally {
      setLoadingCategories(false);
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
      const newCat = await createPolicyCategory({
        name: newCatName.trim(),
        description: newCatDesc.trim() || null,
      });

      setNewCatName('');
      setNewCatDesc('');
      setIsCreatingCategory(false);
      await loadCategories(newCat.id);
    } catch (err) {
      setCategoryError(err.message || 'Failed to create category.');
    } finally {
      setSavingCategory(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Policy name is required.');
      return;
    }

    if (!selectedCategoryId) {
      setError('Please select or create a policy category.');
      return;
    }

    const matchedCategory = categories.find((c) => c.id === selectedCategoryId);

    setSubmitting(true);
    try {
      const newPolicy = await createPolicy({
        name: name.trim(),
        description: description.trim() || null,
        category_id: selectedCategoryId,
        category: matchedCategory ? matchedCategory.name : 'Health Insurance',
        status,
        created_by: user?.id,
      });

      // Reset form
      setName('');
      setDescription('');
      setStatus('draft');
      setIsCreatingCategory(false);

      onPolicyCreated(newPolicy);
    } catch (err) {
      setError(err.message || 'Failed to create policy.');
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create New Policy</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {error && (
            <div className="form-error" role="alert">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              {error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="policy-name">Policy Name *</label>
            <input
              id="policy-name"
              type="text"
              placeholder="e.g. Comprehensive Motor Shield or Silver Health Plan"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-row">
            {/* Category selection with inline creation option */}
            <div className="form-group flex-1">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label htmlFor="policy-category" style={{ margin: 0 }}>Policy Category *</label>
                {!isCreatingCategory && (
                  <button
                    type="button"
                    onClick={() => setIsCreatingCategory(true)}
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '11px', padding: '2px 6px', height: 'auto' }}
                  >
                    + New Category
                  </button>
                )}
              </div>

              {!isCreatingCategory ? (
                <select
                  id="policy-category"
                  value={selectedCategoryId}
                  onChange={(e) => {
                    if (e.target.value === '__create_new__') {
                      setIsCreatingCategory(true);
                    } else {
                      setSelectedCategoryId(e.target.value);
                    }
                  }}
                  className="form-select"
                  disabled={loadingCategories}
                  required
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="__create_new__">+ Create New Category...</option>
                </select>
              ) : (
                <div className="category-inline-creator" style={{
                  padding: '10px',
                  backgroundColor: 'var(--color-surface-raised, rgba(0,0,0,0.02))',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  marginTop: '4px'
                }}>
                  {categoryError && (
                    <div style={{ color: 'var(--color-danger)', fontSize: '12px', marginBottom: '6px' }}>
                      {categoryError}
                    </div>
                  )}
                  <input
                    type="text"
                    placeholder="New category name (e.g. Car Insurance)"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    style={{ width: '100%', marginBottom: '6px', padding: '6px 8px', fontSize: '13px' }}
                    autoFocus
                  />
                  <input
                    type="text"
                    placeholder="Optional description"
                    value={newCatDesc}
                    onChange={(e) => setNewCatDesc(e.target.value)}
                    style={{ width: '100%', marginBottom: '8px', padding: '6px 8px', fontSize: '12px' }}
                  />
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setIsCreatingCategory(false);
                        setCategoryError('');
                      }}
                      disabled={savingCategory}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={handleCreateCategoryInline}
                      disabled={savingCategory || !newCatName.trim()}
                    >
                      {savingCategory ? 'Saving...' : 'Add Category'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="form-group flex-1">
              <label htmlFor="policy-status">Initial Status *</label>
              <select
                id="policy-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="form-select"
              >
                <option value="draft">Draft (Admin only)</option>
                <option value="published">Published (Visible to Clients)</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="policy-description">Description</label>
            <textarea
              id="policy-description"
              rows={3}
              placeholder="Brief summary of policy coverage, target eligibility, and key conditions..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="form-textarea"
            />
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? <span className="btn-spinner" /> : null}
              {submitting ? 'Creating...' : 'Create Policy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
