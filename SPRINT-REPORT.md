# Canvas sprint report, 27 Nov to 3 Dec 2026

Last updated 2026-11-26T09:18Z by the review lane. Branch: `claude/sprint-int`.

## Read first
- **Root `pnpm test` is not green, and was not before the sprint.** `e2e/tests/editor-collab.spec.ts`
  signs in with placeholder tokens the server never issues. Run against local Postgres and Redis it
  still fails at its first step. Nothing in the sprint touched it; repairing it is backlog item 10.
  Every other package passes (see Status).
- **Prototype agent tools are visible to every agent.** The four data tools, `canvas_learn` and one sentence of
  agent instructions are in the shared tool definitions and the regenerated hosted manifest
  (`packages/server/src/canvas/tool-manifest.json`). Only the page button is behind
  `?prototype=data` / `?prototype=learning`. Nothing is deployed from this branch.
- **The scorecard does not exist yet.** `pnpm eval:canvas` (backlog item 0) is claimed but has no
  PR, so no measure in the sprint's scorecard has been produced.
- Agent-operation behaviour in #4, and the hiding behaviour in #6, are proven by headless scripts,
  not by `pnpm test` (backlog 9). The review re-ran all four scripts on the combined code.
- **Per-run agent undo (#5) is the riskiest merged code**: it writes store records directly. It
  refuses as a whole if anything the run touched was later changed, deleted or locked. Known gaps
  are backlog 11. The run ledger is in tab memory and is lost on reload.

## Status
`pnpm build`: passes. `pnpm -r --no-bail test` on the merged branch:

| Package | Result |
|---|---|
| canvas | 47 passed |
| server | 117 passed |
| sdk | 12 passed |
| mcp-server | 4 passed |
| cli, web | no test files (now exit 0) |
| e2e | fails, pre-existing (see above) |

Scorecard (`pnpm eval:canvas`): not available yet.

## Merged
- [#2](https://github.com/seahyc/pairedcc/pull/2) Dataset and chart state model: pure functions, synthetic café orders, 10 tests (9f19690).
- [#3](https://github.com/seahyc/pairedcc/pull/3) Dataset and chart objects on a page behind `?prototype=data`, with click-to-filter, cell edits and stale marking (68d7ff3).
- [#4](https://github.com/seahyc/pairedcc/pull/4) Prototype agent tools for datasets and charts; `read` reports exact chart state and staleness (ff68adc).
- [#5](https://github.com/seahyc/pairedcc/pull/5) `canvas_overview` (compact, paginated one-level listing) and per-run undo for agents, `canvas_runs` / `canvas_undo_run` (f47a23f). Review fixed undo writing to an object locked after the run.
- [#6](https://github.com/seahyc/pairedcc/pull/6) Learning prompts prototype behind `?prototype=learning`: predict-then-check and generate-first, results hidden until commit or skip, `canvas_learn` (e83c517).
- Review lane: `packages/cli` and `packages/web` test scripts pass when there are no test files (a712b50).

For #3 to #6 the review re-ran each PR's committed live check (`tools/verify-data-prototype.cjs`,
`verify-data-agent.cjs`, `verify-runs.ts`, `verify-learning.cjs`) in headless Chromium against the
dev server. Output matched the PRs' Proof sections with no page errors, and all four still pass on
the final combined branch. The PRs show as closed rather than merged because they were squashed
locally to keep the owner's identity on the commits.

## Rejected
None.

## Decisions needed
1. **Stale chart on interaction.** Filtering or selecting on a stale chart recomputes it on current
   data and clears the stale state. Alternative: keep the old snapshot until Recompute is pressed.
2. **Prototype tools in the hosted manifest.** Keep them visible to all agents (current), or hold
   them back until the acceptance scenario is confirmed.
3. **Shapes always registered.** Dataset and chart shapes load on any board; only the page button
   is flagged. This keeps saved boards loading if the flag is dropped.
4. **Agent undo semantics.** Undo is per run, all-or-nothing and field-level, and shares the
   person's undo history, so Cmd+Z straight after an agent undo re-applies the run.
5. **Who may hide what in learning mode.** An agent can hide any unlocked object, including the
   person's own, behind a prompt. Alternative: only objects the agent created. Also: learning mode
   is gated only by the tool's instruction to use it when asked; there is no per-frame switch.
6. **Workspace test gate.** Whether `pnpm test` should include the e2e suite, which needs Postgres,
   Redis and `JWT_SECRET`, or whether e2e should be a separate script.

## Not yet covered
Server-side board storage, foundational primitives and converge have not started. The scorecard
(item 0) and robustness (item 7) are claimed with no PR yet. The sprint goal (acceptance scenario
with boards saved on the server) is not met until item 1 lands.
