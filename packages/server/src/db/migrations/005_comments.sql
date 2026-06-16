-- Block-anchored comments + agent inbox.
--
-- A comment is attached to a block via `block_anchor` — a text snippet of the
-- block's content captured at comment time. The same anchor-resolves-at-apply
-- philosophy the agent edit API already uses (DocManager.editByAnchor) keeps
-- comments robust under concurrent edits: we bind to the block's text, not a
-- character offset that drifts.
--
-- `quote` is a snapshot of the block text when the comment was made, so the UI
-- and agent can show "what was being commented on" even after the block is
-- edited. The CURRENT block text is read live from the Yjs doc by the agent
-- inbox endpoint.
--
-- Anonymous docs must support comments too: author_id is nullable and
-- author_type carries 'human' | 'agent'. For anonymous humans we store the
-- anon_session string in author_id (same string the rest of the app uses),
-- with author_type = 'human'.
CREATE TABLE comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  -- The block anchor (text snippet of the block) this thread is attached to.
  block_anchor TEXT NOT NULL,
  -- Snapshot of the block's text at comment time (for display / context).
  quote TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  -- author_id: user UUID (as text), anon_session string, or agent name.
  -- Nullable for fully anonymous authors.
  author_id TEXT,
  author_type TEXT NOT NULL DEFAULT 'human' CHECK (author_type IN ('human', 'agent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  -- When true, the thread is in the agent's inbox (human clicked "Assign to
  -- agent" or tagged @agent in the body).
  assigned_to_agent BOOLEAN NOT NULL DEFAULT false,
  -- Threaded replies: a reply points at its root thread. Roots have parent_id NULL.
  parent_id UUID REFERENCES comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary access pattern: list threads for a doc filtered by status.
CREATE INDEX idx_comments_doc_status ON comments(doc_id, status);
-- Fast reply lookups per thread.
CREATE INDEX idx_comments_parent ON comments(parent_id);
-- Agent inbox: assigned + open comments per doc.
CREATE INDEX idx_comments_doc_assigned ON comments(doc_id, assigned_to_agent, status);

-- @-tags on a comment (or reply). A tag points a comment at a target: a human
-- collaborator (target_type='human', target = user id / display handle) or the
-- agent (target_type='agent', target = agent name, e.g. 'claude'). Tagging the
-- agent is what flips comments.assigned_to_agent = true and routes the thread
-- into the agent inbox. Mirrors the existing inline @-mention UX, persisted so
-- both the human list API and the agent inbox can expose tagged targets.
CREATE TABLE comment_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  -- 'agent' | 'human'
  target_type TEXT NOT NULL CHECK (target_type IN ('agent', 'human')),
  -- The tagged identity: agent name ('claude') or a human handle / user id.
  target TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (comment_id, target_type, target)
);

CREATE INDEX idx_comment_mentions_comment ON comment_mentions(comment_id);
