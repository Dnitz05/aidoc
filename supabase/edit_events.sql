-- ═══════════════════════════════════════════════════════════════
-- EDIT EVENTS TABLE - Event Sourcing for SideCar v3.0
-- ═══════════════════════════════════════════════════════════════

-- Drop if exists (for development)
-- DROP TABLE IF EXISTS edit_events;

CREATE TABLE IF NOT EXISTS edit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ═══ IDENTITY ═══
  license_key_hash TEXT NOT NULL,
  doc_id TEXT NOT NULL,

  -- ═══ EVENT TYPE ═══
  -- 'UPDATE_BY_ID' = Edició de paràgraf específic
  -- 'REWRITE' = Reescriptura completa
  -- 'REVERT' = Desfer un canvi anterior
  -- 'AUTO_STRUCTURE' = Auto-Structure aplicat
  event_type TEXT NOT NULL CHECK (event_type IN ('UPDATE_BY_ID', 'REWRITE', 'REVERT', 'AUTO_STRUCTURE')),

  -- ═══ TARGET ═══
  target_id INTEGER, -- Paragraph index (for UPDATE_BY_ID)

  -- ═══ CONTENT ═══
  before_text TEXT, -- Text original (null for REWRITE)
  after_text TEXT NOT NULL, -- Text nou (o JSON de blocks per REWRITE)

  -- ═══ AI CONTEXT ═══
  user_instruction TEXT, -- Instrucció de l'usuari
  thought TEXT, -- Raonament de la IA (Chain of Thought)
  ai_mode TEXT, -- 'auto' | 'edit' | 'chat'

  -- ═══ REVERT TRACKING ═══
  reverted_at TIMESTAMPTZ, -- Quan es va desfer (null si actiu)
  reverted_by UUID REFERENCES edit_events(id), -- L'event que el va desfer

  -- ═══ METADATA ═══
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════

-- Per buscar historial d'un document
CREATE INDEX IF NOT EXISTS idx_edit_events_doc
ON edit_events(doc_id, created_at DESC);

-- Per buscar historial d'un usuari
CREATE INDEX IF NOT EXISTS idx_edit_events_license
ON edit_events(license_key_hash, created_at DESC);

-- Per trobar events no revertits
CREATE INDEX IF NOT EXISTS idx_edit_events_active
ON edit_events(doc_id, created_at DESC)
WHERE reverted_at IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE edit_events ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything
CREATE POLICY "Service role full access" ON edit_events
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- CLEANUP FUNCTION (Optional - per mantenir la taula neta)
-- ═══════════════════════════════════════════════════════════════

-- Eliminar events més antics de 30 dies
CREATE OR REPLACE FUNCTION cleanup_old_edit_events()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM edit_events
  WHERE created_at < NOW() - INTERVAL '30 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- HELPER FUNCTION: Get recent history for a document
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_doc_edit_history(
  p_license_key_hash TEXT,
  p_doc_id TEXT,
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  id UUID,
  event_type TEXT,
  target_id INTEGER,
  before_text TEXT,
  after_text TEXT,
  user_instruction TEXT,
  thought TEXT,
  created_at TIMESTAMPTZ,
  is_reverted BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.event_type,
    e.target_id,
    e.before_text,
    e.after_text,
    e.user_instruction,
    e.thought,
    e.created_at,
    (e.reverted_at IS NOT NULL) as is_reverted
  FROM edit_events e
  WHERE e.license_key_hash = p_license_key_hash
    AND e.doc_id = p_doc_id
  ORDER BY e.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
