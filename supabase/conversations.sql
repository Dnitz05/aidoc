-- ═══════════════════════════════════════════════════════════════
-- CONVERSATIONS TABLE - Chat History for Docmile v5.0
-- ═══════════════════════════════════════════════════════════════
--
-- Estructura de messages JSONB:
-- [
--   {
--     "id": "msg_uuid",
--     "role": "user" | "ai" | "system",
--     "content": "text...",
--     "timestamp": "2024-12-02T10:30:00Z",
--     "metadata": {                    // Opcional, només per AI
--       "mode": "edit" | "chat",
--       "edited_target": 3,
--       "thought": "raonament..."
--     }
--   }
-- ]
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ═══ IDENTITY ═══
  license_key_hash TEXT NOT NULL,
  doc_id TEXT NULL,  -- Opcional: vincular a document específic

  -- ═══ CONTENT ═══
  title TEXT NOT NULL,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  message_count INTEGER NOT NULL DEFAULT 0,

  -- ═══ FLAGS ═══
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,

  -- ═══ TIMESTAMPS ═══
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════

-- Llistar converses d'un usuari (ordenat per últim update)
CREATE INDEX IF NOT EXISTS idx_conversations_user
ON conversations(license_key_hash, updated_at DESC);

-- Filtrar per document
CREATE INDEX IF NOT EXISTS idx_conversations_doc
ON conversations(doc_id, updated_at DESC)
WHERE doc_id IS NOT NULL;

-- Converses actives (no archived)
CREATE INDEX IF NOT EXISTS idx_conversations_active
ON conversations(license_key_hash, updated_at DESC)
WHERE archived = FALSE;

-- Cerca full-text en títols
CREATE INDEX IF NOT EXISTS idx_conversations_title_search
ON conversations USING gin(to_tsvector('simple', title));

-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything
CREATE POLICY "Service role full access" ON conversations
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════════════════

-- Generar títol automàtic del primer missatge
CREATE OR REPLACE FUNCTION generate_conversation_title(p_content TEXT)
RETURNS TEXT AS $$
BEGIN
  -- Truncar a 50 chars i afegir ... si cal
  IF length(p_content) > 50 THEN
    RETURN substring(p_content from 1 for 47) || '...';
  END IF;
  RETURN p_content;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Afegir missatge a conversa (atomic)
