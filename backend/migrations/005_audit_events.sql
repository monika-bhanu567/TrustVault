
CREATE TABLE IF NOT EXISTS audit_events (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL
        CHECK (length(event_type) BETWEEN 1 AND 100),
    actor_id TEXT,
    entity_type TEXT NOT NULL
        CHECK (length(entity_type) BETWEEN 1 AND 100),
    entity_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    previous_hmac CHAR(64),
    event_hmac CHAR(64) NOT NULL
        CHECK (event_hmac ~ '^[a-f0-9]{64}$'),
    CONSTRAINT audit_previous_hmac_format CHECK (
        previous_hmac IS NULL OR previous_hmac ~ '^[a-f0-9]{64}$'
    )
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
    ON audit_events (created_at, id);

CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Audit events are append-only; UPDATE and DELETE are forbidden';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_event_mutation();

DROP TRIGGER IF EXISTS audit_events_no_delete ON audit_events;

CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION prevent_audit_event_mutation();
