-- ============================================================
-- InsuranceAI — Step 3: Client Submissions & Document Upload
-- Run this entire file in Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. client_submissions table ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_submissions (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  policy_id    uuid REFERENCES public.policies(id) ON DELETE CASCADE NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_submissions_client_id
  ON public.client_submissions(client_id);
CREATE INDEX IF NOT EXISTS idx_submissions_policy_id
  ON public.client_submissions(policy_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status
  ON public.client_submissions(status);

-- ── 2. submission_documents table ────────────────────────────

CREATE TABLE IF NOT EXISTS public.submission_documents (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id   uuid REFERENCES public.client_submissions(id) ON DELETE CASCADE NOT NULL,
  document_type   text NOT NULL
                    CHECK (document_type IN ('id_proof','medical_report','income_proof','age_proof')),
  file_path       text NOT NULL,   -- path inside client-documents: <submissionId>/<type>_<filename>
  filename        text NOT NULL,
  file_size       bigint DEFAULT 0,
  uploaded_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sub_docs_submission_id
  ON public.submission_documents(submission_id);

-- ── 3. Enable RLS ─────────────────────────────────────────────

ALTER TABLE public.client_submissions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_documents  ENABLE ROW LEVEL SECURITY;

-- ── 4. RLS — client_submissions ───────────────────────────────

DROP POLICY IF EXISTS "Clients can view their own submissions"   ON public.client_submissions;
DROP POLICY IF EXISTS "Clients can insert their own submissions" ON public.client_submissions;
DROP POLICY IF EXISTS "Admins have full access to submissions"   ON public.client_submissions;

-- Admin: full access
CREATE POLICY "Admins have full access to submissions"
  ON public.client_submissions FOR ALL
  USING     (public.is_admin())
  WITH CHECK (public.is_admin());

-- Client: read own rows
CREATE POLICY "Clients can view their own submissions"
  ON public.client_submissions FOR SELECT
  USING (client_id = auth.uid());

-- Client: insert own rows only
CREATE POLICY "Clients can insert their own submissions"
  ON public.client_submissions FOR INSERT
  WITH CHECK (client_id = auth.uid());

-- ── 5. RLS — submission_documents ─────────────────────────────

DROP POLICY IF EXISTS "Clients can view their own submission docs"   ON public.submission_documents;
DROP POLICY IF EXISTS "Clients can insert their own submission docs" ON public.submission_documents;
DROP POLICY IF EXISTS "Admins have full access to submission docs"   ON public.submission_documents;

-- Admin: full access
CREATE POLICY "Admins have full access to submission docs"
  ON public.submission_documents FOR ALL
  USING     (public.is_admin())
  WITH CHECK (public.is_admin());

-- Client: read docs that belong to their own submissions
CREATE POLICY "Clients can view their own submission docs"
  ON public.submission_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.client_submissions cs
      WHERE cs.id = submission_documents.submission_id
        AND cs.client_id = auth.uid()
    )
  );

-- Client: insert docs for their own submissions only
CREATE POLICY "Clients can insert their own submission docs"
  ON public.submission_documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.client_submissions cs
      WHERE cs.id = submission_documents.submission_id
        AND cs.client_id = auth.uid()
    )
  );

-- ── 6. Storage bucket: client-documents ───────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('client-documents', 'client-documents', false)
ON CONFLICT (id) DO NOTHING;

-- ── 7. Storage RLS — client-documents bucket ──────────────────
--
-- Object path format:  <submissionId>/<type>_<filename>
-- We extract submissionId as:  split_part(storage.objects.name, '/', 1)
-- Then verify the submission belongs to the calling user.
--
-- NOTE: No ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY
-- Supabase already enables it — adding it would fail with 42501.

DROP POLICY IF EXISTS "Admins have full access to client-documents"  ON storage.objects;
DROP POLICY IF EXISTS "Clients can read their own submission files"   ON storage.objects;
DROP POLICY IF EXISTS "Clients can upload their own submission files" ON storage.objects;
DROP POLICY IF EXISTS "Clients can delete their own submission files" ON storage.objects;

-- Admin: unrestricted read/write on this bucket
CREATE POLICY "Admins have full access to client-documents"
  ON storage.objects FOR ALL
  TO authenticated
  USING     (bucket_id = 'client-documents' AND public.is_admin())
  WITH CHECK (bucket_id = 'client-documents' AND public.is_admin());

-- Client: read files under their own submissions
CREATE POLICY "Clients can read their own submission files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND EXISTS (
      SELECT 1 FROM public.client_submissions cs
      WHERE cs.id::text = split_part(storage.objects.name, '/', 1)
        AND cs.client_id = auth.uid()
    )
  );

-- Client: upload files under their own submissions
CREATE POLICY "Clients can upload their own submission files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'client-documents'
    AND EXISTS (
      SELECT 1 FROM public.client_submissions cs
      WHERE cs.id::text = split_part(name, '/', 1)
        AND cs.client_id = auth.uid()
    )
  );

-- Client: delete files under their own submissions (e.g. error cleanup)
CREATE POLICY "Clients can delete their own submission files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND EXISTS (
      SELECT 1 FROM public.client_submissions cs
      WHERE cs.id::text = split_part(storage.objects.name, '/', 1)
        AND cs.client_id = auth.uid()
    )
  );
