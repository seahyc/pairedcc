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
- Data prototype (`?prototype=data`, then **Data prototype page**): a dataset table with editable cells, a bar chart over it filtered and selected by clicking, exact chart state readable by agents, and stale marking (dashed chart with Recompute, a "stale" flag on derived notes) when an input changes. Synthetic data only.
- Learning prototype (`?prototype=learning`, then **Learning prototype page**): predict-then-check and generate-first prompt cards that hide a result until the person answers or skips.
- Browser object interface: `window.paired.read()`, `create(input)`, `update(input)`, `select(ids)`, `undo()` and `redo()`.

Local HTTP and MCP access are now implemented; see [AGENT_API.md](AGENT_API.md). A built-in AI assistant remains future work. Updates require `expectedRevision`; stale updates and updates to locked objects are rejected. Agents and humans use the same tldraw store and history.

## Checks

```sh
pnpm build:canvas   # from the repository root: type check and production build
pnpm test:canvas    # unit tests, including a check that AGENT_API.md documents every tool
```

Live checks against a running dev server are listed at the end of [AGENT_API.md](AGENT_API.md).

Browser checks performed 17 Nov 2026: native object dragging, pen drawing, text editing, inspector width/color edits, pan/zoom controls, keyboard undo, revision-aware object operations, stale-write rejection, local reload persistence, export and re-import of the exported document. The 390px layout was checked for horizontal overflow. No quantified latency or frame-rate benchmark was run.

## Sprint scorecard

`pnpm eval:canvas` (from the repository root) starts its own dev server on port 5191, drives headless Chromium and a real stdio MCP client, and writes `eval/scorecard.json` plus the scorecard table in `SPRINT-REPORT.md`:

- **Acceptance**: the working spec's first scenario step by step; the person clicks, types and drops files in the page, the agent uses MCP. Expected values are computed from the fixture, not read back from the canvas.
- **Safety**: stale agent write against a newer human edit, agent undo (`canvas_undo_run`) with interleaved human edits, and agent writes to a locked object; counts human edits lost.
- **Persistence**: a board saved in one browser profile, compared through `read` in a clean profile.
- **Performance**: load time and median pan frame time at 1k and 10k objects, compared with the previous scorecard (more than 25% slower is flagged). Boards are built with the editor directly through `window.__pairedEditor`, which only development builds expose.
- **Agent usability**: tasks in `eval/tasks/` with machine-checked end states; the script reports the latest recorded attempt (`eval/agent-runs/latest.json`) and never calls a model.
- **Existing product**: `pnpm build` and `pnpm -r --no-bail test`, per package.

`--only=acceptance,safety,…` runs a subset and carries the other measures over from the previous scorecard, labelled as such. `--no-write` prints without writing. `EVAL_URL` reuses a running dev server; `CHROMIUM_PATH` points at a browser if Playwright has none installed.

## Scope and limitations

This first pass adopts familiar canvas primitives and interactions. It does not reproduce Paper's CSS-flex layout system, shaders, component system or HTML/React export. Interactive data widgets exist only as the flagged data prototype (one bar chart type); a built-in assistant comes later. The local agent transport is implemented.

The prototype stores work in the current browser profile. Export a file to move work between profiles or devices. Boards are not stored on a server and there is no multiplayer backend; hosted agent access (`https://paired.cc/mcp`) relays commands to a signed-in open tab. tldraw development use works locally; production use requires an appropriate tldraw license. No production deployment was made.

## Agent workflow

Open **Agent access** for the MCP configuration for this tab. The 26 tools include an overview read, the feedback queue (read and reply), four prototype data tools (dataset, chart, chart state, cell), a prototype learning prompt, scene composition, nested frames, layout and duplication, per-operation undo, targeted feedback and image operations. The **Agent studio** page is a scripted SVG demonstration. Integration checks cover the real HTTP/browser bridge and MCP stdio protocol. Locally the API runs in the development server. On paired.cc, Agent access shows a one-line command per client and the hosted endpoint forwards to the signed-in tab.

## Migration compatibility

Moved from Picabird on 17 Nov 2026. Browser persistence and session-storage keys intentionally retain their old names so existing localhost:5183 canvases remain available. The MCP process now uses `PAIRED_SESSION` / `PAIRED_URL`; copy fresh configuration from Agent access. This package is local-only; paired.cc’s document service and public routing are unchanged.
