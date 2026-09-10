-- ============================================================
-- InsuranceAI — Step 8: Policy Categories & Dynamic Required Documents
-- Run this entire file in Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. Create policy_categories table ─────────────────────────

CREATE TABLE IF NOT EXISTS public.policy_categories (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  description text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_categories_name
  ON public.policy_categories(name);

-- ── 2. Enable RLS on policy_categories ────────────────────────

ALTER TABLE public.policy_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view policy categories" ON public.policy_categories;
CREATE POLICY "Anyone can view policy categories"
  ON public.policy_categories FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins have full access to policy categories" ON public.policy_categories;
CREATE POLICY "Admins have full access to policy categories"
  ON public.policy_categories FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── 3. Seed policy_categories from existing policies & defaults ──

-- Insert standard categories if not present
INSERT INTO public.policy_categories (name, description)
VALUES
  ('Health Insurance', 'Comprehensive medical, hospitalization, and critical illness coverage'),
  ('Car Insurance', 'Comprehensive motor, third-party liability, and collision coverage'),
  ('Life Insurance', 'Term life, whole life, and family protection plans'),
  ('Travel Insurance', 'Domestic and international travel protection and emergency medical coverage')
ON CONFLICT (name) DO NOTHING;

-- Also create category rows from any distinct legacy categories in policies table
INSERT INTO public.policy_categories (name, description)
SELECT DISTINCT
  CASE
    WHEN LOWER(category) = 'health'  THEN 'Health Insurance'
    WHEN LOWER(category) = 'vehicle' THEN 'Car Insurance'
    WHEN LOWER(category) = 'life'    THEN 'Life Insurance'
    WHEN LOWER(category) = 'travel'  THEN 'Travel Insurance'
    WHEN LOWER(category) = 'other'   THEN 'General Insurance'
    ELSE initcap(category)
  END AS name,
  'Standard coverage plans' AS description
FROM public.policies
WHERE category IS NOT NULL AND TRIM(category) != ''
ON CONFLICT (name) DO NOTHING;

-- ── 4. Modify policies table: Add category_id FK & backfill ───

-- Add category_id foreign key column
ALTER TABLE public.policies
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.policy_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_policies_category_id
  ON public.policies(category_id);

-- Backfill category_id for existing rows based on legacy category text
UPDATE public.policies p
SET category_id = pc.id
FROM public.policy_categories pc
WHERE (
  pc.name = (
    CASE
      WHEN LOWER(p.category) = 'health'  THEN 'Health Insurance'
      WHEN LOWER(p.category) = 'vehicle' THEN 'Car Insurance'
      WHEN LOWER(p.category) = 'life'    THEN 'Life Insurance'
      WHEN LOWER(p.category) = 'travel'  THEN 'Travel Insurance'
      WHEN LOWER(p.category) = 'other'   THEN 'General Insurance'
      ELSE initcap(p.category)
    END
  )
  OR LOWER(pc.name) = LOWER(p.category)
  OR pc.name = p.category
)
AND p.category_id IS NULL;

-- Relax legacy category CHECK constraint & make nullable for smooth multi-phase transition
ALTER TABLE public.policies
  DROP CONSTRAINT IF EXISTS policies_category_check;

ALTER TABLE public.policies
  ALTER COLUMN category DROP NOT NULL;

-- Keep legacy category text and new category_id in bidirectional sync during transition
CREATE OR REPLACE FUNCTION public.sync_policy_category()
RETURNS trigger AS $$
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    SELECT name INTO NEW.category FROM public.policy_categories WHERE id = NEW.category_id;
  ELSIF NEW.category IS NOT NULL AND NEW.category_id IS NULL THEN
    SELECT id INTO NEW.category_id FROM public.policy_categories
    WHERE LOWER(name) = LOWER(NEW.category)
       OR name = (
         CASE
           WHEN LOWER(NEW.category) = 'health'  THEN 'Health Insurance'
           WHEN LOWER(NEW.category) = 'vehicle' THEN 'Car Insurance'
           WHEN LOWER(NEW.category) = 'life'    THEN 'Life Insurance'
           WHEN LOWER(NEW.category) = 'travel'  THEN 'Travel Insurance'
           ELSE initcap(NEW.category)
         END
       )
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_policy_category ON public.policies;
CREATE TRIGGER trg_sync_policy_category
  BEFORE INSERT OR UPDATE ON public.policies
  FOR EACH ROW EXECUTE FUNCTION public.sync_policy_category();

-- ── 5. Create policy_required_documents table ─────────────────

CREATE TABLE IF NOT EXISTS public.policy_required_documents (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_id     uuid REFERENCES public.policies(id) ON DELETE CASCADE NOT NULL,
  document_type text NOT NULL,
  label         text NOT NULL,
  display_order int NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT uq_policy_required_doc UNIQUE (policy_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_policy_req_docs_policy_id
  ON public.policy_required_documents(policy_id);

-- ── 6. Enable RLS on policy_required_documents ────────────────

ALTER TABLE public.policy_required_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view policy required documents" ON public.policy_required_documents;
CREATE POLICY "Anyone can view policy required documents"
  ON public.policy_required_documents FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins have full access to policy required documents" ON public.policy_required_documents;
CREATE POLICY "Admins have full access to policy required documents"
  ON public.policy_required_documents FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── 7. Migration: Seed the 4 default required documents for all existing policies ──

INSERT INTO public.policy_required_documents (policy_id, document_type, label, display_order)
SELECT p.id, d.document_type, d.label, d.display_order
FROM public.policies p
CROSS JOIN (
  VALUES
    ('id_proof', 'Government ID Proof', 1),
    ('medical_report', 'Recent Medical Report', 2),
    ('income_proof', 'Income Proof / Salary Slip', 3),
    ('age_proof', 'Age Proof Certificate', 4)
) AS d(document_type, label, display_order)
ON CONFLICT (policy_id, document_type) DO NOTHING;

-- ── 8. Modify submission_documents: Relax CHECK constraint & add validation trigger ──

-- Drop the hardcoded 4-type check constraint
ALTER TABLE public.submission_documents
  DROP CONSTRAINT IF EXISTS submission_documents_document_type_check;

-- Add trigger function to ensure submitted document_type exists in policy_required_documents
CREATE OR REPLACE FUNCTION public.validate_submission_document_type()
RETURNS trigger AS $$
DECLARE
  v_policy_id uuid;
  v_is_valid boolean;
BEGIN
  SELECT policy_id INTO v_policy_id
  FROM public.client_submissions
  WHERE id = NEW.submission_id;

  IF v_policy_id IS NULL THEN
    RAISE EXCEPTION 'Invalid submission: Submission % not found', NEW.submission_id;
  END IF;

  -- Check if document_type exists in policy_required_documents for this policy
  SELECT EXISTS (
    SELECT 1 FROM public.policy_required_documents
    WHERE policy_id = v_policy_id
      AND document_type = NEW.document_type
  ) INTO v_is_valid;

  -- Fallback: If no required documents configured for this policy, allow standard 4
  IF NOT v_is_valid THEN
    IF NOT EXISTS (SELECT 1 FROM public.policy_required_documents WHERE policy_id = v_policy_id) THEN
      IF NEW.document_type IN ('id_proof', 'medical_report', 'income_proof', 'age_proof') THEN
        v_is_valid := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_is_valid THEN
    RAISE EXCEPTION 'Document type "%" is not an accepted required document for this policy.', NEW.document_type;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_validate_submission_document_type ON public.submission_documents;
CREATE TRIGGER trg_validate_submission_document_type
  BEFORE INSERT OR UPDATE OF document_type ON public.submission_documents
  FOR EACH ROW EXECUTE FUNCTION public.validate_submission_document_type();
