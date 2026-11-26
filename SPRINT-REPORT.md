# Canvas sprint report, 27 Nov to 3 Dec 2026

Last updated 2026-11-26T10:45Z by the review lane. Branch: `claude/sprint-int`.

## Read first
- **Playtest 1 rejected the build** (`docs/canvas/feedback/2026-11-26-playtest-1.md`): hard to use,
  noisy, too open-ended, text overflows, no visible way to make the agent respond. Nothing merged so
  far answers it; the rework is on `yc/calm-canvas`, which has no PR yet. Everything below is
  plumbing (scorecard, storage, docs), not the experience.
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
- **A page may now hold 20,000 objects (#14), and 10k is slow**: 25 to 38 s to open and 40 to 100 ms
  a frame while panning, across four runs. #16 (open, not yet reviewed) addresses it.
- **Root `pnpm test` is still not green**: the e2e suite signs in with tokens the server never
  issues (backlog 10, claimed). Every other package passes.
- Earlier points that still hold: #7 changes every board and was not from a sprint lane; per-run
  agent undo (#5) writes store records directly and its known gaps are backlog 11; agent operations
  of the data and learning prototypes are proven by headless scripts, not `pnpm test` (backlog 9).

## Status
`pnpm build` passes. `pnpm -r --no-bail test` on `8708875`:

| Package | Result |
|---|---|
| canvas | 114 passed |
| server | 129 passed, 7 skipped (the Postgres board suite; 19 of 19 pass with `TEST_DATABASE_URL` set) |
| sdk | 12 passed |
| mcp-server | 4 passed |
| cli, web | no test files |
| e2e | fails, as before the sprint |

<!-- scorecard:start -->
Scorecard from `pnpm eval:canvas` at 2026-11-26T10:37Z on `8708875`:

| Measure | Target | Result | Status |
|---|---|---|---|
| Acceptance scenario | every step passes | 8/10 steps | fail |
| Agent usability | ≥90% of ≥20 tasks | 0 tasks, no recorded attempt | not run |
| Safety of shared edits | 0 human edits lost | 0 lost; 3/3 races pass | pass |
| Persistence | identical in a clean profile | identical | pass |
| Performance | reported, not worse | 1k: load 2745 ms, pan 16.7 ms/frame; 10k: load 33584 ms, pan 80.6 ms/frame | reported |
| Existing product | green | build passes; tests: e2e failing | fail |
<!-- scorecard:end -->

Acceptance is 8 of 10. The two failing steps are a person dropping a CSV (#18, open) and reload
changing card heights (#17, open). Agent usability has no tasks yet (backlog 17, claimed).

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
5. **20,000 objects per page.** Alternative: keep 4,000 until large boards are fast.
6. **Prototype tools on the hosted endpoint.** Now one constant, `hostedPrototypeTools`, left on.
   The new brief says prototypes that add noise belong behind flags; turning this off is the
   matching choice for agents.
7. **Stale chart on interaction.** Filtering a stale chart recomputes it. Alternative: keep the old
   snapshot until Recompute.
8. **Agent undo semantics.** Per run, all-or-nothing, shares the person's undo history.
9. **Who may hide what in learning mode.** An agent can hide the person's own objects behind a prompt.
10. **Workspace test gate.** Whether `pnpm test` includes e2e, which needs Postgres, Redis and `JWT_SECRET`.

## Not yet covered
Open and not yet reviewed: #16 (10k speed), #17 (reload stability), #18 (CSV drop). Not started:
foundational primitives (3), converge (5), board picker (19). Claimed without a PR: robustness (7),
agent-usability tasks (17), e2e repair (10). PR descriptions #9 to #15 carry a tool footer written
before the brief ruled it out; commits do not.
