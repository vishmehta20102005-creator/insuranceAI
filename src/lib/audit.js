import { supabase } from './supabase';

let _cachedAuditLogs = null;

export function getCachedAuditLogs() {
  return _cachedAuditLogs;
}

/**
 * Fetch all audit logs for the admin dashboard, including submission details,
 * policy info, applicant info, and admin performer info.
 */
export async function fetchAllAuditLogsForAdmin() {
  const { data: logs, error } = await supabase
    .from('audit_log')
    .select(`
      id,
      submission_id,
      action,
      previous_status,
      new_status,
      reason,
      performed_by,
      created_at,
      client_submissions (
        id,
        client_id,
        policy_id,
        submitted_at,
        policies ( id, name, category )
      ),
      performer:profiles!audit_log_performed_by_fkey (
        id,
        email,
        full_name
      )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching audit logs for admin:', error);
    throw error;
  }

  // Fetch applicant profiles for the submissions
  const clientIds = [
    ...new Set(
      (logs || [])
        .map((l) => l.client_submissions?.client_id)
        .filter(Boolean)
    ),
  ];

  let clientMap = {};
  if (clientIds.length > 0) {
    const { data: clientProfiles } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', clientIds);

    if (clientProfiles) {
      clientMap = Object.fromEntries(clientProfiles.map((p) => [p.id, p]));
    }
  }

  const mapped = (logs || []).map((l) => {
    const client = clientMap[l.client_submissions?.client_id] || null;
    return {
      ...l,
      client,
      policy: l.client_submissions?.policies || null,
    };
  });
  _cachedAuditLogs = mapped;
  return mapped;
}

/**
 * Fetch audit logs for a specific submission (admin view).
 */
export async function fetchAuditLogsForSubmission(submissionId) {
  const { data, error } = await supabase
    .from('audit_log')
    .select(`
      id,
      submission_id,
      action,
      previous_status,
      new_status,
      reason,
      performed_by,
      created_at,
      performer:profiles!audit_log_performed_by_fkey ( id, email, full_name )
    `)
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching submission audit logs:', error);
    throw error;
  }
  return data || [];
}

/**
 * Fetch audit logs for the authenticated client via the secure view
 * that completely omits performed_by.
 */
export async function fetchClientSubmissionAuditLogs(submissionId) {
  const { data, error } = await supabase
    .from('audit_log_client_view')
    .select('*')
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching client audit logs:', error);
    throw error;
  }
  return data || [];
}

/**
 * Perform an admin override on a submission verdict.
 * Updates client_submissions.status and inserts an 'admin_override' row into audit_log.
 */
export async function overrideSubmissionVerdict({
  submissionId,
  previousStatus,
  newStatus,
  reason,
  adminId,
}) {
  if (!reason || !reason.trim()) {
    throw new Error('A reason is required when overriding an AI verdict.');
  }

  // 1. Update client_submissions status
  const { data: updatedSub, error: updateErr } = await supabase
    .from('client_submissions')
    .update({
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', submissionId)
    .select()
    .single();

  if (updateErr) {
    console.error('Error updating submission status on override:', updateErr);
    throw updateErr;
  }

  // 2. Insert admin_override into audit_log
  const { data: auditEntry, error: auditErr } = await supabase
    .from('audit_log')
    .insert({
      submission_id: submissionId,
      action: 'admin_override',
      previous_status: previousStatus || null,
      new_status: newStatus,
      reason: reason.trim(),
      performed_by: adminId || null,
    })
    .select()
    .single();

  if (auditErr) {
    console.error('Error inserting admin override audit log:', auditErr);
    throw auditErr;
  }

  return { updatedSub, auditEntry };
}
