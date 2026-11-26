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

### On paired.cc

The hosted site has no model of its own. The same script can answer asks there for the accounts the server allows, using the Claude Code login of the computer it runs on:

```sh
PAIRED_URL=https://paired.cc PAIRED_RESIDENT_SECRET_FILE=~/.config/paired/resident-secret pnpm --filter @pairedcc/canvas agent
```

The server side is in `packages/server/src/canvas` (`relay.ts`, `resident.ts`) and is off unless two environment variables are set:

- `CANVAS_RESIDENT_SECRET`: at least 32 characters (`openssl rand -hex 32`). The agent sends it as a bearer token; without it the endpoints answer 404.
- `CANVAS_RESIDENT_ALLOW`: account ids or sign-in emails, comma separated. Only asks from signed-in tabs of these accounts reach the agent, 30 per account per 10 minutes. The answers spend the agent owner's model subscription, which is why the list exists.

The agent may only report on and answer asks (`ask_status`, `answer`) in the tab an ask came from. An allowlisted account sees "Claude is listening" while the agent is polling and "No agent is listening right now" when it is not; an ask made meanwhile is picked up when the agent returns, as long as the tab stays open. Any other account is told to connect its own agent. Answers stop when the computer running the agent is off or asleep.

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
- Board sync: the board is also saved to the signed-in account (`/api/canvas/boards`) a moment after each change, and a clean browser opens it. A save on a stale revision merges by object with the newer version (an edit beats a deletion; where both changed one object this tab wins and the other stays in the board's history). The first sign-in moves the browser's board up. When a browser holds work the account does not and the two cannot be merged (its own earlier board, or unsaved edits while the account's board changed elsewhere), that work is saved as a separate board and the account's board is opened; one whole board never replaces another. No screen lists those separate boards yet. The development server keeps boards for one local person in `.local/boards` (`PAIRED_BOARDS_DIR`). See `src/board-sync.ts`. To use the real server and its accounts instead, start the dev canvas with `PAIRED_SERVER_URL=http://localhost:3000` (sign-in and boards are proxied there); `pnpm --filter @pairedcc/canvas verify:sync-server` starts both against throwaway Postgres and Redis and checks sign-in, save, a clean browser on the same account and isolation from another account (see the header of `tools/verify-board-sync-server.ts`).
- Scratchbook visual language: pink handwriting and ink for the human, lavender ✦ cards and violet arrows for agents, pick (P) and reject (X) marks, captions, and an open-marks counter. See AGENT_API.md.
- Feedback queue: C comments on the selection or pins a comment under the pointer; comments, picks, rejects and ink over objects form one queue across pages. The Feedback tab lists it (jump, resolve, reopen, export as Markdown or JSON). Agents read it with `feedback`, answer with `reply` and close with `resolve`. `pnpm --filter @pairedcc/canvas feedback` prints it from the open tab.
- Live save state, an agent status chip (last action, failures, lost link) and a shortcut sheet on `?`. The audit behind these is `docs/canvas/usability-heuristics.md`.
- Data prototype (`?prototype=data`, then **Data prototype page**, or drop a `.csv` file on the canvas): a dataset table with editable cells, a bar chart over it filtered and selected by clicking, exact chart state readable by agents, and stale marking (dashed chart with Recompute, a "stale" flag on derived notes) when an input changes. Synthetic data only.
- Learning prototype (`?prototype=learning`, then **Learning prototype page**): predict-then-check and generate-first prompt cards that hide a result until the person answers or skips.
- Converge prototype (`?prototype=converge`): an agent pulls alternatives into one synthesis card with a derived-from arrow from each source; the synthesis shows as stale when a source changes.
- Browser object interface: `window.paired.read()`, `create(input)`, `update(input)`, `select(ids)`, `undo()` and `redo()`.

Local HTTP and MCP access are implemented; see [AGENT_API.md](AGENT_API.md). The resident agent above is the built-in assistant for local use; on paired.cc it answers only for allowlisted accounts. Updates require `expectedRevision`; stale updates and updates to locked objects are rejected. Agents and humans use the same tldraw store and history.

## Checks

```sh
pnpm build:canvas   # from the repository root: type check and production build
pnpm test:canvas    # unit tests, including a check that AGENT_API.md documents every tool
```

`tools/verify-compare.mjs <screenshot dir> [origin]` checks Side by side on two pasted records (alignment, order kept, one undo).

`tools/verify-import.mjs <screenshot dir> [origin]` checks import and paste the same way (a pasted review as ten record clusters, the stepper, undo, pick / cross out / comment, the ask context, a numeric table, a markdown file, an image drop, the agent operation) against a dev server of this checkout, with the synthetic fixtures in `test/fixtures/`.

`tools/verify-calm.mjs` drives a fresh browser profile through the whole loop (first load, long text in a card, plain text, a comment and a 300-word paste, an ask answered by the resident agent, the no-agent state, pick, cross out, comment, the queue, reload, an older saved board) and saves screenshots. Playwright is not a dependency here; run it from a directory where it is installed:

```sh
cd /some/dir/with/playwright && node /path/to/packages/canvas/tools/verify-calm.mjs /tmp/shots
```

Live checks against a running dev server are listed at the end of [AGENT_API.md](AGENT_API.md).

Browser checks performed 17 Nov 2026: native object dragging, pen drawing, text editing, inspector width/color edits, pan/zoom controls, keyboard undo, revision-aware object operations, stale-write rejection, local reload persistence, export and re-import of the exported document. The 390px layout was checked for horizontal overflow. No quantified latency or frame-rate benchmark was run.

## Sprint scorecard

`pnpm eval:canvas` (from the repository root) starts its own dev server on port 5191, drives headless Chromium and a real stdio MCP client, and writes `eval/scorecard.json` plus the scorecard table in `SPRINT-REPORT.md`:

- **Acceptance**: the working spec's first scenario step by step; the person clicks, types and drops files in the page, the agent uses MCP. Expected values are computed from the fixture, not read back from the canvas.
- **Ask loop**: the calm canvas's core loop. The person writes a thought and asks about it with the keyboard; an MCP agent finds it with `canvas_asks`, reports progress and answers with `canvas_answer`. Each step checks what the page shows: waiting with a way to an answer, working with the agent's note, answered with its name, the answer cards beside the ask with their text inside them, and a failed ask with Retry. No resident agent or model runs.
- **Safety**: stale agent write against a newer human edit, agent undo (`canvas_undo_run`) with interleaved human edits, agent writes to a locked object, and restoring an earlier version in a tab that has not seen another browser's newer save (the restore must be refused); counts human edits lost.
- **Persistence**: a board saved in one browser profile, compared through `read` in a clean profile.
- **Performance**: load time and median pan frame time at 1k and 10k objects, compared with the previous scorecard (more than 25% slower is flagged). The pan figure is the median of five 120-frame samples after a discarded warm-up (`EVAL_PAN_SAMPLES` changes the count), and each sample's median is kept in the scorecard, because one sample can swing by 2x on a busy machine. Boards are built with the editor directly through `window.__pairedEditor`, which only development builds expose.
- **Agent usability**: tasks in `eval/tasks/` with machine-checked end states; the script reports the latest recorded attempt (`eval/agent-runs/latest.json`) and never calls a model.
- **Existing product**: `pnpm build` and `pnpm -r --no-bail test`, per package. The e2e suite gets `DATABASE_URL` and `REDIS_URL` from the environment when both are set; otherwise the eval starts throwaway Postgres and Redis when `initdb`, `pg_ctl`, `createdb` and `redis-server` are installed (as `nobody` when run as root), and deletes them afterwards. Without either, the row says the suite had no database (`eval/services.ts`).

`--only=acceptance,askLoop,safety,…` runs a subset and carries the other measures over from the previous scorecard, labelled as such. `--no-write` prints without writing. `EVAL_URL` reuses a running dev server; `CHROMIUM_PATH` points at a browser if Playwright has none installed.

## Scope and limitations

This first pass adopts familiar canvas primitives and interactions. It does not reproduce Paper's CSS-flex layout system, shaders, component system or HTML/React export. Interactive data widgets exist only as the flagged data prototype (one bar chart type). The local agent transport is implemented.

The server now has a per-account board API (`/api/canvas/boards`, `packages/server/src/canvas/boards`). It saves the tldraw document with a revision number, rejects a save on a stale revision with 409 and the current revision, keeps the last 50 revisions, and is covered by tests against memory and a real Postgres (`TEST_DATABASE_URL`). Limits: 10 MB per board (413), and 50 boards per account (`MAX_BOARDS_PER_ACCOUNT`): creating one more is refused with 403 and the limit, while saving an existing board is never limited. Board sync (above) uses it. The development server's file store keeps one local person's boards and has no board limit.

The prototype stores work in the current browser profile. Export a file to move work between profiles or devices. Boards are not stored on a server and there is no multiplayer backend; hosted agent access (`https://paired.cc/mcp`) relays commands to a signed-in open tab. tldraw development use works locally; production use requires an appropriate tldraw license. No production deployment was made.

## Agent workflow

Open **Connect an agent** in the menu for the MCP configuration for this tab. The 32 tools include the Ask loop (asks, ask status, answer), import of a table or document as cards, an overview read, the feedback queue (read and reply), four prototype data tools (dataset, chart, chart state, cell), a prototype learning prompt, a prototype converge tool, scene composition, nested frames, grouping, layout and duplication, per-operation undo, targeted feedback and image operations. The **Agent studio** page is a scripted SVG demonstration. Integration checks cover the real HTTP/browser bridge and MCP stdio protocol. Locally the API runs in the development server. On paired.cc, Connect an agent shows a one-line command per client and the hosted endpoint forwards to the signed-in tab.

## Migration compatibility

Moved from Picabird on 17 Nov 2026. Browser persistence and session-storage keys intentionally retain their old names so existing localhost:5183 canvases remain available. The MCP process now uses `PAIRED_SESSION` / `PAIRED_URL`; copy fresh configuration from Agent access. This package is local-only; paired.cc’s document service and public routing are unchanged.
