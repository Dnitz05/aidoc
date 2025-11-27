-- ============================================
-- SideCar Database Schema
-- ============================================

-- Taula principal de llicències
CREATE TABLE IF NOT EXISTS licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_key_hash TEXT UNIQUE NOT NULL,
    credits_remaining INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Taula de registre d'ús de crèdits
CREATE TABLE IF NOT EXISTS license_usages (
    id BIGSERIAL PRIMARY KEY,
    license_id UUID REFERENCES licenses(id) ON DELETE CASCADE,
    cost INTEGER NOT NULL,
    operation TEXT NOT NULL,
    metadata JSONB,
    used_at TIMESTAMPTZ DEFAULT now()
);

-- Índex per millorar cerques per license_id
CREATE INDEX IF NOT EXISTS idx_license_usages_license_id ON license_usages(license_id);

-- ============================================
-- Funció RPC: use_license_credits
-- ============================================
-- Gestiona la deducció de crèdits de forma atòmica
-- Retorna JSON amb {ok, credits_remaining} o {ok: false, error}

CREATE OR REPLACE FUNCTION use_license_credits(
    p_license_key_hash TEXT,
    p_cost INTEGER,
    p_operation TEXT,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_license_id UUID;
    v_credits INTEGER;
    v_is_active BOOLEAN;
    v_new_credits INTEGER;
BEGIN
    -- Buscar llicència i bloquejar fila per evitar race conditions
    SELECT id, credits_remaining, is_active
    INTO v_license_id, v_credits, v_is_active
    FROM licenses
    WHERE license_key_hash = p_license_key_hash
    FOR UPDATE;

    -- Validacions
    IF v_license_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'LICENSE_NOT_FOUND');
    END IF;

    IF NOT v_is_active THEN
        RETURN jsonb_build_object('ok', false, 'error', 'LICENSE_INACTIVE');
    END IF;

    IF v_credits < p_cost THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'INSUFFICIENT_CREDITS',
            'credits_remaining', v_credits
        );
    END IF;

    -- Calcular nous crèdits
    v_new_credits := v_credits - p_cost;

    -- Actualitzar crèdits
    UPDATE licenses
    SET
        credits_remaining = v_new_credits,
        updated_at = now()
    WHERE id = v_license_id;

    -- Registrar ús
    INSERT INTO license_usages (license_id, cost, operation, metadata)
    VALUES (v_license_id, p_cost, p_operation, p_metadata);

    -- Retornar èxit
    RETURN jsonb_build_object(
        'ok', true,
        'credits_remaining', v_new_credits
    );
END;
$$;

-- ============================================
-- Row Level Security (RLS)
-- ============================================
-- Deneguem accés públic. Només SERVICE_ROLE pot accedir.

ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE license_usages ENABLE ROW LEVEL SECURITY;

-- Política restrictiva per licenses
CREATE POLICY "Deny all public access to licenses"
    ON licenses
    FOR ALL
    USING (false);

-- Política restrictiva per license_usages
CREATE POLICY "Deny all public access to license_usages"
    ON license_usages
    FOR ALL
    USING (false);

-- ============================================
-- Trigger per actualitzar updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_licenses_updated_at
    BEFORE UPDATE ON licenses
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
