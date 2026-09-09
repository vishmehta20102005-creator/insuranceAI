-- ============================================================
-- InsuranceAI — Step 4, Phase 1: Eligibility Results Schema
-- Run this entire file in Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. eligibility_results table ────────────────────────────

CREATE TABLE IF NOT EXISTS public.eligibility_results (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id    uuid REFERENCES public.client_submissions(id) ON DELETE CASCADE NOT NULL UNIQUE,
  verdict          text NOT NULL
                     CHECK (verdict IN ('eligible', 'not_eligible', 'needs_review')),
  confidence_score integer CHECK (confidence_score >= 0 AND confidence_score <= 100),
  summary          text,
  reasons          jsonb DEFAULT '[]'::jsonb,
  generated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eligibility_submission_id
  ON public.eligibility_results(submission_id);
CREATE INDEX IF NOT EXISTS idx_eligibility_verdict
  ON public.eligibility_results(verdict);

-- ── 2. Enable RLS ──────────────────────────────────────────

ALTER TABLE public.eligibility_results ENABLE ROW LEVEL SECURITY;

-- ── 3. RLS Policies ────────────────────────────────────────
--
-- Only the Edge Function (service_role) writes to this table.
-- Clients can read results for their own submissions.
-- Admins can read all results.

DROP POLICY IF EXISTS "Admins can read all eligibility results"     ON public.eligibility_results;
DROP POLICY IF EXISTS "Clients can read their own eligibility results" ON public.eligibility_results;

-- Admin: read all
CREATE POLICY "Admins can read all eligibility results"
  ON public.eligibility_results FOR SELECT
  USING (public.is_admin());

-- Client: read own (via submission ownership)
CREATE POLICY "Clients can read their own eligibility results"
  ON public.eligibility_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.client_submissions cs
      WHERE cs.id = eligibility_results.submission_id
        AND cs.client_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies for anon or authenticated roles.
-- The Edge Function uses the service_role key which bypasses RLS entirely.

-- ── 4. Expand client_submissions.status CHECK constraint ───
--
-- Current constraint allows only: 'pending', 'approved', 'rejected'
-- We need to add: 'processing', 'eligible', 'not_eligible', 'needs_review'
--
-- The column is plain text (not an enum), so we just need to
-- drop the old CHECK and add a new one with all valid values.

-- Drop the existing CHECK constraint.
-- Postgres auto-names CHECK constraints as "<table>_<column>_check",
-- so the constraint is called "client_submissions_status_check".
ALTER TABLE public.client_submissions
  DROP CONSTRAINT IF EXISTS client_submissions_status_check;

-- Add the expanded CHECK constraint.
ALTER TABLE public.client_submissions
  ADD CONSTRAINT client_submissions_status_check
    CHECK (status IN (
      'pending',       -- just submitted, waiting for AI processing
      'processing',    -- AI is currently analyzing
      'eligible',      -- AI says eligible
      'not_eligible',  -- AI says not eligible
      'needs_review',  -- AI is uncertain, needs human review
      'approved',      -- admin manually approved
      'rejected'       -- admin manually rejected
    ));

-- ── Done ────────────────────────────────────────────────────
-- Verify with:
--   SELECT * FROM public.eligibility_results LIMIT 1;
--   SELECT conname, consrc FROM pg_constraint
--     WHERE conrelid = 'public.client_submissions'::regclass
--       AND conname = 'client_submissions_status_check';
