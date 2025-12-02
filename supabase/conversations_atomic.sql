-- ═══════════════════════════════════════════════════════════════
-- ATOMIC CONVERSATION OPERATIONS (v5.2)
-- Fixes race conditions in message appending
-- ═══════════════════════════════════════════════════════════════

-- Function: Atomic append messages to conversation
-- Uses jsonb_concat to avoid read-modify-write race conditions
CREATE OR REPLACE FUNCTION append_conversation_messages(
  p_conversation_id uuid,
  p_license_hash text,
  p_messages jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
  v_new_count int;
BEGIN
  -- Atomic update using jsonb concatenation
  UPDATE conversations
  SET
    messages = COALESCE(messages, '[]'::jsonb) || p_messages,
    message_count = COALESCE(message_count, 0) + jsonb_array_length(p_messages),
    updated_at = now()
  WHERE id = p_conversation_id
    AND license_key_hash = p_license_hash
  RETURNING message_count INTO v_new_count;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'error', 'conversation_not_found'
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'message_count', v_new_count,
    'appended', jsonb_array_length(p_messages)
  );
END;
$$;

-- Function: Generate auto-title request marker
-- Returns conversations that need AI-generated titles
CREATE OR REPLACE FUNCTION get_conversations_needing_title(
  p_license_hash text,
  p_limit int DEFAULT 5
) RETURNS TABLE(
  id uuid,
  first_messages jsonb
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    id,
    messages[0:3] as first_messages  -- First 4 messages (0-indexed)
  FROM conversations
  WHERE license_key_hash = p_license_hash
    AND message_count >= 2
    AND (title IS NULL OR title LIKE 'Nova conversa%' OR length(title) > 40)
    AND NOT COALESCE((metadata->>'ai_title_generated')::boolean, false)
  ORDER BY updated_at DESC
  LIMIT p_limit;
$$;

-- Function: Set AI-generated title
CREATE OR REPLACE FUNCTION set_conversation_ai_title(
  p_conversation_id uuid,
  p_license_hash text,
  p_title text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE conversations
  SET
    title = p_title,
    metadata = COALESCE(metadata, '{}'::jsonb) || '{"ai_title_generated": true}'::jsonb,
    updated_at = now()
  WHERE id = p_conversation_id
    AND license_key_hash = p_license_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'not_found');
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'title', p_title);
END;
$$;

-- Grant execute permissions (for RLS with service role)
GRANT EXECUTE ON FUNCTION append_conversation_messages TO service_role;
GRANT EXECUTE ON FUNCTION get_conversations_needing_title TO service_role;
GRANT EXECUTE ON FUNCTION set_conversation_ai_title TO service_role;
