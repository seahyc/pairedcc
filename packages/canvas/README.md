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
- Frames, rectangles, ellipses, freehand paths, rich text, notes, arrows and image import. Imported images are kept inside the board (photos over 1.5 MB are scaled to 2048 px), so a board saved to an account opens with its images in a clean browser; images added before this lived only in that browser and move into the board the next time it opens there.
- Pages, nested layers, collapse/expand, multiselection, alignment/grouping and object properties.
- Undo/redo, keyboard tool shortcuts and duplicate/delete.
- The loop works without a pointer: N then Enter writes a card in view, clear of everything else; Tab and Shift+Tab move through the board one object at a time in reading order (connectors and hidden objects are skipped, and each stop is brought into view), and the board never traps the keyboard: Tab past either end, or Shift+Tab with nothing selected, moves on to the menu, agent chip and tools; ⌘/Ctrl+Enter, P, X and C act on it. Checked by `tools/verify-keyboard.mjs`.
- A screen reader hears each selection once, in a polite live region that is never seen: who made it, its text, its kind (thought, ask with its state, answer, comment), picked or crossed out, and its place in the Tab order. Checked by `tools/verify-heard.mjs`.
- The Menu and More tools menus follow the menu pattern (the first item takes focus, arrows, Home and End move, Escape returns to the button and keeps the board's selection), and each dialog takes focus when it opens, keeps Tab inside, closes on Escape and gives focus back. See `src/focus-keys.ts`; checked by `tools/verify-menu-keys.mjs`.
- With one failed or unheard ask selected, the selection bar's first button is Retry (or Send again) and ⌘/Ctrl+Enter sends the ask again as a new attempt instead of asking about it. Checked by `tools/verify-retry-key.mjs`.
- Local IndexedDB persistence, JSON file export and validated import.
- Board sync: the board is also saved to the signed-in account (`/api/canvas/boards`) a moment after each change, and a clean browser opens it. A save on a stale revision merges by object with the newer version (an edit beats a deletion; where both changed one object this tab wins and the other stays in the board's history). The first sign-in moves the browser's board up. When a browser holds work the account does not and the two cannot be merged (its own earlier board, or unsaved edits while the account's board changed elsewhere), that work is saved as a separate board and the account's board is opened; one whole board never replaces another. Menu → Saved boards (shown only when there is more than one) opens such a board, and Menu → Earlier versions restores one of the board's kept revisions as the newest, without losing the current one (`src/history-dialog.tsx`). The development server keeps boards for one local person in `.local/boards` (`PAIRED_BOARDS_DIR`). See `src/board-sync.ts`. To use the real server and its accounts instead, start the dev canvas with `PAIRED_SERVER_URL=http://localhost:3000` (sign-in and boards are proxied there); `pnpm --filter @pairedcc/canvas verify:sync-server` starts both against throwaway Postgres and Redis and checks sign-in, save, a clean browser on the same account and isolation from another account (see the header of `tools/verify-board-sync-server.ts`).
- Scratchbook visual language: pink handwriting and ink for the human, lavender ✦ cards and violet arrows for agents, pick (P) and reject (X) marks, captions, and an open-marks counter. See AGENT_API.md.
- Feedback queue: C comments on the selection or pins a comment under the pointer; comments, picks, rejects and ink over objects form one queue across pages. The Feedback tab lists it (jump, resolve, reopen, export as Markdown or JSON). Agents read it with `feedback`, answer with `reply` and close with `resolve`. `pnpm --filter @pairedcc/canvas feedback` prints it from the open tab.
- Live save state, an agent status chip (last action, failures, lost link) and a shortcut sheet on `?`. The audit behind these is `docs/canvas/usability-heuristics.md`.
- Data prototype (`?prototype=data`, then **Data prototype page**, or drop a `.csv` file on the canvas): a dataset table with editable cells, a bar chart over it filtered and selected by clicking, exact chart state readable by agents, and stale marking (dashed chart with Recompute, a "stale" flag on derived notes) when an input changes. Synthetic data only.
- Check me (on every board, shown only on an agent's answer): **Check me** on the selection bar, or E, puts the answer away behind a prompt beside it that asks the person to explain it from memory; when they commit (or skip) the answer comes back beside what they wrote, to compare. One undo takes it back (Ctrl/⌘+Z in the still-empty box works too); the answer stays readable to agents, with `meta.revealAfter` naming the prompt. `src/learning/check.ts`; `tools/verify-check-me.mjs <screenshot dir>` checks it in a real tab against a dev server of this checkout.
- Suggestions on the board (every board, shown only on a pause): when the person stays on a selection of their own material (a thought, several thoughts, a frame, a chart or dataset, an imported record) for a moment, at most two faint handwritten suggestions appear under it, or beside it when something is under it, chosen by `startersFor`: by kind, and for one thought by what its words invite first (a reason → the strongest objection, a number → where it comes from, a proposal → what would make it wrong, a list → which matters most, a short abstract claim → a concrete example; `textCue`, English cue words), then the usual next step. They never cover an object or the selection bar, never appear on an agent's card, an ask, a comment or an untouched first-board card, and never while typing. Any other action makes them go, and the same selection is not offered them again. Clicking one writes it as the person's own pink card in that place, sent as an ask; one undo takes it back. `src/suggest.ts`, `src/suggest-ui.tsx`; `tools/verify-p4-suggest.mjs <screenshot dir>` checks it in a real tab, `tools/verify-suggest-cues.mjs` the cues.
- Learning prototype (`?prototype=learning`, then **Learning prototype page**): predict-then-check and generate-first prompt cards that hide a result until the person answers or skips.
- Context prototype (`?prototype=context`): **Leave out** on the selection bar (or L) keeps an object out of what asks give an agent; the board shows it as "left out of asks", and the ask says how many were withheld. Selecting a left-out object and asking about it still gives it. **Pin** (or I) does the opposite: every ask on that page gives the pinned object, selected or not (up to six, in reading order); the board fences it in lavender as "pinned · given to every ask", the ask outlines it with the rest of its context and says "+ N pinned". Pin and Leave out exclude each other.
- Converge prototype (`?prototype=converge`): an agent pulls alternatives into one synthesis card with a derived-from arrow from each source; the synthesis shows as stale when a source changes.
- Browser object interface: `window.paired.read()`, `create(input)`, `update(input)`, `select(ids)`, `undo()` and `redo()`.

Local HTTP and MCP access are implemented; see [AGENT_API.md](AGENT_API.md). The resident agent above is the built-in assistant for local use; on paired.cc it answers only for allowlisted accounts. Updates require `expectedRevision`; stale updates and updates to locked objects are rejected. Agents and humans use the same tldraw store and history.

## Checks

```sh
pnpm build:canvas   # from the repository root: type check and production build
pnpm test:canvas    # unit tests, including a check that AGENT_API.md documents every tool
```

`tools/verify-pdf.mjs <screenshot dir> [origin]` checks a PDF (`test/fixtures/notes.pdf`, the synthetic notes printed by Chromium with `test/fixtures/build-pdf.cjs`).

`tools/verify-cite.mjs <screenshot dir> [origin]` checks bringing cited sections beside a record (the synthetic `test/fixtures/pack.md` is the document the review cites).

`tools/verify-compare.mjs <screenshot dir> [origin]` checks Side by side on two pasted records (alignment, order kept, one undo).

`tools/verify-webpage.mjs <screenshot dir> [origin]` checks a saved web page and a stretch copied from one.

`tools/verify-csv-faithful.mjs <screenshot dir> [origin]` checks that a CSV dropped on the data prototype keeps what the file says: a non-UTF-8 file is refused with a fix, long IDs stay text, a quoted empty value keeps its row.

`tools/verify-import.mjs <screenshot dir> [origin]` checks import and paste the same way (a pasted review as ten record clusters, the stepper, undo, pick / cross out / comment, the ask context, a numeric table, a markdown file, an image drop, the agent operation) against a dev server of this checkout, with the synthetic fixtures in `test/fixtures/`.

`tools/verify-calm.mjs` drives a fresh browser profile through the whole loop (first load, long text in a card, plain text, a comment and a 300-word paste, an ask answered by the resident agent, the no-agent state, pick, cross out, comment, the queue, reload, an older saved board) and saves screenshots. Playwright is not a dependency here; run it from a directory where it is installed:

```sh
cd /some/dir/with/playwright && node /path/to/packages/canvas/tools/verify-calm.mjs /tmp/shots
```

`tools/verify-answer-beside.mjs <screenshot dir>`, run the same way, starts its own dev server and checks that three asks about one card, answered out of order, each keep their answer next to them (under, or beside when the space under is taken by the next ask) with nothing overlapping, and that a lone ask still gets its answer underneath.

`tools/verify-early-agent.mjs <screenshot dir>`, run the same way, starts its own dev server with an empty board store and checks that an agent acting before the calm first board is laid out (it waits up to 2.5 s for fonts) keeps its page open and its objects readable, while the calm board is laid out on a page of its own; an untouched new board still opens the calm board on its only page.

Each change of an ask's state (sent, taken by an agent with its note, answered with how many options, failed with Retry) is said once in a polite live region for screen readers; the state lines themselves tick each second and are not live. `tools/verify-ask-live.mjs <screenshot dir>`, run the same way, starts its own dev server and checks it with an agent over HTTP.

`tools/verify-contain.mjs <screenshot dir>` is run the same way and needs no agent. At 1440 and 390 px it checks that a long URL, a long unbroken word, a code note and plain text stay inside their shapes, that the selection bar and the Ask box (send button included) sit inside the window wherever the selection is, and that an ask's state line wraps under its card rather than running off screen.

Key hints are written with Apple's symbols and shown in the person's own keys (`src/keys.ts`): Ctrl, Shift and Backspace on Windows, Linux and Android, ⌘ ⇧ ⌫ on Apple devices. `tools/verify-keys.mjs <screenshot dir>`, run the same way, starts its own dev server with an empty board store and checks the first board, the selection bar, the typing hint, the Ask tooltips and the shortcut sheet as a Windows and as a Mac browser.

`tools/verify-answer-view.mjs <screenshot dir>`, run the same way, starts its own dev server with an empty board store and checks at 1440 and 390 px that an agent's four options and a one-card answer land wholly in the window (options wrap into rows on a phone), without changing the zoom, and that an answer arriving while the person types elsewhere leaves their view alone.

On a touch screen with no mouse or trackpad (`(hover: none) and (pointer: coarse)` without `(any-pointer: fine)`), nothing names a key: the first board says to double-tap or tap Write, and to tap ✦ Ask; the selection bar drops its key caps; and while a card is being written the hint is a button, "✦ Ask about this". `tools/verify-touch.mjs <screenshot dir>` checks that as an Android phone, and that a desktop is unchanged.

`tools/verify-import-author.mjs` (run from a directory with Playwright; starts its own dev server) checks that an agent may correct cards it imported over `canvas_import`, which carry its name as `createdBy`, while cards the person pasted stay protected from agent rewrites.
**All browser checks at once:** `pnpm --filter @pairedcc/canvas verify:all <out dir> [--only=calm,runs]` (or `node tools/verify-all.mjs <out dir>` from a directory where Playwright is installed) runs every `tools/verify-*` check that needs no model, paid API or external service. It starts a dev server on :5183 with a throwaway board store emptied before each check, opens a canvas tab for checks that drive an open tab, and runs the resident agent with a stand-in for the model (a fixed reply after 3 s) for the calm loop. It prints a pass/fail table, writes `<out dir>/summary.json` and one log per check, names any `verify-*` file it does not know, and exits non-zero on a failure. The real-server sync check (Postgres and Redis) and the two-step legacy image modes are listed as skipped. Run it after merging.

Live checks against a running dev server are listed at the end of [AGENT_API.md](AGENT_API.md).

Browser checks performed 17 Nov 2026: native object dragging, pen drawing, text editing, inspector width/color edits, pan/zoom controls, keyboard undo, revision-aware object operations, stale-write rejection, local reload persistence, export and re-import of the exported document. The 390px layout was checked for horizontal overflow. No quantified latency or frame-rate benchmark was run.

## Sprint scorecard

`pnpm eval:canvas` (from the repository root) starts its own dev server on port 5191, drives headless Chromium and a real stdio MCP client, and writes `eval/scorecard.json` plus the scorecard table in `SPRINT-REPORT.md`:

- **Acceptance**: the working spec's first scenario step by step; the person clicks, types and drops files in the page, the agent uses MCP. Expected values are computed from the fixture, not read back from the canvas.
- **Ask loop**: the calm canvas's core loop. The person writes a thought and asks about it with the keyboard; an MCP agent finds it with `canvas_asks`, reports progress and answers with `canvas_answer`. Each step checks what the page shows: waiting with a way to an answer, working with the agent's note, answered with its name, the answer cards beside the ask with their text inside them, and a failed ask with Retry. No resident agent or model runs.
- **Safety**: stale agent write against a newer human edit, agent undo (`canvas_undo_run`) with interleaved human edits, agent writes to a locked object, and restoring an earlier version in a tab that has not seen another browser's newer save (the restore must be refused); counts human edits lost.
- **Persistence**: a board saved in one browser profile, compared through `read` in a clean profile.
- **Performance**: load time and median pan frame time at 1k and 10k objects, compared with the previous scorecard (more than 25% slower is flagged). The pan figure is the lower quartile of twelve 40-frame samples' medians after a discarded warm-up (`EVAL_PAN_SAMPLES` and `EVAL_PAN_FRAMES` change them), and each sample's median and the method are kept in the scorecard: on a busy machine a sample is either fast or about twice as slow, in runs, and the lower quartile reads the fast mode whenever a quarter of the samples land there. Boards are built with the editor directly through `window.__pairedEditor`, which only development builds expose.
- **Agent usability**: tasks in `eval/tasks/` with machine-checked end states; the script reports the latest recorded attempt (`eval/agent-runs/latest.json`) and never calls a model.
- **Existing product**: `pnpm build` and `pnpm -r --no-bail test`, per package. The e2e suite gets `DATABASE_URL` and `REDIS_URL` from the environment when both are set; otherwise the eval starts throwaway Postgres and Redis when `initdb`, `pg_ctl`, `createdb` and `redis-server` are installed (as `nobody` when run as root), and deletes them afterwards. Without either, the row says the suite had no database (`eval/services.ts`).

`--only=acceptance,askLoop,safety,…` runs a subset and carries the other measures over from the previous scorecard, labelled as such. `--no-write` prints without writing. `EVAL_URL` reuses a running dev server; `CHROMIUM_PATH` points at a browser if Playwright has none installed.

## Scope and limitations

This first pass adopts familiar canvas primitives and interactions. It does not reproduce Paper's CSS-flex layout system, shaders, component system or HTML/React export. Interactive data widgets exist only as the flagged data prototype (one bar chart type). The local agent transport is implemented.

The server now has a per-account board API (`/api/canvas/boards`, `packages/server/src/canvas/boards`). It saves the tldraw document with a revision number, rejects a save on a stale revision with 409 and the current revision, keeps the newest 20 revisions and then one per 15 minutes of older work (50 at most, so history reaches back hours rather than minutes), and is covered by tests against memory and a real Postgres (`TEST_DATABASE_URL`). Limits: 10 MB per board (413), and 50 boards per account (`MAX_BOARDS_PER_ACCOUNT`): creating one more is refused with 403 and the limit, while saving an existing board is never limited. Board sync (above) uses it. The development server's file store keeps one local person's boards and has no board limit.

The prototype stores work in the current browser profile. Export a file to move work between profiles or devices. Boards are not stored on a server and there is no multiplayer backend; hosted agent access (`https://paired.cc/mcp`) relays commands to a signed-in open tab. tldraw development use works locally; production use requires an appropriate tldraw license. No production deployment was made.

## Agent workflow

Open **Connect an agent** in the menu for the MCP configuration for this tab. The 32 tools include the Ask loop (asks, ask status, answer), import of a table or document as cards, an overview read, the feedback queue (read and reply), four prototype data tools (dataset, chart, chart state, cell), a prototype learning prompt, a prototype converge tool, scene composition, nested frames, grouping, layout and duplication, per-operation undo, targeted feedback and image operations. The **Agent studio** page is a scripted SVG demonstration. Integration checks cover the real HTTP/browser bridge and MCP stdio protocol. Locally the API runs in the development server. On paired.cc, Connect an agent shows a one-line command per client and the hosted endpoint forwards to the signed-in tab.

## Migration compatibility

Moved from Picabird on 17 Nov 2026. Browser persistence and session-storage keys intentionally retain their old names so existing localhost:5183 canvases remain available. The MCP process now uses `PAIRED_SESSION` / `PAIRED_URL`; copy fresh configuration from Agent access. This package is local-only; paired.cc’s document service and public routing are unchanged.
