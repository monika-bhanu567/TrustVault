-- Preserve the immutable legacy ledger while starting a fresh, independently
-- verifiable chain when the original historical signing key is unavailable.
-- This migration never updates or deletes audit_events.

CREATE TABLE IF NOT EXISTS audit_chain_epochs (
    id BIGSERIAL PRIMARY KEY,
    first_event_id BIGINT,
    last_event_id BIGINT,
    status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    verification_status TEXT NOT NULL CHECK (
        verification_status IN ('VERIFIABLE', 'UNVERIFIABLE_KEY_UNAVAILABLE')
    ),
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (status = 'ACTIVE' AND verification_status = 'VERIFIABLE' AND last_event_id IS NULL)
        OR status = 'ARCHIVED'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_chain_epochs_one_active
    ON audit_chain_epochs ((status = 'ACTIVE'))
    WHERE status = 'ACTIVE';

-- If existing records predate this migration, represent them as an immutable
-- historical segment. Their HMACs are deliberately not rewritten.
INSERT INTO audit_chain_epochs (
    first_event_id,
    last_event_id,
    status,
    verification_status,
    note
)
SELECT
    MIN(id),
    MAX(id),
    'ARCHIVED',
    'UNVERIFIABLE_KEY_UNAVAILABLE',
    'Legacy HMAC signing key was unavailable during cloud migration; records retained unchanged.'
FROM audit_events
HAVING COUNT(*) > 0
  AND NOT EXISTS (SELECT 1 FROM audit_chain_epochs);

INSERT INTO audit_chain_epochs (status, verification_status, note)
SELECT
    'ACTIVE',
    'VERIFIABLE',
    'Fresh HMAC epoch started without altering immutable legacy audit records.'
WHERE NOT EXISTS (
    SELECT 1 FROM audit_chain_epochs WHERE status = 'ACTIVE'
);
