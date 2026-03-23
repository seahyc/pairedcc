# paired.cc MVP Design — Sub-project 1

**Date:** 2026-03-23
**Scope:** Markdown editor + Yjs collaboration + basic agent connection

## Overview

paired.cc is a collaborative document canvas where AI agents are first-class participants. This sub-project delivers the core: a real-time collaborative markdown editor where humans and agents share cursors, presence, and edit capabilities.

### MVP Success Scenario

A user opens paired.cc, creates a markdown doc, and shares the link with a collaborator. Both edit with live cursors. The user connects their Claude Code (or Claude Desktop, ChatGPT Desktop, or any MCP-capable client) via an API key. The agent appears as a third cursor. When the user types `@claude` in the doc, the agent receives a notification and responds inline with context-aware edits.

### What's NOT in Scope

- Interactive blocks / sandboxed React rendering
- ONLYOFFICE / Office format import (docx, pptx, xlsx)
- LaTeX renderer
- Section-level permissions
- Selection awareness (agent sees what human highlighted)
- Export to PDF/DOCX
- Billing / pricing tiers

## Architecture

```
Cloudflare (DNS + proxy) → Oracle VM
                            └── docker-compose.yml
                                ├── app       (TS server — Hono/Fastify)
                                ├── postgres  (all data incl. Yjs snapshots)
                                └── redis     (presence, pub/sub)
```

**Approach B: TS server owns document state.** The server decodes Yjs CRDT updates and maintains a server-side representation of each document. This enables @-mention detection, semantic agent APIs, and version attribution without a separate sidecar.

### Key Flows

- **Human edits:** Browser (Tiptap + Yjs) → WebSocket → Server (Yjs doc manager) → broadcast to all peers (other browsers + agents)
- **Agent edits (CLI):** Agent Yjs peer → WebSocket → Server → broadcast to browsers + other agents
- **Agent edits (MCP):** MCP client calls `edit_document` tool → REST API → Server applies Yjs update → broadcast
- **@-mention:** Server detects `@agent-name` in Yjs update → pushes notification to agent's WebSocket → agent processes and responds

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend | React + Tiptap + Yjs | Best Yjs integration, hybrid WYSIWYG, Notion-like UX |
| Backend | TypeScript + Hono or Fastify | Native Yjs support, single language with frontend |
| Collaboration | Yjs (CRDT) + y-websocket | De facto standard, battle-tested |
| Database | PostgreSQL | Users, docs, snapshots, API keys |
| Cache/Pub-sub | Redis | Presence, cursor sync, pub/sub for multi-connection |
| Reverse proxy | Cloudflare (edge) | DNS, DDoS, caching. Origin is the Oracle VM. |
| Deploy | Docker Compose on Oracle VM | app + postgres + redis. Three containers. |
| Domain | paired.cc (Cloudflare) | Already purchased. |

## Data Model

### users

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| email | TEXT UNIQUE | |
| name | TEXT | |
| avatar_url | TEXT | |
| auth_provider | TEXT | github / google / magic |
| created_at | TIMESTAMPTZ | |

### documents

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| title | TEXT | |
| owner_id | UUID FK → users | |
| yjs_state | BYTEA | Latest Yjs snapshot (migrate to S3 later) |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### document_collaborators

| Column | Type | Notes |
|--------|------|-------|
| document_id | UUID FK → documents | |
| user_id | UUID FK → users | |
| role | TEXT | editor / viewer |
| added_at | TIMESTAMPTZ | |

### document_snapshots

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| document_id | UUID FK → documents | |
| author_id | TEXT | User UUID or agent name |
| author_type | TEXT | human / agent |
| yjs_snapshot | BYTEA | Full Yjs state at this point |
| description | TEXT | Auto: "agent edit", "auto-save", "manual save" |
| created_at | TIMESTAMPTZ | |

### api_keys

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | UUID FK → users | |
| key_hash | TEXT | bcrypt hash |
| label | TEXT | "claude-code", "chatgpt-desktop", etc. |
| created_at | TIMESTAMPTZ | |
| last_used | TIMESTAMPTZ | |

### Storage Abstraction

Yjs snapshots are stored behind an interface for easy migration:

```typescript
interface SnapshotStore {
  save(docId: string, data: Uint8Array): Promise<void>
  load(docId: string): Promise<Uint8Array | null>
  list(docId: string): Promise<SnapshotMeta[]>
}
```

MVP: `PostgresSnapshotStore`. Future: `S3SnapshotStore`. No other code changes needed.

## Frontend

### Pages

1. **Landing / Login** — sign in with GitHub, Google, or magic link (email)
2. **Dashboard** — list of docs, create new doc
3. **Editor** — the main surface (see below)
4. **Settings** — manage API keys, profile

### Editor UI

- **Top bar:** Logo, doc title (editable), presence avatars (humans show initials, agents show 🤖), share button
- **Editor area:** Tiptap hybrid WYSIWYG — markdown renders inline, no split pane. Clean, Notion-like single-column layout.
- **Live cursors:** Color-coded per participant with name labels. Agents get a distinct color + bot indicator.
- **@-mention autocomplete:** Type `@` → dropdown of connected agents + collaborators. Selection inserts a mention node.
- **Agent responses:** Appear as styled blocks in the doc flow, attributed to the agent.
- **Version history sidebar:** Toggle to see timeline of snapshots. Click to preview, click "Restore" to revert (non-destructive — restore is a new edit in the history).

