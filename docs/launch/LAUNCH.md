# paired.cc Launch Kit

Everything you need day-of. Edit the specifics, then fire.

## Positioning (the one-liner)

> **paired.cc is the doc where any agent can join.** Open a link. Any agent — Claude, Codex, your custom MCP — can read and write it over HTTP. No proprietary integration, no vendor-locked copilot. The doc is the API.

## The three-line pitch (for PH tagline, HN title, Twitter bio)

**Tagline:** The doc where any agent can join.

**Subline:** Open protocol, CRDT-live multiplayer, sandboxed agent-authored blocks.

**One-liner (HN title):** *Show HN: paired.cc — an open protocol for agents to co-edit live documents*

## ProductHunt

**Title:** paired.cc
**Tagline:** The doc where any agent can join
**Description:**
> paired.cc is a collaborative document canvas where AI agents are first-class participants. Any agent can read and write paired.cc docs over plain HTTP — no proprietary integration, no sidebar cosplay. Agents can drop live, multiplayer-stateful blocks into any doc: charts, tables, sandboxed React mini-apps, live SQL queries against your Postgres.
>
> We ship an open protocol (PCC-MD), a TypeScript SDK (@pairedcc/sdk), and a CRDT-backed editor that renders agent-authored software safely in sandboxed iframes.
>
> Built for agent developers who are tired of every tool reinventing a proprietary integration layer.

**Gallery (suggested):**
1. Hero shot — a doc with a chart, callout, and agent cursor visible
2. The sandboxed React block with "Click me (42)" + the live state panel
3. A scrollytelling explainer in editorial theme
4. The Share modal open, showing human + agent URLs side by side
5. A split-screen: two browser windows editing the same doc with cursors

## HackerNews (Show HN)

**Title:** `Show HN: Paired.cc – an open protocol for agents to co-edit live documents`

**Body:**

> Hi HN! I built paired.cc because every AI tool reinvents its own proprietary integration and I wanted a standard.
>
> The pitch: a doc is the simplest possible API. paired.cc is a collaborative canvas where:
>
> - **Any agent can read any doc via `curl`**. `GET /api/documents/:id/raw` returns paired.cc-flavored markdown — CommonMark with fenced blocks that round-trip interactive components.
> - **Any agent can write any doc via HTTP**. `@pairedcc/sdk` is 200 lines and zero dependencies. `paired.blocks.upsert(docId, paired.blocks.chart({...}))`.
> - **State is CRDT-merged across every viewer.** When an agent writes a React mini-app into a doc and five readers open it, their interactions merge via Yjs — no lost updates.
> - **Sandboxed by default.** Agent-authored code runs in an opaque-origin iframe. The bridge (`window.paired.state/fetch/db/user`) is the only I/O, so agent code can never touch your cookies or your Postgres password.
> - **Read from your own data.** Connect a Postgres (encrypted server-side), grant it per-doc, and any block can call `paired.db(connectorId, query)`. Read-only by default, write requires explicit scope.
>
> Tech: Tiptap + Yjs + y-websocket + Hono + Postgres + Redis. React 19, TypeScript.
>
> Protocol spec: [github.com/seahyc/pairedcc/blob/main/docs/PROTOCOL.md]
> SDK: `npm install @pairedcc/sdk`
> Try it (no signup): [paired.cc]
>
> Happy to answer anything about the CRDT design, the iframe sandbox, or why I think the right abstraction for "agents + docs" is a protocol, not a SaaS.

## Twitter/X thread

**Tweet 1 (hook):**

> Every AI tool reinvents its own integration layer. Claude has Artifacts. Notion has AI. Google has Gemini. They don't talk to each other.
>
> What if a doc was just a doc — and any agent could join?
>
> Meet paired.cc. Open protocol for agents to co-edit live documents.

**Tweet 2 (the substrate):**

> The primitive: every interactive block is a Yjs CRDT Map. `{ type, anchor, props, state }`.
>
> State is Yjs-shared across all viewers. An agent drops a React mini-app into a doc. Five readers open it. Their clicks merge live.
>
> Multiplayer software, not just multiplayer text.

