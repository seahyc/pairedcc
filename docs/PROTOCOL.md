# paired.cc Protocol (PCC-MD) v0.1

An open protocol for agents to co-edit live documents.

paired.cc's thesis: a document should be a place any agent can join, the way
any person can join a Google Doc. No proprietary sidebar, no vendor-locked
copilot — the doc itself is the API.

This spec is the interop layer. Agents that speak PCC-MD can read and write
paired.cc documents, and paired.cc renders the same documents as rich,
multiplayer, sandboxed software.

**Version 0.1** — intentionally small. Will evolve with SemVer; breaking
changes get a major bump with migration notes.

## 1. Terminology

- **Document** — a paired.cc doc, identified by a UUID. Contains prose
  (markdown) plus an arbitrary number of **blocks**.
- **Block** — an interactive unit the agent authored (chart, table, React
  mini-app, scrolly explainer, ...). Has a **type** (e.g. `chart`), static
  **props** (author config), and live **state** (CRDT-shared across viewers).
- **Anchor** — a stable, URL-safe ID for a block. Format `b-<random>`.
- **Renderer** — the paired.cc canvas code that visualizes a block type.
  Custom types fall back to a debug renderer that shows the raw payload.
- **Connector** — an encrypted credential that lets a block read from an
  external data source (Postgres in v0.1). Owner-granted per-doc.

## 2. Document endpoints

### `POST /api/documents/import`

One-shot: turn a markdown blob into a live document and get back a shareable
web URL. The single call an agent needs to go from markdown to a
collaboratively-editable paired.cc doc.

**Auth is optional.** With a valid session/bearer or `X-API-Key` you get an
**owned** document. With no auth you get an **anonymous** document (24h
expiry) that anyone with the link can open and edit — no API key required.
This is the frictionless "agent fills a doc, human opens the link, both
edit" path.

