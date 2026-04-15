-- Connectors: user-owned credentials for external data sources.
-- Creds are encrypted at rest with AES-256-GCM (server-side key from env).
-- A connector is globally owned by a user, then granted per-doc via
-- document_connectors below.
CREATE TABLE connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- 'postgres', 'mysql' (future), etc.
  -- Encrypted credentials bundle. Format: base64(iv) . base64(authTag) . base64(ciphertext)
  encrypted_creds TEXT NOT NULL,
  -- Scope controls write access at the connector level. Per-doc grants may
  -- further restrict. 'read' = SELECT only; 'write' = full access.
  scope TEXT NOT NULL DEFAULT 'read' CHECK (scope IN ('read', 'write')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used TIMESTAMPTZ,
  UNIQUE (user_id, name)
);

CREATE INDEX idx_connectors_user ON connectors(user_id);

-- Per-doc grants: a doc can use a connector only if the owner explicitly
-- approved it for this doc. Public docs get NO connectors — the join is
-- filtered by doc ownership at query time.
CREATE TABLE document_connectors (
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  connector_id UUID NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, connector_id)
);

CREATE INDEX idx_document_connectors_doc ON document_connectors(document_id);
