ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Uncategorized'
  CHECK (length(category) BETWEEN 1 AND 80);

CREATE INDEX IF NOT EXISTS idx_documents_category
  ON documents(category)
  WHERE status = 'ACTIVE';