**Tweet 3 (the sandbox):**

> Agent-authored code runs in an opaque-origin iframe. `sandbox="allow-scripts"`, no same-origin, strict CSP.
>
> The only I/O is postMessage to `window.paired`. Agents get: state.get/set, fetch (allowlisted), db (via encrypted Postgres connectors), user().
>
> Cannot touch your cookies. Cannot read your DB password. Can still build anything.

**Tweet 4 (the protocol):**

> Curl any public doc as markdown. No auth, no MCP, no custom integration. The URL IS the protocol.
>
> ```
> curl https://paired.cc/api/documents/<id>/raw
> ```
>
> Agents on machine A write. Agents on machine B read. Same doc. Everyone stays in sync via CRDT.

**Tweet 5 (the SDK):**

> `npm install @pairedcc/sdk`
>
> ```ts
> const paired = new PairedClient({ apiKey: '...' })
> await paired.blocks.upsert(docId, paired.blocks.chart({
>   kind: 'line', x: 'month', y: 'revenue',
>   data: [{ month: 'Jan', revenue: 12000 }],
> }))
> ```

**Tweet 6 (call to action):**

> Try it with zero signup → [paired.cc]
> Protocol spec → [github.com/seahyc/pairedcc/blob/main/docs/PROTOCOL.md]
> SDK → `@pairedcc/sdk`
>
> If you're building with Claude Code, MCP, or any agent framework — I'd love to hear what blocks you want next.

## 60-second Loom storyboard

| Time | On-screen | Voiceover |
|---|---|---|
| 0:00 | paired.cc/d/demo (open in browser), blank doc | "paired.cc is a collaborative doc where any agent can join." |
| 0:05 | Type `/chart` → chart block appears | "Use slash commands for live blocks — charts, tables, scrollytelling." |
| 0:15 | Open second tab of same URL | "Multiplayer out of the box." |
| 0:20 | Click into a React block, click counter | "Every block has CRDT-shared state. Both tabs update together." |
| 0:30 | Terminal: `curl /api/documents/.../raw` | "Curl the doc as markdown. No auth needed." |
| 0:40 | Terminal: `npm install @pairedcc/sdk` + example code | "Or use the SDK. Any agent can read and write." |
| 0:50 | Terminal: node script runs → chart appears in browser | "Live. No reload. Doc stays in sync." |
| 0:55 | Text overlay: "paired.cc — open protocol for agent docs" | "Link in bio. Happy to chat." |

## Demo doc checklist (5 to feature)

1. **"How paired.cc works"** — scrollytelling explainer with chart + callouts. Editorial theme.
2. **"Revenue dashboard"** — SQL block + chart bound to a Postgres connector. Realistic ops doc.
3. **"Agent-authored React app"** — a working todo list as a `react` block. CRDT-shared state.
4. **"From a Claude Code session"** — transcript of Claude writing a doc via SDK, with the resulting doc embedded.
5. **"The protocol spec, interactively"** — the PROTOCOL.md rendered with live blocks showing each section.

## Reach-out list

- Claude Code Discord (pinned)
- MCP Slack / working group
- YC alumni list (if any)
- Tiptap community Discord (we're a major user)
- Yjs Discord (we're a major user)
- Observable community (pitch as "Observable but multiplayer + agent-authored")
- Hex community (pitch as "notebook-style docs for ops teams")
- Hacker News
- Lobste.rs
- A few power-user Twitter accounts for AI tooling

## Pre-launch checklist (morning of)

- [ ] Server health: `curl /api/health` reports db=ok, redis=ok
- [ ] Tests pass: `npm test` in packages/server, packages/sdk, packages/web
- [ ] VERSION bumped to `0.1.0`
- [ ] CHANGELOG.md updated with the launch release
- [ ] 5 demo docs seeded and live
- [ ] Twitter thread scheduled
- [ ] HN post drafted (submit early AM Pacific)
- [ ] PH gallery uploaded
- [ ] Loom rendered + posted
- [ ] README.md final pass
- [ ] @pairedcc/sdk published to npm
