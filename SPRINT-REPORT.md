# Canvas sprint report, 27 Nov to 3 Dec 2026

Last updated 2026-11-27T14:40Z by the review lane. Branch: `claude/sprint-int`.

## Read first (27 Nov, 14:40Z)
- **Released again (the day's second release)**: everything up to #173, pushed to `claude/release` at about 14:40Z. That covers P4 suggestions (#156) and the work below. The deploy status is read on the next run.
- **What you will notice:** when the agent offers options, each lettered card can now list the same dimensions in the same order (for example "Cost to try", "Risk"), with the names in bold (#165). The overview and an ask now name a pile of cards after its title, never after the question in it (#169). On a phone the overview fits the screen (#166). Suggestions behave better on phones: a swipe no longer sends one, and on a narrow screen one suggestion is shown rather than none (#171).
- **A product choice made for you:** two lanes built "options on dimensions" at the same time. I merged #165 (the dimensions sit inside the option cards, so nothing new appears on the board) and closed #168 (a separate table under the options). If you would rather have the table, #168's branch still exists.
- **Checks on `65e7d79`:** full workspace green with Postgres 16 and Redis (server 160, canvas 755, sdk 12, mcp 4, e2e 1); headless browser suite 75/75.
- Open: item 127 (making the dimension lines line up across cards when headlines wrap differently) is back in the backlog after its claim lapsed with no PR.

## Earlier (27 Nov, 02:30Z)
- **Four of the five P-items are live on paired.cc** (`7013ae3`, pushed 01:32Z, deploy status
  `success`, live 01:38Z). **P4 (suggestions) is merged** (#156) and goes out with the next release. Behind no flag, nothing on the first
  screen changes (same PNG hash as before):
  - **P1 Fold** (#144): once you pick an answer (or settle the question) and move on, the thread
    folds to one line where the question was: the question, ✓ the pick, +N. Press it to unfold;
    Fold on its state line folds it back. **This applies to existing boards too**: every picked
    thread on a board folds the first time it loads.
  - **P1 Focus** (#145): select a frame or one thread, press F: the rest dims until Esc. With
    anything else selected, F is still the Frame tool (decision in `SPRINT.md`).
  - **P3 The whole board** (#146): O (or Menu → The whole board) shows the page's groups as boxes
    laid out as on the board, with open/settled counts; press one to fly there. **O is no longer
    the Ellipse key**; the Ellipse is under More without a key.
  - **P5 part 2** (#149): Check me (E) on a thought you settled covers it face down while you
    explain it, then uncovers it to compare. It then comes back as one quiet line at the bottom
    edge after 1, 3, 7 and 21 days (Later = tomorrow). Nothing appears unless you used it.
  - **P4 Suggestions** (#156, merged, not yet released): pause on a selection of your own writing
    and at most two faint handwritten suggestions appear under it ("What's missing?"); clicking one
    writes it as your pink card and asks. They go on any action and never cover anything.
- **Review fixes made inside PRs:** focus stayed armed after its frame/thread was deleted, so an undo
  brought the dimming back (#145); the overview left out folded threads, so a board of finished
  threads looked empty (#146). Both have a browser check that fails without the fix.
- **Browser checks: 39 of 55 pass on the released commit; the 16 failures are stale checks, not
  product faults.** Each one waits for the removed question box (`.selection-bar.asking`) or the
  removed starter chips; the same 16 fail on the previous release. Converting them is item 107
  (claimed). Two of their lines look like real small bugs worth a glance: the shortcut sheet says
  "⌘↵" on Windows (verify-keys), and an ask inside a frame near the page edge is reported off-page
  (verify-ask-unclipped). Both pre-date today and are filed as items 112 and 113, with fixes in PRs #154 and #155.
- **The scorecard is green on the merged code:** acceptance 10/10 (#148 fixed the lost first letter),
  ask loop 5/5, safety 11/11 races with 0 human edits lost. Workspace: server 160, canvas 649, sdk
  12, mcp 4, e2e 1, all passing with Postgres 16 and Redis.
- **Browser checks now all pass:** #153 rewrote the 16 stale checks to ask the new way, and #154/#155
  fixed what they then found (your own asks missing from the feedback queue, an empty question
  leaving its arrow, ⌘↵ shown on Windows, a card across a frame's edge cut off). verify-all on
  the combined code: 58/58.
- **Another session is merging PRs into `claude/sprint-int` alongside this review** (#157, #158,
  #160, #161, #164 were merged by it, and it pushed review commits onto #154 and #155). This run
  did not review those five; they pass the workspace tests and the browser suite on `0800e5c`.
  Worth knowing if you expected only one review lane.
- **This report fell behind:** #91 to #143 were merged and released (c6c406c, live 2026-11-26
  16:12Z) by earlier runs that did not update this file. They are now listed under Merged, one
  line each, without a fresh check from this run.
- PR descriptions still end with a tool footer that the hard rules forbid (added by the tool that
  opens them; squash commits on the branch do not carry it).

## Released
| Commit | Pushed | Deploy status | What it carried |
|---|---|---|---|
| `601800b` | 26 Nov (from your side) | live | First release |
| `c6c406c` | 26 Nov ~16:10Z | `success`, live on paired.cc 2026-11-26T16:12Z | Everything to #143: the card is the question, settled (S), Check me on answers, P2 arrangement |
| `7013ae3` | 27 Nov 01:32Z | `success`, live on paired.cc 2026-11-27T01:38Z | P1 fold and focus, P3 overview, P5 recall (#144 to #149) |
| the commit that adds this row (code as `65e7d79`) | 27 Nov ~14:40Z | pending (read on the next run) | P4 suggestions (#156), #157 to #173: options on dimensions, group names, overview phone fit, calm page ids, suggestion fixes, agent tasks 29 to 31 |

## Notes from the 26 Nov review (still relevant)
- **This run (11:55Z to 13:50Z): 52 PRs reviewed and merged, #40 to #90 and #96; none rejected.**
  Each was merged with the integration branch, then built and tested across the workspace
  (Postgres 16 and Redis running). Most had their browser or live check re-run by the review; the
  rest rest on unit tests the review read (the Merged list says which). On `20ccac9` six scorecard
  rows pass; Performance is flagged and is not a regression (below). What to look at first:
  - **A review mistake, found and repaired.** Merging #67 silently put back an older copy of four
    paragraphs of `AGENT_API.md` (the documentation #63 had added) and re-broke a table, because
    its branch carried an earlier resolution of that file. Merging #74 then #78 left two text
    filters in `read`. The first was restored by the review (b8e69de, 3cdc71b); the second was
    caught by a build lane and fixed in #96. Since then every merge is checked for lines it removes
    that the PR's own commits did not remove. A scan of all 46 merges found no other case, but
    `AGENT_API.md` and `packages/canvas/src/ask-ui.tsx` were touched by the most PRs and are worth
    a read.
  - **A second review mistake: #80 let the selection bar cover the selected card on a phone.** At
    390 px the bar wraps to two rows and sat on the top 30 px of the card, so a second tap hit a
    bar button (Cross out, Comment) instead of the card. #80's own 20 checks did not look for it;
    #87's check tripped over it. Fixed by the review inside #87: the bar is lifted by its measured
    height (`placeBar`, with a test; measured 508 to 588 above a card at 594).
  - **Two prototypes of proposed items are in, both behind flags and off by default:** leaving
    objects out of asks (`?prototype=context`, #90, key L) and asks about charts and datasets
    (data prototype, #86). A left-out mark already on a board is honoured and drawn in every tab;
    only setting it needs the flag. Decision 28.
  - **An answer now pans the view (#87)** when it lands while its ask is on screen and the person
    is not typing, dragging or asking. It never zooms. This moves the view without a click.
    Decision 29.
  - **Images now live inside the board (#76).** A dropped image is stored in the board as a data
    URL (photos over 1.5 MB scaled to 2048 px), so a clean browser shows it. The cost: every save
    uploads the whole board again, images included, about a second after each edit, and each kept
    revision holds a full copy. A board with two photos was 5.3 MB in the review's run. The
    alternative is a server asset store. Decision 23.
  - **PDF import is a small built-in reader (#73)**, not pdf.js. It reads text PDFs printed by a
    browser or word processor; PDFs that use compressed object streams (many modern ones) are
    refused with a message. Review added a guard: a damaged page tree could hang the tab.
    Decision 24.
  - **Board history is thinned on the server (#75):** newest 20 revisions, then one per 15-minute
    slot, 50 in all. This is server code and changes what "the other version stays in history"
    means for an edit overwritten more than 20 saves ago. Decision 25.
  - **An agent can answer an ask on a page that is not open (#69).** The answer is placed on the
    ask's page, off the person's undo stack, and a notice says who answered and where.
  - **Asks now carry more:** the contents of a selected frame (#67) and the person's picks and
    cross-outs (#64). Results hidden by a learning prompt are never sent.
  - **The selection bar and Ask box stay inside the window (#80)**, including on a 390 px phone,
    and key hints read Ctrl on Windows and Linux (#83). Both change what is on screen in the first
    two minutes; the first screen at rest is unchanged on a Mac.
  - **CSV typing on the data prototype is stricter (#68, #84):** zero-padded codes, long IDs and
    hex stay text. This takes the alternative in decision 11.
  - **Import and paste (#46) is on the branch**, from your `yc/import-paste`, with four follow-ups:
    side by side (#55), cited sections beside a record (#58), `.xlsx` (#60) and web pages (#65).
    It adds one menu item, "Import a file", and two buttons that appear on the selection bar only
    for imported records ("Side by side" with two records selected, "Show Q56, Q16" for a record
    that cites sections). The first screen is unchanged. Playtest item 8 is for you to judge.
  - **Where #46 met the starters work (#42), the review chose:** an imported record keeps your
    record starters ("Is this point valid?"); every other selection gets starters that fit it
    (several objects: compare; a question: answer it). Decision 17.
  - **Moving a card now moves its comments, notes and replies (#52)**, and connectors made by an
    agent re-pick their sides when an end moves (#48). #52 wraps the editor's `undo`, `redo` and
    `bail` to pause following while they run; that is the part to read (`App.tsx`, "replaying").
    Side by side and "Show cited" move records without selecting them first, so comments on those
    records stay behind (backlog 70).
  - **Board sync changed again in five places** (#50, #59, #61, #66 and the test in #45):
    `packages/canvas/src/board-sync.ts`. A restored board now survives an immediate reload (re-run
    in a browser: lost before, kept now); a snapshot loaded from the account is no longer an
    undoable edit; a restore clears undo history; half an emoji no longer fails a Postgres save.
    #66 also changes server code (`packages/server/src/canvas/boards/store.ts`): text is repaired
    before storing, and a board whose keys would collide after the repair is refused with 400.
  - **Agent-facing changes that an existing agent would notice:** read `marks` call a human
    comment `comment`, not `note` (#63); `canvas_duplicate` without offsets places the copy beside
    or below the originals, and refuses when neither fits inside their frame (#63); `canvas_overview`
    returns `clusters` and `locked` (#47, #63); asks carry `mark` and sibling options (#64).
  - **Performance: the scorecard's 10k pan figure is still not trustworthy.** #43 made it the
    median of five samples, but on this machine a sample is either about 38 ms or about 85 ms, and
    a run of mostly slow samples still reads as a regression. The review measured the commit before
    today's merges and the commit after, twice each: 38.4 and 45.3 ms before, 45.1 and 38.4 ms
    after, with slow samples in both. At the end of the run the container itself had slowed: the
    committed figure is 78.5 ms and reads "regressed" against an earlier lucky 49 ms, but `95a9daf`
    and `20ccac9` measured back to back gave 98.4 and 107.4 ms against 101 and 98.6 ms. Same code
    speed. Backlog 69 (PR #100 open).
  - **The recorded agent attempt is 23 of 24 and predates most of today's merges** (#57). Task 14
    failed because the agent's note named all four regions, not only the top one; the check was
    left strict. The 24-task self-test passes on the merged branch. No fresh attempt was recorded
    in this run.
- **PRs are still arriving: sixteen are open and not reviewed (#91 to #108, with gaps).** The build
  lanes open them faster than one review run clears them, and merge the integration branch into
  their own PRs while the review is doing the same, which twice discarded review work in progress.
  Two lanes both built item 71 (#93 and #98); the next review should merge one and close the other.
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
- **The server now has a resident-agent channel (from #21's last commit, `packages/server/src/canvas/relay.ts`
  and `resident.ts`).** The first combination of #21 was made from the branch one commit short, so
  this part arrived separately (ed4fda1). It is server code outside the canvas: an agent holding
  `CANVAS_RESIDENT_SECRET` long-polls for asks from accounts in `CANVAS_RESIDENT_ALLOW` and may only
  set an ask's status or answer it. With no secret, or one under 32 characters, both paths answer 404
  (tested). Review changed one thing: the secret check guarded all of `/api/canvas/*` and would have
  answered 404 or 401 for the board API had the routes been registered in the other order; it now
  guards only its own two paths, with a test. The answers spend the model subscription of whoever
  runs the agent, which is why the allowlist exists; the sprint never ran it against a real model.
- **Two review runs overlapped from 10:55Z to 11:15Z.** Both combined #21; the second copy was
  discarded unpushed and only the missing commit was added. No PR was merged twice.
- **The agent-usability attempt was recorded again on the calm canvas: 21 of 21, median 2 tool
  calls.** A fresh agent was given only `AGENT_API.md` and the counting client, on the branch with
  #21, the prototype gate and run ownership in place. It replaces the 20/21 recorded before them
  (backlog 32 is done). Task 14, the earlier failure, passed. What the agent found confusing is
  under Decisions needed, item 13.
- **Five scorecard rows pass on `e53322f`; Performance reads "regressed" and is not.** That run
  measured 10k pan at 77.9 ms a frame; the same commit measured again straight after gave 35 ms,
  and the run before it 37.3 ms. The number flips between about 37 and 78 on this container
  whatever the code. Backlog 31 (stable performance numbers) has PR #43 open.
- **Opening another saved board (#39) changes what a browser's one local board means.** A browser
  keeps one board locally; "Saved boards" swaps it for another of the account's boards and saves
  there from then on, and other tabs of that browser follow. It only appears when the account has
  more than one board. Checked with one tab and two (edits land on the opened board, `main` is
  untouched, undo cannot bring the old board back), but this is the part of board sync with the
  most moving pieces; `open()` and `followOtherTab()` in `packages/canvas/src/board-sync.ts`.
- **Restoring an earlier version (#32) can be lost by a reload within about a second.** The board
  shows the restored version and the server holds it, but this browser's own copy is written a
  moment later; a reload before that brings back the board as it was, and the next edit saves that
  on top. Nothing is deleted (every version stays in history). Found by the review with a script
  (reload 0 ms and 300 ms after restore: lost; 1,000 ms: kept). Filed as backlog 42; the same gap
  exists for any board just loaded from the account.
- **`canvas_group` (#33) is a new agent tool that is always on**, not a flagged prototype: an agent
  can wrap the person's objects in a named frame. It comes from the working spec's *proposed* agent
  interface list, where every other verb (create, update, connect, arrange, annotate) was already
  an ordinary tool, so the review let it in on the same footing. It is revision-guarded, refuses
  to cover anything outside the group and is undone as one run. Decision 15 below.
- **The menu has one more item, "Earlier versions" (#35)**, shown when the board is saved to an
  account or the local server. The first screen is unchanged.
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
`pnpm build` and `pnpm test` pass on `20ccac9` (with Postgres 16, Redis and `JWT_SECRET` provided):

| Package | Result |
|---|---|
| canvas | 428 passed |
| server | 157 passed with `TEST_DATABASE_URL` set (the Postgres board suite is skipped without it) |
| sdk | 12 passed |
| mcp-server | 4 passed |
| cli, web | no test files |
| e2e | 1 passed; needs Postgres and Redis, which `pnpm eval:canvas` now starts itself when they are installed |

<!-- scorecard:start -->
Scorecard from `pnpm eval:canvas` at 2026-11-26T13:42Z on `20ccac9`:

| Measure | Target | Result | Status |
|---|---|---|---|
| Acceptance scenario | every step passes | 10/10 steps | pass |
| Ask loop | every step passes | 5/5 steps | pass |
| Agent usability | ≥90% of ≥20 tasks | 23/24 (96%), median 3 tool calls | pass |
| Safety of shared edits | 0 human edits lost | 0 lost; 10/10 races pass | pass |
| Persistence | identical in a clean profile | identical | pass |
| Performance | reported, not worse | 1k: load 1403 ms, pan 16.7 ms/frame; 10k: load 9864 ms, pan 78.5 ms/frame (worse: 10000 panMedianFrameMs 49 → 78.5) | regressed |
| Existing product | green | build passes; tests: all packages pass | pass |
<!-- scorecard:end -->

Measured on `20ccac9`, which has everything in the Merged list. Agent usability reports the attempt
recorded with #57 (a fresh one is PR #97, not yet reviewed). Performance reads "regressed" and is
not: see Read first.

## Merged
- [#169](https://github.com/seahyc/pairedcc/pull/169) P2: groups have names that agents can use, and a group is never named after an ask in it (7a610c7). Review: resolved the AGENT_API conflict and put a doc comment back where it belongs; verify-group-names 5/5.
- [#165](https://github.com/seahyc/pairedcc/pull/165) Options laid out on stated dimensions, inside the option cards (ec41baa). verify-option-dimensions 7/7; the manifest regenerates identical.
- [#166](https://github.com/seahyc/pairedcc/pull/166) Review follow-ups: overview totals, groups and phone fit; the answer-room search; the landing round (7d47281). Review: added verify-group-names to verify-all.
- [#167](https://github.com/seahyc/pairedcc/pull/167) An older board opened on two devices gets one Thinking page; a chosen page name is kept (4b0bd91). verify-calm-pages passes.
- [#173](https://github.com/seahyc/pairedcc/pull/173) Agent task 29 (options on dimensions); replaces #170, which was stacked on the pre-squash #165 (750d9bd). Self-test 1/1.
- [#171](https://github.com/seahyc/pairedcc/pull/171) Suggestions: zoomed-in phones, swipes, narrow phones, cue words in any script (8753e6b). p4-suggest, suggest-phone, suggest-cues and touch all pass.
- [#172](https://github.com/seahyc/pairedcc/pull/172) Agent tasks 30 (build on a folded thread's pick) and 31 (recall order) (65e7d79). Self-test 2/2.
- [#150](https://github.com/seahyc/pairedcc/pull/150) An answer taller than its estimate moves clear of what is below (e54ca60). verify-answer-room 5/5; fails without the fix.
- [#151](https://github.com/seahyc/pairedcc/pull/151) A tall ask and its answer bring the answer into view (8d41398). verify-answer-tall 4/4.
- [#152](https://github.com/seahyc/pairedcc/pull/152) Agent reads stay small: `read` gives words once as text (no `props.richText`), `runs` lists at most 10 ids per list (b05fb63). Manifest regenerates identical; scorecard green. **An outside agent reading `props.richText` from `read` must use `canvas_get`.**
- [#153](https://github.com/seahyc/pairedcc/pull/153) Browser checks ask without the question box (2a90d90). verify-all 57/57 with #154/#155.
- [#154](https://github.com/seahyc/pairedcc/pull/154) The person's own asks are in the feedback queue; an empty question leaves no arrow; Ctrl in the shortcut sheet (1cff04f).
- [#155](https://github.com/seahyc/pairedcc/pull/155) A card written across a frame's edge is lifted onto the page instead of being cut off; it still moves with the frame (0800e5c). verify-all 58/58.
- [#156](https://github.com/seahyc/pairedcc/pull/156) P4: suggestions on the board, not in a box (084f366). verify-p4-suggest 26/26 and 11 neighbouring checks.
- Merged by another session, not reviewed by this run: #157, #158, #160, #161, #164.
- [#144](https://github.com/seahyc/pairedcc/pull/144) P1: a finished thread folds to one line (1add311). verify-fold 19/19, settled 11/11 re-run.
- [#145](https://github.com/seahyc/pairedcc/pull/145) P1: focus (F) on a frame or thread (774c2bc). Review fix: focus ends when its target is deleted; verify-focus 14/14.
- [#146](https://github.com/seahyc/pairedcc/pull/146) P3: the whole board (O) (9481fce). Review fix: folded threads are counted; verify-overview 13/13.
- [#147](https://github.com/seahyc/pairedcc/pull/147) verify-runs accepts the layer name beside the text in an undo refusal (5f1c151). verify-runs passes.
- [#148](https://github.com/seahyc/pairedcc/pull/148) Acceptance waits for the import notice before typing (a365dd1). Acceptance 10/10.
- [#149](https://github.com/seahyc/pairedcc/pull/149) P5: Check me on a settled thought and its spaced return (ecd8118). verify-recall 21/21, learning, check-me re-run.
- Merged and released on 26 Nov by earlier runs, not re-checked by this run: #91, #92, #94, #95, #97 to #106, #108, #109, #110 to #139, #141 to #143 (see `git log` on the branch for one line each; #140 was replaced by #142).
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
- #21, remainder: the hosted resident-agent channel, with the secret check narrowed to its own paths (ed4fda1, committed by the review lane).
- [#24](https://github.com/seahyc/pairedcc/pull/24) 21 agent-usability tasks with machine checks, a self-test, a runner and a first recorded attempt, 20 of 21 (984374b). Review opened the task tab with the data prototype on, because tasks 13 to 16 are refused without it since #20.
- [#22](https://github.com/seahyc/pairedcc/pull/22) Undo refuses to restore a shape whose parent was deleted since; agents list and undo only their own runs; a learning prompt can hide only an agent's output (2b33d8c). Safety races 3 to 6.
- [#23](https://github.com/seahyc/pairedcc/pull/23) and [#26](https://github.com/seahyc/pairedcc/pull/26) Prototype: Relationship, Source, Transformation and Agent run derived from what the board records, shown read-only by `canvas_get` (8daf8d3, 5f9f355).
- [#25](https://github.com/seahyc/pairedcc/pull/25) Data agent write rules unit-tested; three data races and stricter acceptance checks in the eval (a7c8505). Safety races 6 to 9.
- [#27](https://github.com/seahyc/pairedcc/pull/27) Converge prototype behind `?prototype=converge`: a synthesis card with an arrow from each source that goes stale when one changes; checked live (12abf62).
- [#28](https://github.com/seahyc/pairedcc/pull/28) At most 50 boards per account; creating one more is refused with 403; 25 of 25 board tests pass on Postgres 16 (eb63f9b).
- [#29](https://github.com/seahyc/pairedcc/pull/29) A save the server refuses is no longer shown as Offline and re-uploaded for ever: the chip says why and waits for a change (2a36db5). Review added the 403 from #28's board limit, which was still treated as Offline. Reproduced in a tab for 413, 403 and 500.
- [#30](https://github.com/seahyc/pairedcc/pull/30) Board sync checked in a real browser against the real server: `PAIRED_SERVER_URL` makes the dev canvas proxy sign-in and boards (e8b3218). Reproduced with Postgres 16 and Redis: saved, opened in a clean browser on the same account, hidden from another account, 401 signed out.
- [#31](https://github.com/seahyc/pairedcc/pull/31) Converge prototype, part 2 (`?prototype=converge`): lettered arrows, claims that cite their sources, and a person's own synthesis from Properties (66678b5). Review fitted it to #27 as merged and to the calm layout, where Properties is behind the menu.
- [#32](https://github.com/seahyc/pairedcc/pull/32) `restore(revision)` in board sync and history routes in the dev board store; no screen yet (b8b30a3). Driven in a real tab: restore, undo of the restore, missing revision. See Read first for the reload gap.
- [#33](https://github.com/seahyc/pairedcc/pull/33) `canvas_group`: wrap revision-guarded objects in a named frame without moving them; stale, locked, mixed parents or covering an outsider reject the whole call (2b83999). Live HTTP and MCP check reproduced line for line.
- [#34](https://github.com/seahyc/pairedcc/pull/34) The stale flag names the input that changed and the path it came through (0f1807f). Review stopped it naming an input still hidden behind a learning prompt.
- [#35](https://github.com/seahyc/pairedcc/pull/35) Menu → Earlier versions lists kept revisions and restores one (6b92e2f). Driven in a browser at 1440 and 390 px: list, restore, reload.
- [#36](https://github.com/seahyc/pairedcc/pull/36) The eval gives the e2e suite real services, from the environment or throwaway Postgres and Redis it starts and removes (bac1a93). Run both ways; nothing left running or on disk.
- [#38](https://github.com/seahyc/pairedcc/pull/38) A board that opens with none of its objects in view is framed, never past 100% zoom (e489580). Reproduced: saved at 1440 px, opened on a 390 px phone profile, three objects in view at 78%.
- [#39](https://github.com/seahyc/pairedcc/pull/39) Menu → Saved boards opens another of the account's boards (e53322f). Driven with one tab and two; see Read first.
- [#40](https://github.com/seahyc/pairedcc/pull/40) The tour board's header lines no longer overlap, and on a phone the zoom bar sits clear of undo (cbbb9ac). Measured at 1440 and 390 px.
- [#41](https://github.com/seahyc/pairedcc/pull/41) An ask names the MCP agent that acted on the tab recently instead of saying there is none (6c5004b). Driven live: a script is never named, an MCP client is.
- [#42](https://github.com/seahyc/pairedcc/pull/42) Ask starters fit the selection: comparison for several objects, "Answer this" for a question (4794b4a).
- [#43](https://github.com/seahyc/pairedcc/pull/43) 10k pan is the median of five samples after a warm-up (1d04324). Reproduced at 43.1 and 39.4 ms; see Read first for what it does not fix.
- [#44](https://github.com/seahyc/pairedcc/pull/44) `canvas_annotate` no longer offers an `author` field; a test guards every tool (fa5c31d).
- [#45](https://github.com/seahyc/pairedcc/pull/45) The real-server sync check races two browsers: stale save refused with 409, both changes kept (f67c70e). Re-run against Postgres 16 and Redis.
- [#46](https://github.com/seahyc/pairedcc/pull/46) Import and paste from `yc/import-paste`, with a dropped CSV still a dataset under `?prototype=data` (b435ac7). 47 browser checks and acceptance 10/10 re-run. Review combined it with #42's starters.
- [#47](https://github.com/seahyc/pairedcc/pull/47) `canvas_overview` reports clusters of nearby objects (0a9808b). Review capped each cluster at 50 ids with a count, so a 10k pile cannot turn the overview into a full dump.
- [#48](https://github.com/seahyc/pairedcc/pull/48) Connectors made by `connect` re-pick facing sides when an end or its frame moves (13f9183). Live check re-run, including undo of the connection after a move.
- [#49](https://github.com/seahyc/pairedcc/pull/49) Working spec and principles brought up to date with #11 to #30 (550531f).
- [#50](https://github.com/seahyc/pairedcc/pull/50) A refused upload no longer cancels a newer edit's save (78cf874). The new test fails without the fix (checked).
- [#51](https://github.com/seahyc/pairedcc/pull/51) `read` and `get` report a card's `style` (715fa24).
- [#52](https://github.com/seahyc/pairedcc/pull/52) Comments, agent notes and replies move with the object they are about, in one undo step (0f035b7). Driven live: move, undo, redo.
- [#53](https://github.com/seahyc/pairedcc/pull/53) Tool descriptions and AGENT_API say `canvas_reply` answers feedback and `canvas_answer` answers an Ask (c106b6d).
- [#54](https://github.com/seahyc/pairedcc/pull/54) Signing in from the canvas keeps the tab's prototype flags and nothing else from the URL (1fb9b69).
- [#55](https://github.com/seahyc/pairedcc/pull/55) Side by side for two records of one import; fields keep one slot per column (fe2b041). 14 browser checks re-run.
- [#56](https://github.com/seahyc/pairedcc/pull/56) The scorecard has an Ask loop row, run on a dev server of its own so no resident agent can take its asks (89834fb). 5/5 re-run.
- [#57](https://github.com/seahyc/pairedcc/pull/57) Three agent-usability tasks (answer an ask, reply in a thread, converge) and a 24-task attempt, 23 passed; tasks missing from an attempt now count against it (6dd0f88). Self-test 24/24 re-run.
- [#58](https://github.com/seahyc/pairedcc/pull/58) "Show Q56, Q16": the sections a record cites move beside it with reference arrows, one undo (fbde7bb). 15 browser checks re-run.
- [#59](https://github.com/seahyc/pairedcc/pull/59) A restored or freshly loaded board survives an immediate reload (f2122e2). Reproduced in a browser; acceptance, safety and persistence re-run.
- [#60](https://github.com/seahyc/pairedcc/pull/60) `.xlsx` workbooks are read without a new dependency: first sheet only, with size and reference limits (9a47d17). 51 browser checks re-run.
- [#61](https://github.com/seahyc/pairedcc/pull/61) At the board limit, a browser's unmerged work can no longer end up saved over the account's board (41cc1a1).
- [#62](https://github.com/seahyc/pairedcc/pull/62) A learning prompt cannot hide the person's comments, or an agent frame that holds the person's work (e9fd2cb).
- [#63](https://github.com/seahyc/pairedcc/pull/63) Four agent frictions: `comment` in marks, `locked` in the overview, a duplicate offset that fits, changed fields in `canvas_runs` (637bf2c).
- [#64](https://github.com/seahyc/pairedcc/pull/64) Asks carry the person's picks and cross-outs, and an option's siblings (16c9a38). 8 browser checks re-run. Review repaired a table in AGENT_API.
- [#65](https://github.com/seahyc/pairedcc/pull/65) Web pages become section cards: a saved `.html` file or a copied stretch with headings (502ae3f). 9 and 51 browser checks re-run.
- [#66](https://github.com/seahyc/pairedcc/pull/66) Boards holding half an emoji save on Postgres; merged remote changes stay out of undo; restore clears undo (95a9daf). Server contract run on Postgres 16.
- [#67](https://github.com/seahyc/pairedcc/pull/67) An ask about a frame carries what the frame holds; hidden learning results are never sent (b6cf5b6). 8 browser checks re-run. This squash also reverted #63's documentation; see Read first.
- [#68](https://github.com/seahyc/pairedcc/pull/68) A dropped CSV keeps long IDs as text, keeps a quoted empty row, and refuses a non-UTF-8 file with the line (df4b30b). 5 browser checks re-run.
- [#69](https://github.com/seahyc/pairedcc/pull/69) An answer lands on its ask's page even when another page is open, with a notice (e8d313a). 11 browser checks re-run.
- [#70](https://github.com/seahyc/pairedcc/pull/70) Edits to existing objects made while the account's board loads are kept, field by field (30f1346). Acceptance, safety, persistence and the real-server sync check re-run.
- [#71](https://github.com/seahyc/pairedcc/pull/71) Staleness is worked out once per object; a repeated cause is reported by reference (947a5e4).
- [#72](https://github.com/seahyc/pairedcc/pull/72) A stale flag shows its whole reason when the object is selected or the flag is focused (ce3d11d). 8 browser checks re-run.
- [#73](https://github.com/seahyc/pairedcc/pull/73) Text PDFs become section cards through a built-in reader (641fe0e). 7 browser checks re-run. Review added a visited set so a cyclic page tree cannot hang the tab, with a test.
- [#74](https://github.com/seahyc/pairedcc/pull/74) `canvas_read` takes `text` to find objects by their words (adcaad8).
- [#75](https://github.com/seahyc/pairedcc/pull/75) Board history keeps the newest 20 revisions, then one per 15-minute slot, 50 in all (5190d97). Store contract run on Postgres 16.
- [#76](https://github.com/seahyc/pairedcc/pull/76) Images are stored inside the board so a clean profile shows them (4b04d68). 5 browser checks re-run, including the clean profile.
- [#77](https://github.com/seahyc/pairedcc/pull/77) A dropped image lands no larger than 600 units on its longest side (0ba07fa). 7 browser checks re-run.
- [#78](https://github.com/seahyc/pairedcc/pull/78) The text filter reads a partly formatted word as one word and handles Greek sigma and vowel signs (27b3b32).
- [#79](https://github.com/seahyc/pairedcc/pull/79) README and working spec say boards and earlier versions are on the menu (2fe659c).
- [#80](https://github.com/seahyc/pairedcc/pull/80) The selection bar, Ask box and ask state line stay inside the window at 1440 and 390 px (ca367d8). 20 browser checks re-run; review kept #55's vertical clamp.
- [#81](https://github.com/seahyc/pairedcc/pull/81) The development board store survives its folder being removed (e4f1c8a).
- [#82](https://github.com/seahyc/pairedcc/pull/82) Safety measure: a stale restore against another browser's newer save (0a90525). 10/10 re-run.
- [#83](https://github.com/seahyc/pairedcc/pull/83) Key hints read Ctrl, Shift and Backspace outside Apple devices (90fb20c). 16 browser checks re-run on Windows and Mac profiles.
- [#84](https://github.com/seahyc/pairedcc/pull/84) CSV codes with leading zeros, hex and binary spellings stay text (09e83ef).
- [#85](https://github.com/seahyc/pairedcc/pull/85) The delimiter guess respects quotes; a table cut to 2,000 rows says so; "show as table" refuses to rebuild an import the person has changed (76591e1). 10 and 51 browser checks re-run.
- [#86](https://github.com/seahyc/pairedcc/pull/86) Data prototype: an ask about a chart or dataset carries what it shows as text (9b6e7a1). 8 browser checks re-run.
- [#87](https://github.com/seahyc/pairedcc/pull/87) Answers wrap to fit the window and the view pans to a landed answer (7a11dcd). 14, 11 and 20 browser checks re-run. Review merged it with #69 and added the fix for the phone selection bar.
- [#88](https://github.com/seahyc/pairedcc/pull/88) On a touch-only screen the first board says tap and the bar shows no key caps (af29386). 11 and 16 browser checks re-run.
- [#89](https://github.com/seahyc/pairedcc/pull/89) An edited imported title reaches the agent as shown; a follow-up ask gives a record as its parts; a marked header row is the header (f6c8bbe). 7 and 51 browser checks re-run.
- [#90](https://github.com/seahyc/pairedcc/pull/90) Prototype behind `?prototype=context`: Leave out (L) keeps objects back from asks, shown on the board and counted on the ask (20ccac9). 19, 7 and 8 browser checks and the Ask loop re-run.
- [#96](https://github.com/seahyc/pairedcc/pull/96) Removes the second text filter the #74 and #78 merges left in `read` (b837aa9).
- Review lane: `packages/cli` and `packages/web` test scripts pass with no test files (a712b50).

How each was checked: the branch was merged with the integration branch, built and tested; every
`## Proof` claim was re-run (before and after test counts, the scorecard rows, each live headless
script, #12 against a real local Postgres 16 and the running server). From #8 on, PRs are merged
through GitHub and show as merged; #2 to #7 show as closed because they were squashed locally.

## Rejected
- [#168](https://github.com/seahyc/pairedcc/pull/168) Closed as a duplicate of #165: it added a separate table object to the board. The work itself was sound.
- [#170](https://github.com/seahyc/pairedcc/pull/170) Replaced by #173 (branch stacked on a superseded base).

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
13. **Agent tool rough edges**, from the fresh agent's own report: `canvas_annotate` has an `author`
    parameter defaulting to "Human"; no tool obviously matches "attach a comment"; changing a
    shape's text leaves its name stale; `canvas_connect` relations are unexplained; `canvas_read`
    is large and has no text filter; an agent cannot tell whether a tab has a prototype flag on.
14. **Prototype fields in `canvas_get`** (#26) are returned in every tab, not behind a flag, since
    they are read-only and put nothing on the board. Alternative: `?prototype=primitives`.
15. **`canvas_group` always on** (#33). Alternative: label it a prototype and refuse it without
    `?prototype=group`, like converge.
16. **Where a person converges** (#31): "Pull into a synthesis" sits in Properties, three clicks
    away on the calm layout. Alternative: on the selection bar beside Ask, behind the same flag.
17. **Starters on an imported record** (#46 with #42). A selection that touches an imported record
    keeps the record starters; anything else gets starters fitted to the selection. Alternative:
    two selected records get the comparison starters.
18. **Side by side and "Show cited" move things for good** (#55, #58), undone with one Cmd+Z; cited
    sections are moved, not copied, and their arrows are in the person's ink. Alternatives are in
    each PR.
19. **Only the first sheet of a workbook is read, and dates stay serial numbers** (#60).
20. **A web page with a data table is read as the table, not its prose** (#65).
21. **A board deleted and recreated under one ID restarts at revision 1** (#66, item 45 (a)), so a
    save holding the old revision number is accepted. Fixing it needs a tombstone table, a
    migration that would run on the next deploy; left for you.
22. **Read `marks` renamed `note` to `comment`** (#63). An outside agent matching on `note` breaks.
23. **Where images are kept** (#76): inside the board snapshot, so every save and every kept
    revision carries them and they count against the 10 MB limit. Alternative: a server asset store.
24. **PDF reader** (#73): built in, text PDFs only, no compressed object streams. Alternative: pdf.js
    behind the same `readPdf` interface.
25. **History retention** (#75): newest 20, then one per 15 minutes, 50 in all. Alternatives: an
    hourly slot for older revisions, or a byte budget per account.
26. **An answer to an ask on another page** (#69) is kept off the person's undo stack; an agent can
    still undo it as a run.
27. **On a phone the selection bar may cover the tool strip while open** (#80). Alternative: hide the
    strip while asking.
28. **Leaving objects out of asks** (#90, prototype): an object the person selects for an ask is
    still given even when marked; the ask says how many were kept back, never what; agents can see
    the mark in `read` but cannot set it. Alternatives are in `SPRINT.md` (build-B, item 67).
29. **The view pans when an answer lands** (#87). Alternative: leave the view and show a pointer
    ("4 options below").
12. **Document sharing wording** (found by #19, outside canvas scope): a new document says "anyone
    with this link can edit", but another signed-in user gets 404 until invited through Share.

## Not yet covered
Open and not yet reviewed: #159, #162, #163, #165 to #170.
