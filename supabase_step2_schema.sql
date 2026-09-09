-- ============================================================
-- InsuranceAI — Supabase Schema (Step 2: Policies & Documents)
-- Run this entire file in your Supabase SQL Editor.
-- ============================================================

-- 1. Policies Table
CREATE TABLE IF NOT EXISTS public.policies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  category text NOT NULL CHECK (category IN ('health', 'life', 'vehicle', 'travel', 'other')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Policy Documents Table
CREATE TABLE IF NOT EXISTS public.policy_documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_id uuid REFERENCES public.policies(id) ON DELETE CASCADE NOT NULL,
  file_path text NOT NULL,
  file_url text NOT NULL,
  filename text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('terms_and_conditions', 'eligibility_criteria', 'exclusions', 'other')),
  file_size bigint DEFAULT 0,
  uploaded_at timestamptz DEFAULT now()
);

-- 3. Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_policies_status ON public.policies(status);
CREATE INDEX IF NOT EXISTS idx_policies_created_at ON public.policies(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_policy_documents_policy_id ON public.policy_documents(policy_id);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_documents ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for `policies`
-- Admins: full CRUD
DROP POLICY IF EXISTS "Admins have full access to policies" ON public.policies;
CREATE POLICY "Admins have full access to policies"
  ON public.policies FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Clients: read-only access to published policies
DROP POLICY IF EXISTS "Clients can view published policies" ON public.policies;
CREATE POLICY "Clients can view published policies"
  ON public.policies FOR SELECT
  USING (status = 'published');

-- 6. RLS Policies for `policy_documents`
-- Admins: full CRUD
DROP POLICY IF EXISTS "Admins have full access to policy documents" ON public.policy_documents;
CREATE POLICY "Admins have full access to policy documents"
  ON public.policy_documents FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Clients: read-only access to documents of published policies
DROP POLICY IF EXISTS "Clients can view documents of published policies" ON public.policy_documents;
CREATE POLICY "Clients can view documents of published policies"
  ON public.policy_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.policies p
      WHERE p.id = policy_documents.policy_id AND p.status = 'published'
    )
  );

-- 7. Supabase Storage Bucket for Policy Documents
-- Insert the bucket if not present
INSERT INTO storage.buckets (id, name, public)
VALUES ('policy-documents', 'policy-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: Admins have full access
DROP POLICY IF EXISTS "Admins full access to policy-documents" ON storage.objects;
CREATE POLICY "Admins full access to policy-documents"
  ON storage.objects FOR ALL
  USING (bucket_id = 'policy-documents' AND public.is_admin())
  WITH CHECK (bucket_id = 'policy-documents' AND public.is_admin());

-- Storage RLS: Authenticated clients can read policy documents
DROP POLICY IF EXISTS "Authenticated users can read policy-documents" ON storage.objects;
CREATE POLICY "Authenticated users can read policy-documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'policy-documents'
    AND auth.role() = 'authenticated'
  );
