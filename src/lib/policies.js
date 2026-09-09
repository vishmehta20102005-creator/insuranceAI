import { supabase } from './supabase';

/**
 * Fetch only published policies for the client-facing view, including document counts.
 */
export async function fetchPublishedPolicies() {
  const { data, error } = await supabase
    .from('policies')
    .select(`
      *,
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
 * Create a new policy.
 */
export async function createPolicy({ name, description, category, status, created_by }) {
  const { data, error } = await supabase
    .from('policies')
    .insert([
      {
        name,
        description: description || null,
        category: category || 'health',
        status: status || 'draft',
        created_by: created_by || null,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error('Error creating policy:', error);
    throw error;
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
    .select()
    .single();

  if (error) {
    console.error('Error updating policy:', error);
    throw error;
  }

  return data;
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

  return data;
}

/**
 * Delete a policy document from storage and the database.
 */
export async function deletePolicyDocument(documentId, filePath) {
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
