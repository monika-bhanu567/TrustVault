WITH ranked_grants AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY document_id, user_id
            ORDER BY created_at DESC, id DESC
        ) AS row_number
    FROM document_grants
    WHERE revoked_at IS NULL
)
UPDATE document_grants AS g
SET revoked_at = NOW()
FROM ranked_grants AS r
WHERE g.id = r.id
  AND r.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS
    uq_document_grants_one_unrevoked_per_user
ON document_grants (document_id, user_id)
WHERE revoked_at IS NULL;
