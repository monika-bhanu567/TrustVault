CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    owner_id UUID NOT NULL
        REFERENCES users(id) ON DELETE RESTRICT,

    storage_key UUID NOT NULL UNIQUE,
    original_name TEXT NOT NULL
        CHECK (length(original_name) BETWEEN 1 AND 255),

    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL
        CHECK (size_bytes >= 0),

    encryption_iv BYTEA NOT NULL,
    encryption_tag BYTEA NOT NULL,

    content_sha256 CHAR(64) NOT NULL
        CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),

    status TEXT NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'QUARANTINED', 'DELETED')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_owner_created
    ON documents(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_status
    ON documents(status);
