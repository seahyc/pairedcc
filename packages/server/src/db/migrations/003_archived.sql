ALTER TABLE documents ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX idx_documents_owner_active ON documents(owner_id, updated_at DESC) WHERE archived = false;
