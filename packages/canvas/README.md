# Paired canvas

Local thinking-canvas prototype with a Paper-inspired editor shell over tldraw 5.6.1.

```sh
pnpm install # from the repository root
pnpm dev:canvas
```

Open http://localhost:5183. This is a separate package alongside Paired’s existing document editor and server.

On YC's Mac, the local server is managed by user LaunchAgent `com.paired.canvas.dev` (plist in `~/Library/LaunchAgents/`). It starts at login and restarts if it exits, listening on loopback port 5183. Logs are in `.local/dev-server.log` and `.local/dev-server.error.log`. Do not start a second `npm run dev` while this service owns the port. Keep the browser tab open for agent commands.

## Working now

- Infinite pan/zoom, selection, snapping, dragging and native resize handles.
- Frames, rectangles, ellipses, freehand paths, rich text, notes, arrows and image import.
- Pages, nested layers, collapse/expand, multiselection, alignment/grouping and object properties.
- Undo/redo, keyboard tool shortcuts and duplicate/delete.
- Local IndexedDB persistence, JSON file export and validated import.
- Scratchbook visual language: pink handwriting and ink for the human, lavender ✦ cards and violet arrows for agents, pick (P) and reject (X) marks, captions, and an open-marks counter. See AGENT_API.md.
- Feedback queue: C comments on the selection or pins a comment under the pointer; comments, picks, rejects and ink over objects form one queue across pages. The Feedback tab lists it (jump, resolve, reopen, export as Markdown or JSON). Agents read it with `feedback`, answer with `reply` and close with `resolve`. `pnpm --filter @pairedcc/canvas feedback` prints it from the open tab.
- Live save state, an agent status chip (last action, failures, lost link) and a shortcut sheet on `?`. The audit behind these is `docs/canvas/usability-heuristics.md`.
- Browser object interface: `window.paired.read()`, `create(input)`, `update(input)`, `select(ids)`, `undo()` and `redo()`.

Local HTTP and MCP access are now implemented; see [AGENT_API.md](AGENT_API.md). A built-in AI assistant remains future work. Updates require `expectedRevision`; stale updates and updates to locked objects are rejected. Agents and humans use the same tldraw store and history.

## Checks

```sh
npm run build
npm test
```

Browser checks performed 17 Nov 2026: native object dragging, pen drawing, text editing, inspector width/color edits, pan/zoom controls, keyboard undo, revision-aware object operations, stale-write rejection, local reload persistence, export and re-import of the exported document. The 390px layout was checked for horizontal overflow. No quantified latency or frame-rate benchmark was run.

## Scope and limitations

This first pass adopts familiar canvas primitives and interactions. It does not reproduce Paper's CSS-flex layout system, shaders, component system or HTML/React export. Interactive data widgets and a built-in assistant come later. The local agent transport is implemented.

The server now has a per-account board API (`/api/canvas/boards`, `packages/server/src/canvas/boards`). It saves the tldraw document with a revision number, rejects a save on a stale revision with 409 and the current revision, keeps the last 50 revisions, and is covered by tests against memory and a real Postgres (`TEST_DATABASE_URL`). The canvas does not use it yet; loading, saving and moving IndexedDB boards up are the next step.

The prototype stores work in the current browser profile. Export a file to move work between profiles or devices. Boards are not stored on a server and there is no multiplayer backend; hosted agent access (`https://paired.cc/mcp`) relays commands to a signed-in open tab. tldraw development use works locally; production use requires an appropriate tldraw license. No production deployment was made.

## Agent workflow (17 Nov 2026)

Open **Agent access** for the MCP configuration for this tab. The 26 tools include an overview read, the feedback queue (read and reply), four prototype data tools (dataset, chart, chart state, cell), a prototype learning prompt, scene composition, nested frames, layout and duplication, per-operation undo, targeted feedback and image operations. The **Agent studio** page is a scripted SVG demonstration. Integration checks cover the real HTTP/browser bridge and MCP stdio protocol; 59 automated tests and the production build pass. Locally the API runs in the development server. On paired.cc, Agent access shows a one-line command per client and the hosted endpoint forwards to the signed-in tab.

## Migration compatibility

Moved from Picabird on 17 Nov 2026. Browser persistence and session-storage keys intentionally retain their old names so existing localhost:5183 canvases remain available. The MCP process now uses `PAIRED_SESSION` / `PAIRED_URL`; copy fresh configuration from Agent access. This package is local-only; paired.cc’s document service and public routing are unchanged.
