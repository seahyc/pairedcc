# Canvas sprint report, 27 Nov to 3 Dec 2026

Last updated 2026-11-26T11:00Z by the review lane. Branch: `claude/sprint-int`.

## Read first
- **The calm-canvas rework (#21) is merged, combined by the review lane with 16 sprint PRs.** It
  conflicted in 15 files (21 places in `packages/canvas/src/App.tsx`). Where the two disagreed the
  calm layout won; board sync, the prototypes, per-run undo and the reload fixes were fitted into
  it. `App.tsx` and its `mount` function are the first thing to read, and the first screen is the
  first thing to look at. What the review could and could not show:
  - Checked by script: the first board holds three things, panels are behind the menu, text wraps
    in cards, plain text, comments and a 300-word paste, an ask shows working then answered, pick
    and cross out work, reload keeps everything (33 of 33 checks; the four no-agent checks need
    the macOS service and were skipped).
  - **No real model answered an ask.** The resident agent calls the local Claude Code CLI; the
    sprint does not spend on models, so a stand-in returned a fixed reply.
  - With `?prototype=data` or `?prototype=learning`, the prototype page button is now under Menu,
    then Show layers and pages.
  - Whether it is calm and usable is for the second playtest. Items 3, 5 and 6 of playtest 1 are
    ticked as mechanically addressed; 1, 2, 4 and 7 are left open for that judgment.
- **#15 changes how every signed-in board is saved, and is the merge most worth reading**
  (`packages/canvas/src/board-sync.ts`). The board is uploaded to the account 1.2 s after each
  change and a clean browser opens the account's board. Review found and fixed two defects before
  merging: a browser with unsaved edits replaced the account's newer board wholesale, and opening
  the board in a clean browser added about five stray welcome cards to it each time. What is still
  open:
  - **Not tested in a browser against the real server.** A production canvas build needs a tldraw
    licence key, which the sprint environment does not have. The review checked the real server
    through its API instead (session cookie, a real 110-record board saved and read back identical,
    another account gets 404). The browser path was exercised only against the development board
    store.
  - Where two tabs change the same object, the saving tab wins silently and the other version
    survives only in the board's last 50 revisions. With a save after every pause in editing, 50
    revisions is a few minutes of work. There is no screen for history.
  - A browser's work that cannot be merged is saved as a separate board (`main-browser-<time>`)
    and the account's board opens in its place. The only sign is the save chip's tooltip, and no
    screen lists those boards (backlog 19). Nothing is deleted, but the person cannot reach it.
  - A board over 10 MB (a few pasted images) is refused by the server; the chip then says
    "Offline" and retries indefinitely.
  - The development server now writes boards to `packages/canvas/.local/boards`, including the
    local `com.paired.canvas.dev` service, so two local browsers share one board.
- **#12 adds migration `007_canvas_boards.sql`, which the server applies on start.** Merging this
  branch towards `main` would create two tables in production on the next deploy. There is no
  limit on boards per account (10 MB per board, 50 revisions each).
- **The Persistence row passes against the development board store, with no sign-in involved.** It
  shows the canvas side works; it does not show boards saved on the real server from a browser.
- **A page may now hold 20,000 objects (#14).** With #16 a 10k board opens in about 9 s (was 25 to
  38 s). Panning with all 10k on screen is still 40 to 90 ms a frame; that time is in tldraw's own
  rendering.
- **Root `pnpm build && pnpm test` is green when Postgres, Redis and `JWT_SECRET` are provided**
  (#19; verified against Postgres 16 and Redis). Without them the e2e suite stops with a message
  naming the missing variable, so the scorecard's "Existing product" row reads fail in the sprint
  environment.
- **#17 changes how every card sizes itself**: a card waits for the board's fonts before measuring.
  The review typed a long note into a new card and it grew to fit with no overflow, but this is
  the area the playtest complained about, so it is worth a look by eye.
- **An agent can no longer place prototype objects on a default board (#20).** The tools are still
  listed to every agent (`hostedPrototypeTools`, #13) and refuse with a message naming the flag.
- Earlier points that still hold: #7 changes every board and was not from a sprint lane; per-run
  agent undo (#5) writes store records directly and its known gaps are backlog 11; agent operations
  of the data and learning prototypes are proven by headless scripts, not `pnpm test` (backlog 9).

## Status
`pnpm build` passes. `pnpm -r --no-bail test` on `16ce025`:

| Package | Result |
|---|---|
| canvas | 150 passed |
| server | 129 passed, 7 skipped (the Postgres board suite; 19 of 19 pass with `TEST_DATABASE_URL` set) |
| sdk | 12 passed |
| mcp-server | 4 passed |
| cli, web | no test files |
| e2e | needs Postgres and Redis; 1 passed when they are provided, otherwise stops at start |

<!-- scorecard:start -->
Scorecard from `pnpm eval:canvas` at 2026-11-26T11:17Z on `89daf62`:

| Measure | Target | Result | Status |
|---|---|---|---|
| Acceptance scenario | every step passes | 10/10 steps | pass |
| Agent usability | ≥90% of ≥20 tasks | 0 tasks, no recorded attempt | not run |
| Safety of shared edits | 0 human edits lost | 0 lost; 3/3 races pass | pass |
| Persistence | identical in a clean profile | identical | pass |
| Performance | reported, not worse | 1k: load 1371 ms, pan 16.7 ms/frame; 10k: load 7575 ms, pan 38.4 ms/frame | reported |
| Existing product | green | build passes; tests: e2e failing | fail |
<!-- scorecard:end -->

The acceptance scenario passes all ten steps, driven by a person in the page and an agent over
MCP. Agent usability has no tasks yet (backlog 18, claimed).

## Merged
- [#2](https://github.com/seahyc/pairedcc/pull/2) Dataset and chart state model (9f19690).
- [#3](https://github.com/seahyc/pairedcc/pull/3) Dataset and chart objects behind `?prototype=data` (68d7ff3).
- [#4](https://github.com/seahyc/pairedcc/pull/4) Prototype agent tools for datasets and charts (ff68adc).
- [#5](https://github.com/seahyc/pairedcc/pull/5) `canvas_overview` and per-run undo for agents (f47a23f). Review fixed undo writing to a locked object.
- [#6](https://github.com/seahyc/pairedcc/pull/6) Learning prompts prototype behind `?prototype=learning` (e83c517).
- [#7](https://github.com/seahyc/pairedcc/pull/7) Feedback queue, status chips and usability audit, from `yc/heuristics-pass` (6c68d68).
- [#8](https://github.com/seahyc/pairedcc/pull/8) `pnpm eval:canvas` and the baseline scorecard (6f4f3fb). Scorecard reproduced exactly.
- [#9](https://github.com/seahyc/pairedcc/pull/9) AGENT_API, README and spec describe the data prototype; a test fails on any undocumented tool, operation or field (e357f71).
- [#10](https://github.com/seahyc/pairedcc/pull/10) The development Agent access dialog fills in the checkout's own paths instead of one machine's (f7483a9).
- [#11](https://github.com/seahyc/pairedcc/pull/11) A note derived from a chart goes stale when the chart's dataset changes; `read` names the upstream cause (4e4c9b7). Acceptance 7 to 8.
- [#12](https://github.com/seahyc/pairedcc/pull/12) Server board storage per account: `/api/canvas/boards`, revisions, stale saves rejected with 409, migration 007 (204980a).
- [#13](https://github.com/seahyc/pairedcc/pull/13) `hostedPrototypeTools` switch; default unchanged, manifest byte-identical (054ab83).
- [#14](https://github.com/seahyc/pairedcc/pull/14) Per-page limit raised from 4,000 to 20,000 so 10k can be measured (3a4a85f).
- [#15](https://github.com/seahyc/pairedcc/pull/15) The canvas keeps its board saved to the account and merges by object on a stale save (8708875). Review fixed the two defects described above.
- [#16](https://github.com/seahyc/pairedcc/pull/16) The layers panel and rich-text reading no longer scale quadratically; a 10k board opens in about 9 s (af63474). The claimed pan improvement did not reproduce; pan time varies run to run.
- [#17](https://github.com/seahyc/pairedcc/pull/17) Reload leaves saved objects unchanged: no height re-estimate, and a card's auto-sized height does not bump its revision (c6b5849).
- [#18](https://github.com/seahyc/pairedcc/pull/18) Dropping a CSV on the data prototype creates a typed dataset, or nothing with a message naming the row and column (f104315).
- [#19](https://github.com/seahyc/pairedcc/pull/19) The document collaboration e2e test signs in for real and passes; services documented in `e2e/README.md` (a4b927e).
- [#20](https://github.com/seahyc/pairedcc/pull/20) Prototype agent operations are refused in a tab without the prototype flag (be3dce9).
- [#21](https://github.com/seahyc/pairedcc/pull/21) Calm canvas from `yc/calm-canvas`: one Ask loop, a resident agent, text that wraps, panels behind one menu (16ce025, squashed locally with the conflicts resolved; shows as closed, not merged). Review made board sync check the board list before fetching, so a first open no longer logs a 404.
- Review lane: `packages/cli` and `packages/web` test scripts pass with no test files (a712b50).

How each was checked: the branch was merged with the integration branch, built and tested; every
`## Proof` claim was re-run (before and after test counts, the scorecard rows, each live headless
script, #12 against a real local Postgres 16 and the running server). From #8 on, PRs are merged
through GitHub and show as merged; #2 to #7 show as closed because they were squashed locally.

## Rejected
None.

## Decisions needed
1. **Board conflicts.** Different objects merge; the same object: the saving tab wins, the other
   stays in history. Unmergeable versions: both kept, as separate boards. Alternative: show both
   and ask.
2. **One board per account** (`main`). A board picker and revision history (backlog 19) decide
   whether the separate boards above are reachable.
3. **Storage limits.** 10 MB per board, 50 revisions, no cap per account. Images count against
   the 10 MB.
4. **Development server stores boards on disk** and shares them between local browsers. Alternative:
   only when `PAIRED_BOARDS_DIR` is set.
5. **20,000 objects per page.** Alternative: keep 4,000 until large boards are fast. Related: cull or
   simplify when zoomed far out, and summarise the layers panel instead of one row per object.
6. **Prototype tools on the hosted endpoint.** Now one constant, `hostedPrototypeTools`, left on.
   The new brief says prototypes that add noise belong behind flags; turning this off is the
   matching choice for agents.
7. **Stale chart on interaction.** Filtering a stale chart recomputes it. Alternative: keep the old
   snapshot until Recompute.
8. **Agent undo semantics.** Per run, all-or-nothing, shares the person's undo history.
9. **Who may hide what in learning mode.** An agent can hide the person's own objects behind a prompt.
10. **Workspace test gate.** Whether `pnpm test` includes e2e, which needs Postgres, Redis and `JWT_SECRET`.
11. **CSV number columns.** Any all-numeric column becomes numbers, so codes like `007` lose their
    zeros. Alternative: stricter rule, or let the person set the type.
12. **Document sharing wording** (found by #19, outside canvas scope): a new document says "anyone
    with this link can edit", but another signed-in user gets 404 until invited through Share.

## Not yet covered
Open and not yet reviewed: #22 (shared-edit gaps), #23 (primitives), #24 (agent-usability tasks),
#25 (data agent tests) and later ones. They were written against the old layout and need re-checking
on the calm canvas. Not started: converge (5), board picker (19). Claimed without a PR: foundational primitives
(3), robustness (7), data agent tests (9), agent-usability tasks (18). PR descriptions #9 to #20
carry a tool footer written before the brief ruled it out; commits do not.
