import { supabase } from './supabase';

/**
 * Fetch only published policies for the client-facing view, including document counts.
 */
export async function fetchPublishedPolicies() {
  const { data, error } = await supabase
    .from('policies')
    .select(`
      *,
      policy_categories (
        id,
        name,
        description
      ),
      policy_documents (
        id
      )
    `)
    .eq('status', 'published')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching published policies:', error);
    throw error;
  }

  return (data || []).map((policy) => ({
    ...policy,
    category: policy.policy_categories?.name || policy.category || 'Insurance',
    documentsCount: policy.policy_documents ? policy.policy_documents.length : 0,
  }));
}
let _cachedAdminPolicies = null;

export function getCachedAdminPolicies() {
  return _cachedAdminPolicies;
}

/**
 * Fetch all policies for the Admin dashboard, including document counts.
 */
export async function fetchAdminPolicies() {
  const { data, error } = await supabase
    .from('policies')
    .select(`
      *,
      policy_categories (
        id,
        name,
        description
      ),
      policy_documents (
        id
      )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching admin policies:', error);
    throw error;
  }

  const mapped = (data || []).map((policy) => ({
    ...policy,
    category: policy.policy_categories?.name || policy.category || 'Insurance',
    documentsCount: policy.policy_documents ? policy.policy_documents.length : 0,
  }));
  _cachedAdminPolicies = mapped;
  return mapped;
}

/**
 * Fetch a single policy by ID with its uploaded documents.
 */
export async function fetchPolicyById(id) {
  const { data: policy, error: policyError } = await supabase
    .from('policies')
    .select('*')
    .eq('id', id)
    .single();

  if (policyError) {
    console.error('Error fetching policy:', policyError);
    throw policyError;
  }

  const { data: documents, error: docsError } = await supabase
    .from('policy_documents')
    .select('*')
    .eq('policy_id', id)
    .order('uploaded_at', { ascending: true });

  if (docsError) {
    console.error('Error fetching policy documents:', docsError);
    throw docsError;
  }

  return {
    ...policy,
    documents: documents || [],
  };
}

/**
 * Fetch all policy categories.
 */
export async function fetchPolicyCategories() {
  const { data, error } = await supabase
    .from('policy_categories')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    console.error('Error fetching policy categories:', error);
    throw error;
  }
  return data || [];
}

/**
 * Create a new policy category.
 */
export async function createPolicyCategory({ name, description }) {
  const { data, error } = await supabase
    .from('policy_categories')
    .insert([
      {
        name: name.trim(),
        description: description?.trim() || null,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error('Error creating policy category:', error);
    throw error;
  }
  return data;
}

/**
 * Triggers background embedding generation for a policy.
 * Called automatically when a policy is published or its eligibility documents are modified.
 * Non-blocking: failures are logged and will not break UI transactions.
 */
export async function triggerPolicyEmbeddingGeneration(policyId) {
  if (!policyId) return;
  try {
    const { data, error } = await supabase.functions.invoke('generate-policy-embedding', {
      body: { policy_id: policyId },
    });
    if (error) {
      console.warn(`[triggerPolicyEmbeddingGeneration] Edge function returned error for ${policyId}:`, error);
    } else {
      console.log(`[triggerPolicyEmbeddingGeneration] Successfully generated embedding for ${policyId}:`, data);
    }
    return data;
  } catch (err) {
    console.warn(`[triggerPolicyEmbeddingGeneration] Exception triggering embedding for ${policyId}:`, err);
  }
}

/**
 * Fetch the vector embedding and summary record for a policy.
 */
export async function fetchPolicyEmbedding(policyId) {
  if (!policyId) return null;
  const { data, error } = await supabase
    .from('policy_embeddings')
    .select('id, policy_id, summary_text, updated_at')
    .eq('policy_id', policyId)
    .maybeSingle();

  if (error) {
    console.warn('Error fetching policy embedding:', error);
    return null;
  }
  return data;
}

/**
 * Create a new policy.
 */
export async function createPolicy({ name, description, category_id, category, status, created_by }) {
  const payload = {
    name: name.trim(),
    description: description?.trim() || null,
    status: status || 'draft',
    created_by: created_by || null,
  };

  if (category_id) {
    payload.category_id = category_id;
  }
  if (category) {
    payload.category = category;
  }

  const { data, error } = await supabase
    .from('policies')
    .insert([payload])
    .select('*, policy_categories(*)')
    .single();

  if (error) {
    console.error('Error creating policy:', error);
    throw error;
  }

  if (data?.id && data.status === 'published') {
    triggerPolicyEmbeddingGeneration(data.id);
  }

  return data;
}

/**
 * Update an existing policy.
 */
export async function updatePolicy(id, updates) {
  const { data, error } = await supabase
    .from('policies')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*, policy_categories(*)')
    .single();

  if (error) {
    console.error('Error updating policy:', error);
    throw error;
  }

  // Automatically regenerate policy embedding if published or newly published
  if (data?.id && (updates.status === 'published' || data.status === 'published')) {
    triggerPolicyEmbeddingGeneration(data.id);
  }

  return data;
}

/**
 * Fetch required documents configured for a policy.
 */
export async function fetchPolicyRequiredDocuments(policyId) {
  const { data, error } = await supabase
    .from('policy_required_documents')
    .select('*')
    .eq('policy_id', policyId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching policy required documents:', error);
    throw error;
  }
  return data || [];
}

/**
 * Add a new required document type to a policy.
 */
export async function addPolicyRequiredDocument(policyId, { document_type, label, display_order }) {
  const cleanType = document_type
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '');

  const { data, error } = await supabase
    .from('policy_required_documents')
    .insert([
      {
        policy_id: policyId,
        document_type: cleanType,
        label: label.trim(),
        display_order: typeof display_order === 'number' ? display_order : 0,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error('Error adding policy required document:', error);
    throw error;
  }
  return data;
}

/**
 * Update an existing required document configuration.
 */
export async function updatePolicyRequiredDocument(id, { document_type, label, display_order }) {
  const updates = {};
  if (document_type) {
    updates.document_type = document_type
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/^_+|_+$/g, '');
  }
  if (label) updates.label = label.trim();
  if (typeof display_order === 'number') updates.display_order = display_order;

  const { data, error } = await supabase
    .from('policy_required_documents')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating policy required document:', error);
    throw error;
  }
  return data;
}

/**
 * Delete a required document configuration.
 */
export async function deletePolicyRequiredDocument(id) {
  const { error } = await supabase
    .from('policy_required_documents')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting policy required document:', error);
    throw error;
  }
}

/**
 * Reorder required documents by updating their display_order.
 */
export async function reorderPolicyRequiredDocuments(documents) {
  const updates = documents.map((doc, idx) =>
    supabase
      .from('policy_required_documents')
      .update({ display_order: idx + 1 })
      .eq('id', doc.id)
  );
  await Promise.all(updates);
}

/**
 * Delete a policy and all its storage documents.
 */
export async function deletePolicy(id) {
  // First, find all documents for this policy
  const { data: documents } = await supabase
    .from('policy_documents')
    .select('file_path')
    .eq('policy_id', id);

  if (documents && documents.length > 0) {
    const paths = documents.map((d) => d.file_path);
    await supabase.storage.from('policy-documents').remove(paths);
  }

  // Delete policy (foreign key cascade deletes policy_documents rows)
  const { error } = await supabase
    .from('policies')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting policy:', error);
    throw error;
  }

  return true;
}

/**
 * Upload a document to Supabase Storage and record it in policy_documents.
 */
export async function uploadPolicyDocument(policyId, file, documentType) {
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `${policyId}/${Date.now()}_${sanitizedName}`;

  // 1. Upload to storage bucket
  const { error: uploadError } = await supabase.storage
    .from('policy-documents')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) {
    console.error('Error uploading file to storage:', uploadError);
    throw uploadError;
  }

  // 2. Insert record in policy_documents
  const { data, error: insertError } = await supabase
    .from('policy_documents')
    .insert([
      {
        policy_id: policyId,
        file_path: filePath,
        file_url: filePath,
        filename: file.name,
        document_type: documentType,
        file_size: file.size,
      },
    ])
    .select()
    .single();

  if (insertError) {
    // Attempt cleanup if DB insert fails
    await supabase.storage.from('policy-documents').remove([filePath]);
    console.error('Error recording document in database:', insertError);
    throw insertError;
  }

  // Automatically refresh policy embedding when documents are uploaded
  triggerPolicyEmbeddingGeneration(policyId);

  return data;
}

/**
 * Delete a policy document from storage and the database.
 */
export async function deletePolicyDocument(documentId, filePath, policyId = null) {
  let targetPolicyId = policyId;
  if (!targetPolicyId && documentId) {
    try {
      const { data: docRecord } = await supabase
        .from('policy_documents')
        .select('policy_id')
        .eq('id', documentId)
        .single();
      targetPolicyId = docRecord?.policy_id;
    } catch {
      // Ignore lookup failure
    }
  }

  // 1. Remove from storage (strictly verify deletion)
  if (filePath) {
    const { data, error: storageError } = await supabase.storage
      .from('policy-documents')
      .remove([filePath]);

    if (storageError) {
      console.error('Error deleting document from storage:', storageError);
      throw new Error(`Storage error: ${storageError.message || 'Access denied'}`);
    }
  }

  // 2. Remove from database
  const { error } = await supabase
    .from('policy_documents')
    .delete()
    .eq('id', documentId);

  if (error) {
    console.error('Error deleting document record:', error);
    throw error;
  }

  // Automatically refresh policy embedding after document deletion
  if (targetPolicyId) {
    triggerPolicyEmbeddingGeneration(targetPolicyId);
  }

  return true;
}

/**
 * Generate a signed URL for viewing/downloading a document.
 */
export async function getDocumentSignedUrl(filePath) {
  const { data, error } = await supabase.storage
    .from('policy-documents')
    .createSignedUrl(filePath, 3600); // 1 hour expiration

  if (error) {
    console.error('Error generating signed URL:', error);
    throw error;
  }

  return data.signedUrl;
}