### Tiptap Extensions

- `Collaboration` — Yjs binding
- `CollaborationCursor` — live cursors + presence
- `Mention` — @-mention nodes with autocomplete
- `Table` — markdown tables
- `CodeBlock` — fenced code blocks with syntax highlighting
- `TaskList` — checkboxes
- Standard: Bold, Italic, Heading, BulletList, OrderedList, Link, Image, HorizontalRule

## Agent Protocol (MVP)

### MCP Server Tools

Any MCP-capable client (Claude Code, Claude Desktop, ChatGPT Desktop, Agent SDK) can connect using an API key.

| Tool | Parameters | Description |
|------|-----------|-------------|
| `list_documents` | — | List docs the user has access to |
| `read_document` | `doc_id` | Get full markdown content |
| `edit_document` | `doc_id, range, new_content` | Surgical edit by line range or heading reference |
| `get_mentions` | `doc_id` | Unread @-mentions for this agent |
| `respond_to_mention` | `doc_id, mention_id, content` | Reply inline in the doc |
| `get_presence` | `doc_id` | Who's in the doc right now |

### CLI (`pairedcc`)

| Command | Description |
|---------|-------------|
| `pairedcc join <doc-id> --key <api-key>` | Join as Yjs peer, stream updates via WebSocket |
| `pairedcc watch <doc-id>` | Listen for @-mentions, print to stdout |
| `pairedcc edit <doc-id> <range> <content>` | One-shot surgical edit |

### @-mention Notification Flow

1. Human types `@claude` in the doc
2. Server detects the mention node in the Yjs update
3. Server pushes notification over the agent's WebSocket connection, including: mention text, surrounding paragraph context, mention ID
4. Agent receives notification via MCP (as a tool response / event) or CLI (stdout)
5. Agent responds via `edit_document` or `respond_to_mention`

### Agent Authentication

1. User creates an API key in the paired.cc UI with a label (e.g., "claude-code")
2. User configures the key in their MCP client's settings (e.g., Claude Code `settings.json`)
3. MCP server connects to paired.cc backend using the key
4. Agent appears as a cursor in any doc the user has access to
5. Keys inherit the creating user's permissions — no per-document key scoping in the MVP

## Auth & Sharing

### Authentication

- **GitHub OAuth** — primary for developers
- **Google OAuth** — for non-technical collaborators
- **Magic link** — email-based, passwordless login
- All flows issue a JWT session cookie

### Document Sharing

- **Invite by email** — sends magic link if recipient isn't a user yet
- **Role assignment** — editor or viewer
- **Copy link** — shareable URL with configurable access (view or edit)
- **Agent keys** — created in share dialog, shows MCP config snippet to copy-paste

## Version History

- **Auto-snapshot every 5 minutes** + on every agent edit
- **Manual save** — user can trigger a named snapshot
- **Version timeline sidebar** — chronological list of snapshots with author attribution (human name or agent name) and timestamp
- **Preview mode** — click a snapshot to see read-only view with diff highlights against current version
- **Non-destructive restore** — restoring creates a new Yjs update from the old state. The restore itself appears in the history. You can undo a revert.
- **Per-change attribution** — each Yjs update is tagged with the author. Visible as colored highlights in the diff view.

## Deployment

### Docker Compose

```yaml
services:
  app:
    build: .
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: postgres://...
      REDIS_URL: redis://redis:6379
      GITHUB_CLIENT_ID: ...
      GITHUB_CLIENT_SECRET: ...
      GOOGLE_CLIENT_ID: ...
      GOOGLE_CLIENT_SECRET: ...
      JWT_SECRET: ...
      SMTP_URL: ... # for magic links
    depends_on: [postgres, redis]

  postgres:
    image: postgres:16
    volumes: ["pgdata:/var/lib/postgresql/data"]

  redis:
    image: redis:7-alpine

volumes:
  pgdata:
```

### Infrastructure

- **Oracle VM** — hosts Docker Compose
- **Cloudflare** — DNS for `paired.cc`, proxy mode for DDoS protection + edge caching of static assets
- **HTTPS** — Cloudflare handles TLS termination at the edge. Origin can use Cloudflare origin certificates.
- **WebSocket** — Cloudflare proxies WebSocket connections natively

## Error Handling

- **Yjs conflict resolution** — handled by CRDT automatically. No manual merge needed.
- **Agent disconnection** — presence updates in Redis, cursor disappears from UI. Undelivered @-mention notifications are queued and retried on reconnect.
- **Snapshot persistence failure** — retry with exponential backoff. In-memory Yjs state is authoritative; Postgres snapshots are for durability.
- **OAuth failure** — fallback to magic link. Clear error messaging.

## Testing Strategy

- **Unit tests** — Yjs document operations, @-mention detection, snapshot store interface
- **Integration tests** — WebSocket connection lifecycle, auth flows, agent API endpoints
- **E2E tests** — Playwright: create doc → invite collaborator → both edit → verify cursors and content sync
- **Agent integration test** — connect via MCP, read doc, make edit, verify it appears in browser
