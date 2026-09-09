import { useState } from 'react';
import { createPolicy } from '../../lib/policies';
import { useAuth } from '../../contexts/AuthContext';

export default function CreatePolicyModal({ isOpen, onClose, onPolicyCreated }) {
  const { user } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('health');
  const [status, setStatus] = useState('draft');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Policy name is required.');
      return;
    }

    setSubmitting(true);
    try {
      const newPolicy = await createPolicy({
        name: name.trim(),
        description: description.trim() || null,
        category,
        status,
        created_by: user?.id,
      });

      // Reset form
      setName('');
      setDescription('');
      setCategory('health');
      setStatus('draft');

      onPolicyCreated(newPolicy);
    } catch (err) {
      setError(err.message || 'Failed to create policy.');
      setSubmitting(false);
    }
  }

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
              placeholder="e.g. Comprehensive Health Shield"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-row">
            <div className="form-group flex-1">
              <label htmlFor="policy-category">Category *</label>
              <select
                id="policy-category"
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
