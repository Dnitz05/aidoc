-- ============================================
-- SideCar User Receipts (Custom Macros)
-- FASE 5: Receptes d'Usuari
-- ============================================

-- Taula per guardar els receipts personalitzats
CREATE TABLE IF NOT EXISTS user_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_key_hash TEXT NOT NULL,
    label TEXT NOT NULL,           -- El text del botó (Ex: "Fes-ho Èpic")
    instruction TEXT NOT NULL,     -- El prompt (Ex: "Reescriu el text amb to èpic...")
    icon TEXT DEFAULT '⚡',        -- Emoji opcional
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Índex per cercar ràpidament per llicència
CREATE INDEX IF NOT EXISTS idx_user_receipts_license ON user_receipts(license_key_hash);

-- RLS: Seguretat
ALTER TABLE user_receipts ENABLE ROW LEVEL SECURITY;

-- Política: Només service_role pot gestionar (com les altres taules)
CREATE POLICY "Deny all public access to user_receipts"
ON user_receipts
FOR ALL
USING (false);