The markdown is parsed server-side into the same block structure the editor
produces, so a human opening the link sees normal editable blocks (headings,
lists, fenced code, tables, task lists, ...), not one big code block. Live
collaboration works immediately. paired.cc-flavored fences
(```` ```pairedcc:<type> <anchor> ````) round-trip back into real blocks.

Body:

```json
{
  "markdown": "# Title\n\nSome **markdown** body...",
  "title": "Optional title — defaults to the first heading"
}
```

Returns `201` with the document plus a `url`:

```json
{
  "id": "0b2c…",
  "title": "Title",
  "is_anonymous": true,
  "expires_at": "…+24h",
  "url": "https://paired.cc/d/0b2c…",
  "anon_session": "anon_…"   // only for anonymous docs
}
```

The shareable web URL is always `<origin>/d/<id>` (the canvas route). Example:

```bash
curl -sX POST https://paired.cc/api/documents/import \
  -H 'Content-Type: application/json' \
  -d '{"markdown":"# Roadmap\n\n- [ ] ship import endpoint\n- [x] write the spec"}'
# → { "id": "...", "url": "https://paired.cc/d/...", ... }
```

### `GET /api/documents/:id/raw`

Returns the document as `text/markdown; charset=utf-8`. Public and anonymous
docs are readable without auth. Private docs require the API key to belong
to the owner or a collaborator, in which case the key goes in `X-API-Key`.

### `GET /api/documents/:id`

JSON metadata (title, ownership, expiry). Same auth rules as `/raw`.

## 3. Block endpoints (require `X-API-Key`)

All block endpoints live under `/api/agent/documents/:docId/blocks`.

### `GET /api/agent/documents/:docId/blocks`

List all blocks in the doc. Returns an array of `BlockSnapshot`.

### `GET /api/agent/documents/:docId/blocks/:anchor`

Read a single block by anchor. `404` if missing or invalid anchor.

### `POST /api/agent/documents/:docId/blocks/upsert`

Create or update a block. Body:

```json
{
  "anchor": "b-xyz123abc",   // optional — omit to let the server generate
  "type": "chart",           // required when creating a new block
  "props": { ... },          // agent-authored static config
  "state": { ... }           // optional — shallow-merged into existing state
}
```

Returns the updated `BlockSnapshot` (always includes `anchor`).

**Idempotency:** supplying the same `anchor` twice updates in place.
Partial updates are expected — send just `{anchor, state: {...}}` to
mutate state without rewriting props.

**CRDT semantics:** `state` is a shared Yjs Map. Two agents setting
different state keys concurrently both win — no lost updates. Two agents
setting the SAME key is last-writer-wins at the field level (never
mid-field corruption).

### `DELETE /api/agent/documents/:docId/blocks/:anchor`

Remove a block. `404` if the anchor doesn't exist.

## 4. Anchor format

```
anchor  ::= "b-" id
id      ::= 6+ chars of [a-z0-9]
```

Anchors are URL-safe and UUID-like in uniqueness (~47 bits of entropy at
9 chars). They're embedded in the serialized markdown — see §6.

## 5. Block types (built-in)

| Type | Purpose | Props shape (minimum) |
|---|---|---|
| `chart` | Line/bar/area viz | `{kind, x, y, data}` |
| `table` | Sortable/filterable table | `{data}` |
| `scrolly` | Step-driven explainer | `{steps: [{text, panel}]}` |
| `pullquote` | Editorial pull-quote | `{text, attribution?}` |
| `callout` | Note/warn/tip aside | `{kind, body}` |
| `counter` | Multiplayer click counter (demo) | `{}` (state holds `count`) |
| `react` | Sandboxed agent-authored HTML/JS | `{html}` |
| `sql` | Server-run SQL via connector | `{connectorId, query, title?}` |

Custom types are allowed — an unknown type falls back to a debug renderer
and is still round-tripped faithfully through PCC-MD.

## 6. PCC-MD serialization

`/api/documents/:id/raw` emits **paired.cc-flavored markdown** (PCC-MD):
a superset of CommonMark where blocks become fenced code blocks with
language info `pairedcc:<type>` followed by the anchor, and a JSON body:

````markdown
# My dashboard

Some prose.

```pairedcc:chart b-xyz123abc
{
  "props": {
    "kind": "line", "x": "month", "y": "revenue",
    "data": [{"month": "Jan", "revenue": 12000}]
  },
  "state": {}
}
```

More prose.
````

### Graceful fallback

Any markdown viewer that doesn't understand PCC-MD (GitHub, Notion,
Google Docs exporters) renders the block as a normal code block. The
agent and its data are preserved; only the interactive rendering is
downgraded. That's the point — PCC-MD is a CommonMark-compatible
extension, not a parallel format.

### Round-tripping

An agent on machine B can `curl /raw`, parse the fenced blocks, mutate
a field in `state`, and POST back via `/blocks/upsert` with the parsed
anchor. The doc stays in sync.

## 7. Sandbox contract (`react` blocks)

The `react` block type renders inside an iframe with `sandbox="allow-scripts"`
and `srcdoc` (no `allow-same-origin`). The iframe runs in an **opaque
origin**: no parent DOM access, no cookies, no same-origin fetches.

The only I/O is the `window.paired` API:

```ts
paired.state.get(key?): Promise<unknown>
paired.state.set(patch): Promise<void>
paired.state.subscribe(fn): unsubscribe
paired.fetch(url, init?): Promise<{status, body}>       // allowlisted hosts
paired.db(connectorId, query, params?): Promise<{rows}> // connector-routed
paired.user(): Promise<{signedIn, name?}>                // no tokens
```

All methods return Promises resolved via `postMessage` from the parent.
The parent enforces capabilities — agent code can't bypass the bridge.

## 8. Connectors

```http
POST /api/connectors
  { name, kind: "postgres", scope: "read"|"write", creds: { url } }
```

Creds are encrypted server-side with AES-256-GCM. Owner-only. Granted
per-doc via `POST /api/documents/:docId/connectors/:connectorId`.

Public and anonymous docs cannot use connectors — the grant endpoint
refuses to write a row for a non-private doc. This is deliberate:
a shared public URL must never become a vector for credential access.

Query execution:

```http
POST /api/documents/:docId/db/:connectorId/query
  { query: "SELECT ...", params?: [...], write?: false }
```

Read-only queries wrap in `BEGIN READ ONLY`. Write requires both
`connector.scope === "write"` AND `body.write === true`.

## 9. Versioning

This document is v0.1. The SDK exposes `@pairedcc/sdk`, which follows
SemVer. Breaking protocol changes bump the major version; backward-
compatible additions bump the minor.

## 10. Not yet specified (V2+)

- Multi-agent rooms: `@mention` webhooks routing to external agent URLs.
- Live refs / transclusion: `{{api:...}}`, `{{doc:...#section}}`,
  `{{query:connector:sql}}` tokens that resolve at render time.
- Export adapters: native `.docx`, `.pdf` with interactive-block
  snapshots and round-trip links.
- Additional connector kinds: MySQL, REST, Google Sheets, Snowflake.
- LaTeX renderer and multi-format document switching.

---

Feedback, proposals, and issues: [github.com/seahyc/pairedcc](https://github.com/seahyc/pairedcc)
