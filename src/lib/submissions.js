import { supabase } from './supabase';

/**
 * Document types required for every submission (fixed MVP list).
 * Each has a label for display and a value for the DB check constraint.
 */
export const REQUIRED_DOC_TYPES = [
  { type: 'id_proof',       label: 'ID Proof',       hint: 'Passport, Aadhaar, Driving Licence, etc.' },
  { type: 'medical_report', label: 'Medical Report',  hint: 'Recent health checkup or doctor certificate.' },
  { type: 'income_proof',   label: 'Income Proof',    hint: 'Salary slip, ITR, or bank statement.' },
  { type: 'age_proof',      label: 'Age Proof',       hint: 'Birth certificate, school certificate, etc.' },
];

// ── Queries ─────────────────────────────────────────────────────────────────

/**
 * Fetch all submissions for a client, including policy name and doc count.
 * Ordered by most recent first.
 */
export async function fetchClientSubmissions(clientId) {
  const { data, error } = await supabase
    .from('client_submissions')
    .select(`
      *,
      policies ( id, name, category ),
      submission_documents ( id )
    `)
    .eq('client_id', clientId)
    .order('submitted_at', { ascending: false });

  if (error) {
    console.error('Error fetching client submissions:', error);
    throw error;
  }

  return (data || []).map((s) => ({
    ...s,
    policy: s.policies,
    docsCount: s.submission_documents ? s.submission_documents.length : 0,
  }));
}

/**
 * Fetch the most recent submission a client made for a specific policy.
 * Returns null if no submission exists.
 */
export async function fetchLatestSubmissionForPolicy(policyId, clientId) {
  const { data, error } = await supabase
    .from('client_submissions')
    .select(`
      *,
      submission_documents ( id, document_type, filename, file_size, uploaded_at )
    `)
    .eq('policy_id', policyId)
    .eq('client_id', clientId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching latest submission:', error);
    throw error;
  }

  return data; // null if none
}

// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * Create a new submission record for a client/policy.
 * Returns the newly created submission row.
 */
export async function createSubmission(clientId, policyId) {
  const { data, error } = await supabase
    .from('client_submissions')
    .insert([{ client_id: clientId, policy_id: policyId, status: 'pending' }])
    .select()
    .single();

  if (error) {
    console.error('Error creating submission:', error);
    throw error;
  }

  return data;
}

/**
 * Upload one file to the client-documents bucket and record it in submission_documents.
 *
 * Storage path: <submissionId>/<documentType>_<sanitizedFilename>
 * (No "client-documents/" prefix — the bucket name is NOT part of the object path.)
 */
export async function uploadSubmissionDocument(submissionId, file, documentType) {
  const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath  = `${submissionId}/${documentType}_${sanitized}`;

  // 1. Upload to storage
  const { error: uploadError } = await supabase.storage
    .from('client-documents')
    .upload(filePath, file, { cacheControl: '3600', upsert: false });

  if (uploadError) {
    console.error('Storage upload error:', uploadError);
    throw uploadError;
  }

  // 2. Record in DB
  const { data, error: insertError } = await supabase
    .from('submission_documents')
    .insert([{
      submission_id: submissionId,
      document_type: documentType,
      file_path:     filePath,
      filename:      file.name,
      file_size:     file.size,
    }])
    .select()
    .single();

  if (insertError) {
    // Best-effort cleanup of the already-uploaded file
    await supabase.storage.from('client-documents').remove([filePath]);
    console.error('DB insert error for submission document:', insertError);
    throw insertError;
  }

  return data;
}

/**
 * Generate a signed URL (1 hour) for a document stored in the client-documents bucket.
 */
export async function getSubmissionDocumentSignedUrl(filePath) {
  const { data, error } = await supabase.storage
    .from('client-documents')
    .createSignedUrl(filePath, 3600);

  if (error) {
    console.error('Error generating signed URL for client document:', error);
    throw error;
  }

  return data.signedUrl;
}

let _cachedSubmissions = null;

export function getCachedSubmissions() {
  return _cachedSubmissions;
}

/**
 * Fetch all client submissions for the admin dashboard, including policies,
 * documents, and client profile info.
 */
export async function fetchAllSubmissionsForAdmin() {
  const { data: subs, error: subsErr } = await supabase
    .from('client_submissions')
    .select(`
      *,
      policies ( id, name, category, status ),
      submission_documents ( id, document_type, file_path, filename, file_size, uploaded_at )
    `)
    .order('submitted_at', { ascending: false });

  if (subsErr) {
    console.error('Error fetching all submissions for admin:', subsErr);
    throw subsErr;
  }

  const clientIds = [...new Set((subs || []).map((s) => s.client_id).filter(Boolean))];
  let profilesMap = {};

  if (clientIds.length > 0) {
    const { data: profiles, error: profErr } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', clientIds);

    if (!profErr && profiles) {
      profilesMap = Object.fromEntries(profiles.map((p) => [p.id, p]));
    }
  }

  const mapped = (subs || []).map((s) => ({
    ...s,
    policy: s.policies,
    documents: s.submission_documents || [],
    client: profilesMap[s.client_id] || { email: 'Unknown Client', full_name: 'Client' },
  }));
  _cachedSubmissions = mapped;
  return mapped;
}

/**
 * Fetch all submissions for a single policy (for Admin PolicyDetailsPage).
 */
export async function fetchSubmissionsForPolicyAdmin(policyId) {
  const { data: subs, error: subsErr } = await supabase
    .from('client_submissions')
    .select(`
      *,
      submission_documents ( id, document_type, file_path, filename, file_size, uploaded_at )
    `)
    .eq('policy_id', policyId)
    .order('submitted_at', { ascending: false });

  if (subsErr) {
    console.error('Error fetching submissions for policy:', subsErr);
    throw subsErr;
  }

  const clientIds = [...new Set((subs || []).map((s) => s.client_id).filter(Boolean))];
  let profilesMap = {};

  if (clientIds.length > 0) {
    const { data: profiles, error: profErr } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', clientIds);

    if (!profErr && profiles) {
      profilesMap = Object.fromEntries(profiles.map((p) => [p.id, p]));
    }
  }

  return (subs || []).map((s) => ({
    ...s,
    documents: s.submission_documents || [],
    client: profilesMap[s.client_id] || { email: 'Unknown Client', full_name: 'Client' },
  }));
}

/**
 * Update the status of a submission ('pending', 'approved', 'rejected').
 */
export async function updateSubmissionStatus(submissionId, newStatus) {
  const { data, error } = await supabase
    .from('client_submissions')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', submissionId)
    .select(`
      *,
      policies ( id, name, category ),
      submission_documents ( id, document_type, file_path, filename, file_size, uploaded_at )
    `)
    .single();

  if (error) {
    console.error('Error updating submission status:', error);
    throw error;
  }

  return data;
}

/**
 * Fetch the AI eligibility result for a submission.
 */
export async function fetchEligibilityResult(submissionId) {
  if (!submissionId) return null;
  const { data, error } = await supabase
    .from('eligibility_results')
    .select('*')
    .eq('submission_id', submissionId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching eligibility result:', error);
    throw error;
  }

  return data;
}
