-- ============================================
-- SideCar Seed Data (Test/Development)
-- ============================================

-- Llicència de test
-- Clau original: SIDECAR-TEST-1234
-- Hash SHA256 pre-calculat (hex): a94a8fe5ccb19ba61c4c0873d391e987982fbbd3

INSERT INTO licenses (license_key_hash, credits_remaining, is_active)
VALUES (
    'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3',
    100,
    true
)
ON CONFLICT (license_key_hash) DO NOTHING;
