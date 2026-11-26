# Paired canvas

Local thinking-canvas prototype with a Paper-inspired editor shell over tldraw 5.6.1.

```sh
pnpm install # from the repository root
pnpm dev:canvas
```

Open http://localhost:5183/canvas/. This is a separate package alongside Paired's existing document editor and server.

What the canvas is for, and what it does about each principle it is built on, is in [`docs/canvas/principles.md`](../../docs/canvas/principles.md).

## How to use it

1. **Write a thought.** Double-click the board (or press N) and type. Pink handwriting is you.
2. **Ask.** Select what you mean and press ⌘↵, or use Ask on the bar that appears on the selection. Type a question or tap a starter.
3. **Read the answer beside it.** One short lavender card, or two to four alternatives side by side. The line under your ask says who answered, how long it took and what they were given.
4. **Judge it.** Pick (P), cross out (X) or comment (C). Agent cards are ordinary cards: edit or delete them.
5. **Bring material in.** Paste a copied spreadsheet range or a document (⌘V), drop a file, or use Import a file in the menu. Rows of prose become one cluster of cards per row, grids of numbers stay a table; J and K step through the records. See [`docs/canvas/import.md`](../../docs/canvas/import.md).
6. **Ask again**, about the answer or about anything else. Layers, properties, the feedback queue, other boards and export are in the menu at the top right.

## The resident agent

Asks are answered by an agent that is listening. The resident agent does that on your own computer with the Claude Code CLI you are already signed in to:

```sh
pnpm --filter @pairedcc/canvas agent
```

It waits for asks from any open canvas tab on this computer, runs `claude -p` once per ask (no tools, no MCP servers, no project files or memory, an empty working directory) and places the answer through the same operations any external agent uses. The model sees only what the ask shows as its context: the question, the selected objects, the frame they sit in and the exchange that led there. An answer took 3 to 4 seconds in testing with the default model. Settings: `PAIRED_AGENT_MODEL` (default `sonnet`), `PAIRED_AGENT_NAME` (default `Claude`), `PAIRED_CLAUDE_BIN`, `PAIRED_URL`.

If no agent is listening, the top bar says so and an ask shows "No agent is listening" with this command; it is picked up as soon as an agent starts.

To keep it running on a Mac, a second LaunchAgent can run the same command (`node node_modules/tsx/dist/cli.mjs tools/resident-agent.ts` from this directory, with `~/.local/bin` on its `PATH`):

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.paired.canvas.agent.plist   # start
launchctl bootout gui/$(id -u)/com.paired.canvas.agent                                  # stop
```

Its log is `.local/resident-agent.log`.

## Local service

The dev server is managed by user LaunchAgent `com.paired.canvas.dev` (plist in `~/Library/LaunchAgents/`). It starts at login and restarts if it exits, listening on loopback port 5183. Logs are in `.local/dev-server.log` and `.local/dev-server.error.log`. Do not start a second `npm run dev` while this service owns the port. Keep the browser tab open for agent commands.

## Working now

- A calm first board (an invitation and how to ask), a five-tool strip (Select, Write, Pen, Arrow, Ask; the rest under More) and one menu for everything else. A board saved by an earlier version is kept as its own page; "New board" in the menu is one click.
- The Ask loop: asks are cards that show waiting, working, answered or failed with retry, and what the agent was given.
- Text stays in its container: cards wrap and grow downward, plain text wraps at 460 px instead of growing sideways, pasted text is brought to the same width.
- Infinite pan/zoom, selection, snapping, dragging and native resize handles.
- Frames, rectangles, ellipses, freehand paths, rich text, notes, arrows and image import.
- Pages, nested layers, collapse/expand, multiselection, alignment/grouping and object properties.
- Undo/redo, keyboard tool shortcuts and duplicate/delete.
- Local IndexedDB persistence, JSON file export and validated import.
- Scratchbook visual language: pink handwriting and ink for the human, lavender ✦ cards and violet arrows for agents, pick (P) and reject (X) marks, captions, and an open-marks counter. See AGENT_API.md.
- Feedback queue: C comments on the selection or pins a comment under the pointer; comments, picks, rejects and ink over objects form one queue across pages. The Feedback tab lists it (jump, resolve, reopen, export as Markdown or JSON). Agents read it with `feedback`, answer with `reply` and close with `resolve`. `pnpm --filter @pairedcc/canvas feedback` prints it from the open tab.
- Live save state, an agent status chip (last action, failures, lost link) and a shortcut sheet on `?`. The audit behind these is `docs/canvas/usability-heuristics.md`.
- Browser object interface: `window.paired.read()`, `create(input)`, `update(input)`, `select(ids)`, `undo()` and `redo()`.

Local HTTP and MCP access are implemented; see [AGENT_API.md](AGENT_API.md). The resident agent above is the built-in assistant for local use; there is none on paired.cc yet. Updates require `expectedRevision`; stale updates and updates to locked objects are rejected. Agents and humans use the same tldraw store and history.

## Checks

```sh
pnpm build:canvas
pnpm test:canvas
```

`tools/verify-import.mjs <screenshot dir> [origin]` checks import and paste the same way (a pasted review as ten record clusters, the stepper, undo, pick / cross out / comment, the ask context, a numeric table, a markdown file, an image drop, the agent operation) against a dev server of this checkout, with the synthetic fixtures in `test/fixtures/`.

`tools/verify-calm.mjs` drives a fresh browser profile through the whole loop (first load, long text in a card, plain text, a comment and a 300-word paste, an ask answered by the resident agent, the no-agent state, pick, cross out, comment, the queue, reload, an older saved board) and saves screenshots. Playwright is not a dependency here; run it from a directory where it is installed:

```sh
cd /some/dir/with/playwright && node /path/to/packages/canvas/tools/verify-calm.mjs /tmp/shots
```

Browser checks performed 17 Nov 2026: native object dragging, pen drawing, text editing, inspector width/color edits, pan/zoom controls, keyboard undo, revision-aware object operations, stale-write rejection, local reload persistence, export and re-import of the exported document. The 390px layout was checked for horizontal overflow. No quantified latency or frame-rate benchmark was run.

## Scope and limitations

This first pass adopts familiar canvas primitives and interactions. It does not reproduce Paper's CSS-flex layout system, shaders, component system or HTML/React export. Interactive data widgets come later. The local agent transport is implemented.

The prototype stores work in the current browser profile. Export a file to move work between profiles or devices. Boards are not stored on a server and there is no multiplayer backend; hosted agent access (`https://paired.cc/mcp`) relays commands to a signed-in open tab. tldraw development use works locally; production use requires an appropriate tldraw license. No production deployment was made.

## Agent workflow (17 Nov 2026)

Open **Connect an agent** in the menu for the MCP configuration for this tab. The 22 tools include scene composition, nested frames, layout and duplication alongside targeted feedback and image operations. The **Agent studio** page is a scripted SVG demonstration. Integration checks cover the real HTTP/browser bridge and MCP stdio protocol; 41 automated tests and the production build pass. Locally the API runs in the development server. On paired.cc, Connect an agent shows a one-line command per client and the hosted endpoint forwards to the signed-in tab.

## Migration compatibility

Moved from Picabird on 17 Nov 2026. Browser persistence and session-storage keys intentionally retain their old names so existing localhost:5183 canvases remain available. The MCP process now uses `PAIRED_SESSION` / `PAIRED_URL`; copy fresh configuration from Agent access. This package is local-only; paired.cc’s document service and public routing are unchanged.