CREATE OR REPLACE FUNCTION append_conversation_message(
  p_conversation_id UUID,
  p_message JSONB
)
RETURNS TABLE (
  new_message_count INTEGER,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  UPDATE conversations
  SET
    messages = messages || p_message,
    message_count = conversations.message_count + 1,
    updated_at = NOW()
  WHERE id = p_conversation_id
  RETURNING conversations.message_count, conversations.updated_at;
END;
$$ LANGUAGE plpgsql;

-- Afegir múltiples missatges alhora (user + ai)
CREATE OR REPLACE FUNCTION append_conversation_messages(
  p_conversation_id UUID,
  p_messages JSONB  -- Array de missatges
)
RETURNS TABLE (
  new_message_count INTEGER,
  updated_at TIMESTAMPTZ
) AS $$
DECLARE
  msg_count INTEGER;
BEGIN
  -- Comptar missatges a afegir
  SELECT jsonb_array_length(p_messages) INTO msg_count;

  RETURN QUERY
  UPDATE conversations
  SET
    messages = messages || p_messages,
    message_count = conversations.message_count + msg_count,
    updated_at = NOW()
  WHERE id = p_conversation_id
  RETURNING conversations.message_count, conversations.updated_at;
END;
$$ LANGUAGE plpgsql;

-- Llistar converses amb preview del primer missatge
CREATE OR REPLACE FUNCTION list_conversations(
  p_license_key_hash TEXT,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0,
  p_doc_id TEXT DEFAULT NULL,
  p_include_archived BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  preview TEXT,
  message_count INTEGER,
  pinned BOOLEAN,
  doc_id TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.title,
    -- Preview: primer missatge truncat a 80 chars
    CASE
      WHEN jsonb_array_length(c.messages) > 0 THEN
        substring(c.messages->0->>'content' from 1 for 80)
      ELSE ''
    END as preview,
    c.message_count,
    c.pinned,
    c.doc_id,
    c.created_at,
    c.updated_at
  FROM conversations c
  WHERE c.license_key_hash = p_license_key_hash
    AND (p_include_archived OR c.archived = FALSE)
    AND (p_doc_id IS NULL OR c.doc_id = p_doc_id)
  ORDER BY c.pinned DESC, c.updated_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Comptar converses d'un usuari (per verificar límits)
CREATE OR REPLACE FUNCTION count_user_conversations(
  p_license_key_hash TEXT,
  p_include_archived BOOLEAN DEFAULT FALSE
)
RETURNS INTEGER AS $$
DECLARE
  conv_count INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER INTO conv_count
  FROM conversations
  WHERE license_key_hash = p_license_key_hash
    AND (p_include_archived OR archived = FALSE);

  RETURN conv_count;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- CLEANUP FUNCTIONS
-- ═══════════════════════════════════════════════════════════════

-- Eliminar converses antigues (segons pla)
CREATE OR REPLACE FUNCTION cleanup_old_conversations(
  p_retention_days INTEGER DEFAULT 30
)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM conversations
  WHERE updated_at < NOW() - (p_retention_days || ' days')::INTERVAL
    AND pinned = FALSE
    AND archived = FALSE;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Arxivar converses inactives (alternativa a eliminar)
CREATE OR REPLACE FUNCTION archive_inactive_conversations(
  p_days_inactive INTEGER DEFAULT 14
)
RETURNS INTEGER AS $$
DECLARE
  archived_count INTEGER;
BEGIN
  UPDATE conversations
  SET archived = TRUE
  WHERE updated_at < NOW() - (p_days_inactive || ' days')::INTERVAL
    AND pinned = FALSE
    AND archived = FALSE;

  GET DIAGNOSTICS archived_count = ROW_COUNT;
  RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- SEARCH FUNCTION (Full-text)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION search_conversations(
  p_license_key_hash TEXT,
  p_search_query TEXT,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  preview TEXT,
  message_count INTEGER,
  relevance REAL,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.title,
    substring(c.messages->0->>'content' from 1 for 80) as preview,
    c.message_count,
    ts_rank(to_tsvector('simple', c.title), plainto_tsquery('simple', p_search_query)) as relevance,
    c.updated_at
  FROM conversations c
  WHERE c.license_key_hash = p_license_key_hash
    AND c.archived = FALSE
    AND (
      to_tsvector('simple', c.title) @@ plainto_tsquery('simple', p_search_query)
      OR c.title ILIKE '%' || p_search_query || '%'
    )
  ORDER BY relevance DESC, c.updated_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- PAGINATED MESSAGE RETRIEVAL (v6.5)
-- ═══════════════════════════════════════════════════════════════

-- Get paginated messages from a conversation (for lazy loading)
-- Returns newest messages first, client reverses for display
CREATE OR REPLACE FUNCTION get_conversation_messages(
  p_conversation_id UUID,
  p_license_hash TEXT,
  p_offset INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB AS $$
DECLARE
  conv_record RECORD;
  total_count INTEGER;
  msg_slice JSONB;
BEGIN
  -- 1. Verify ownership and get conversation
  SELECT messages, message_count INTO conv_record
  FROM conversations
  WHERE id = p_conversation_id AND license_key_hash = p_license_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'conversation_not_found');
  END IF;

  total_count := COALESCE(conv_record.message_count, 0);

  -- 2. If no messages, return empty
  IF total_count = 0 OR conv_record.messages IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'ok',
      'messages', '[]'::jsonb,
      'total_count', 0
    );
  END IF;

  -- 3. Extract slice of messages (from end, for "load older" pattern)
  -- We load from newest to oldest, then reverse in the client
  SELECT COALESCE(jsonb_agg(elem ORDER BY idx DESC), '[]'::jsonb)
  INTO msg_slice
  FROM (
    SELECT elem, idx
    FROM jsonb_array_elements(conv_record.messages) WITH ORDINALITY arr(elem, idx)
    ORDER BY idx DESC  -- Newest first
    OFFSET p_offset
    LIMIT p_limit
  ) sub;

  -- 4. Reverse to chronological order for client display
  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
  INTO msg_slice
  FROM (
    SELECT elem
    FROM jsonb_array_elements(msg_slice) WITH ORDINALITY arr(elem, idx)
    ORDER BY idx DESC
  ) sub;

  RETURN jsonb_build_object(
    'status', 'ok',
    'messages', msg_slice,
    'total_count', total_count
  );
END;
$$ LANGUAGE plpgsql;

-- Atomic append with ownership verification (v6.5 enhanced)
CREATE OR REPLACE FUNCTION append_conversation_messages(
  p_conversation_id UUID,
  p_license_hash TEXT,
  p_messages JSONB
)
RETURNS JSONB AS $$
DECLARE
  msg_count INTEGER;
  new_count INTEGER;
BEGIN
  -- Verify ownership
  IF NOT EXISTS (
    SELECT 1 FROM conversations
    WHERE id = p_conversation_id AND license_key_hash = p_license_hash
  ) THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'conversation_not_found');
  END IF;

  -- Count messages to append
  SELECT jsonb_array_length(p_messages) INTO msg_count;

  -- Atomic append
  UPDATE conversations
  SET
    messages = messages || p_messages,
    message_count = message_count + msg_count,
    updated_at = NOW()
  WHERE id = p_conversation_id
  RETURNING message_count INTO new_count;

  RETURN jsonb_build_object(
    'status', 'ok',
    'message_count', new_count,
    'appended', msg_count
  );
END;
$$ LANGUAGE plpgsql;
