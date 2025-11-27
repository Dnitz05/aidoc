-- ============================================
-- SideCar Seed Data (Test/Development)
-- ============================================

-- Llicència de test
-- Clau original: SIDECAR-TEST-1234
-- Hash SHA256: echo -n "SIDECAR-TEST-1234" | sha256sum

INSERT INTO licenses (license_key_hash, credits_remaining, is_active)
VALUES (
    'c32c255a1e75577ba7ac81e79688299217b14cea1b0c47eb7a62fb935b02b3a6',
    100,
    true
)
ON CONFLICT (license_key_hash) DO NOTHING;
