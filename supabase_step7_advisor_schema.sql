-- ============================================================
-- InsuranceAI — Step 7 (Phase 1): Policy Advisor Chatbot Schema
-- Run this entire file in Supabase Dashboard → SQL Editor
-- ============================================================

-- ── 1. chat_conversations table ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title       text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_client_id
  ON public.chat_conversations(client_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated_at
  ON public.chat_conversations(updated_at DESC);

-- ── 2. chat_messages table ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid REFERENCES public.chat_conversations(id) ON DELETE CASCADE NOT NULL,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text NOT NULL,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id
  ON public.chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
  ON public.chat_messages(created_at ASC);

-- ── 3. chat_attachments table ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_attachments (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid REFERENCES public.chat_conversations(id) ON DELETE CASCADE NOT NULL,
  file_path       text NOT NULL,
  filename        text NOT NULL,
  uploaded_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_conversation_id
  ON public.chat_attachments(conversation_id);

-- ── 4. Enable Row Level Security (RLS) ───────────────────────

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_attachments   ENABLE ROW LEVEL SECURITY;

-- ── 5. RLS Policies — chat_conversations ─────────────────────

DROP POLICY IF EXISTS "Clients can view their own conversations"   ON public.chat_conversations;
DROP POLICY IF EXISTS "Clients can insert their own conversations" ON public.chat_conversations;

CREATE POLICY "Clients can view their own conversations"
  ON public.chat_conversations FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());

CREATE POLICY "Clients can insert their own conversations"
  ON public.chat_conversations FOR INSERT
  TO authenticated
  WITH CHECK (client_id = auth.uid());

-- ── 6. RLS Policies — chat_messages ──────────────────────────

DROP POLICY IF EXISTS "Clients can view messages in own conversations"   ON public.chat_messages;
DROP POLICY IF EXISTS "Clients can insert messages in own conversations" ON public.chat_messages;

CREATE POLICY "Clients can view messages in own conversations"
  ON public.chat_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_conversations cc
      WHERE cc.id = chat_messages.conversation_id
        AND cc.client_id = auth.uid()
    )
  );

CREATE POLICY "Clients can insert messages in own conversations"
  ON public.chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_conversations cc
      WHERE cc.id = chat_messages.conversation_id
        AND cc.client_id = auth.uid()
    )
  );

-- ── 7. RLS Policies — chat_attachments ───────────────────────

DROP POLICY IF EXISTS "Clients can view attachments in own conversations"   ON public.chat_attachments;
DROP POLICY IF EXISTS "Clients can insert attachments in own conversations" ON public.chat_attachments;

CREATE POLICY "Clients can view attachments in own conversations"
  ON public.chat_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_conversations cc
      WHERE cc.id = chat_attachments.conversation_id
        AND cc.client_id = auth.uid()
    )
  );

CREATE POLICY "Clients can insert attachments in own conversations"
  ON public.chat_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_conversations cc
      WHERE cc.id = chat_attachments.conversation_id
        AND cc.client_id = auth.uid()
    )
  );

-- ── 8. Storage bucket: chat-attachments ──────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- ── 9. Storage RLS — chat-attachments bucket ─────────────────
--
-- Object path format: <conversation_id>/<filename>
-- Verified through conversation ownership: cc.id::text = split_part(name, '/', 1) AND cc.client_id = auth.uid()

DROP POLICY IF EXISTS "Clients can read own chat attachments"   ON storage.objects;
DROP POLICY IF EXISTS "Clients can upload own chat attachments" ON storage.objects;

CREATE POLICY "Clients can read own chat attachments"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND EXISTS (
      SELECT 1 FROM public.chat_conversations cc
      WHERE cc.id::text = split_part(storage.objects.name, '/', 1)
        AND cc.client_id = auth.uid()
    )
  );

CREATE POLICY "Clients can upload own chat attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND EXISTS (
      SELECT 1 FROM public.chat_conversations cc
      WHERE cc.id::text = split_part(name, '/', 1)
        AND cc.client_id = auth.uid()
    )
  );
