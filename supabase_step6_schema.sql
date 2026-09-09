-- ============================================================
-- InsuranceAI — Step 6: Audit Log, Manual Override & Storage RLS
-- Run this entire file in Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. Create audit_log table ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id    uuid NOT NULL REFERENCES public.client_submissions(id) ON DELETE CASCADE,
  action           text NOT NULL CHECK (action IN ('ai_verdict', 'admin_override')),
  previous_status  text,
  new_status       text NOT NULL,
  reason           text,
  performed_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now()
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_audit_log_submission_id
  ON public.audit_log(submission_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action
  ON public.audit_log(action);

-- ── 2. Enable RLS on audit_log ──────────────────────────────
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Drop any previous policies
DROP POLICY IF EXISTS "Admins can view all audit logs" ON public.audit_log;
DROP POLICY IF EXISTS "Admins can insert audit logs"   ON public.audit_log;
DROP POLICY IF EXISTS "Clients can view own audit logs" ON public.audit_log;

-- Admin: full SELECT on base table
CREATE POLICY "Admins can view all audit logs"
  ON public.audit_log FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Admin: INSERT for manual overrides
CREATE POLICY "Admins can insert audit logs"
  ON public.audit_log FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- Note: No SELECT policy on the base table `public.audit_log` for clients!
-- Clients are intentionally NOT given SELECT access to `public.audit_log`,
-- which prevents any direct query from seeing `performed_by`.


-- ── 3. Client View with performed_by completely excluded ─────
-- Clients query this view instead of the base table.
-- It strictly enforces submission ownership (client_id = auth.uid())
-- and omits `performed_by` entirely from the schema.
DROP VIEW IF EXISTS public.audit_log_client_view;

CREATE VIEW public.audit_log_client_view AS
  SELECT
    al.id,
    al.submission_id,
    al.action,
    al.previous_status,
    al.new_status,
    al.reason,
    al.created_at
  FROM public.audit_log al
  JOIN public.client_submissions cs ON cs.id = al.submission_id
  WHERE cs.client_id = auth.uid();

-- Grant access on the view
GRANT SELECT ON public.audit_log_client_view TO authenticated;


-- ── 4. Storage RLS DELETE policy for policy-documents ────────
-- Grants admins permission to delete files from 'policy-documents' bucket.
DROP POLICY IF EXISTS "Admins can delete documents" ON storage.objects;
DROP POLICY IF EXISTS "Admins delete access to policy-documents" ON storage.objects;

CREATE POLICY "Admins can delete documents"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'policy-documents'
    AND public.is_admin()
  );

-- Also ensure storage SELECT, INSERT, and UPDATE exist for admins
DROP POLICY IF EXISTS "Admins can read all documents" ON storage.objects;
CREATE POLICY "Admins can read all documents"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'policy-documents' AND public.is_admin());

DROP POLICY IF EXISTS "Admins can insert documents" ON storage.objects;
CREATE POLICY "Admins can insert documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'policy-documents' AND public.is_admin());

DROP POLICY IF EXISTS "Admins can update documents" ON storage.objects;
CREATE POLICY "Admins can update documents"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'policy-documents' AND public.is_admin())
  WITH CHECK (bucket_id = 'policy-documents' AND public.is_admin());
