-- Canvas boards saved per account. The snapshot is the tldraw document (store records
-- and schema) exactly as the browser holds it; the server does not interpret records.
-- `revision` is the board's version: every save must name the revision it replaces.
CREATE TABLE canvas_boards (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  snapshot JSONB NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX canvas_boards_recent_idx ON canvas_boards (user_id, updated_at DESC);

-- Earlier revisions, newest kept (the store prunes to a fixed number per board).
CREATE TABLE canvas_board_revisions (
  user_id UUID NOT NULL,
  board_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  size_bytes INTEGER NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, board_id, revision),
  FOREIGN KEY (user_id, board_id) REFERENCES canvas_boards (user_id, id) ON DELETE CASCADE
);
