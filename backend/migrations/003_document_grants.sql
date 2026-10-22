CREATE TABLE IF NOT EXISTS document_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    document_id UUID NOT NULL
        REFERENCES documents(id) ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    granted_by UUID NOT NULL
        REFERENCES users(id) ON DELETE RESTRICT,

    can_read BOOLEAN NOT NULL DEFAULT TRUE,
    can_edit BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,

    CONSTRAINT document_grants_permission_check
        CHECK (can_read OR can_edit),

    CONSTRAINT document_grants_expiry_check
        CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_document_grants_user_document
    ON document_grants(user_id, document_id);

CREATE INDEX IF NOT EXISTS idx_document_grants_document
    ON document_grants(document_id);

CREATE INDEX IF NOT EXISTS idx_document_grants_active
    ON document_grants(document_id, user_id)
    WHERE revoked_at IS NULL;
