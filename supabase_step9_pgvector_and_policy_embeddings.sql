-- ============================================================
-- InsuranceAI — Step 9: pgvector & Policy Embeddings
-- Phase 5a: Embedding-based Policy Shortlisting
-- ============================================================

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create policy_embeddings table
-- Gemini text-embedding-004 produces 768-dimensional vectors.
CREATE TABLE IF NOT EXISTS public.policy_embeddings (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  policy_id    uuid REFERENCES public.policies(id) ON DELETE CASCADE NOT NULL UNIQUE,
  summary_text text NOT NULL,
  embedding    vector(768) NOT NULL,
  updated_at   timestamptz DEFAULT now()
);

-- 3. Indexes for fast vector similarity search and policy lookup
CREATE INDEX IF NOT EXISTS idx_policy_embeddings_policy_id
  ON public.policy_embeddings(policy_id);

CREATE INDEX IF NOT EXISTS idx_policy_embeddings_updated_at
  ON public.policy_embeddings(updated_at DESC);

-- HNSW cosine distance index for similarity queries
CREATE INDEX IF NOT EXISTS idx_policy_embeddings_vector_cosine
  ON public.policy_embeddings
  USING hnsw (embedding vector_cosine_ops);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.policy_embeddings ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- Admins and Service Role: full CRUD access
DROP POLICY IF EXISTS "Admins have full access to policy embeddings" ON public.policy_embeddings;
CREATE POLICY "Admins have full access to policy embeddings"
  ON public.policy_embeddings FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Authenticated Clients: read-only access for similarity queries on published policies
DROP POLICY IF EXISTS "Clients can read published policy embeddings" ON public.policy_embeddings;
CREATE POLICY "Clients can read published policy embeddings"
  ON public.policy_embeddings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.policies p
      WHERE p.id = policy_embeddings.policy_id AND p.status = 'published'
    )
  );

-- 6. Helper Function: match_policies
-- Performs cosine similarity search against published policy embeddings.
CREATE OR REPLACE FUNCTION public.match_policies(
  query_embedding vector(768),
  match_count int DEFAULT 5
)
RETURNS TABLE (
  policy_id uuid,
  similarity float,
  summary_text text
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pe.policy_id,
    1 - (pe.embedding <=> query_embedding) AS similarity,
    pe.summary_text
  FROM public.policy_embeddings pe
  JOIN public.policies p ON p.id = pe.policy_id
  WHERE p.status = 'published'
  ORDER BY pe.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_policies(vector(768), int) TO authenticated, service_role;
