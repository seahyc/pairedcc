# Canvas sprint report, 27 Nov to 3 Dec 2026

Last updated 2026-11-26T09:30Z by the review lane. Branch: `claude/sprint-int`.

## Read first
- **Root `pnpm test` is not green, and was not before the sprint.** `e2e/tests/editor-collab.spec.ts`
  signs in with placeholder tokens the server never issues. Run against local Postgres and Redis it
  still fails at its first step. Nothing in the sprint touched it; repairing it is backlog item 10.
  Every other package passes (see Status).
- **Prototype agent tools are visible to every agent.** The four data tools and one sentence of
  agent instructions are in the shared tool definitions and the regenerated hosted manifest
  (`packages/server/src/canvas/tool-manifest.json`). Only the page button is behind
  `?prototype=data`. Nothing is deployed from this branch.
- **The scorecard does not exist yet.** `pnpm eval:canvas` (backlog item 0) has not been built or
  claimed, so no measure in the sprint's scorecard has been produced.
- Agent-operation behaviour in #4 is proven by a headless script, not by `pnpm test` (backlog 9).

## Status
`pnpm build`: passes. `pnpm -r --no-bail test` on the merged branch:

| Package | Result |
|---|---|
| canvas | 32 passed |
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
- Review lane: `packages/cli` and `packages/web` test scripts pass when there are no test files (a712b50).

For #3 and #4 the review re-ran `tools/verify-data-prototype.cjs` and `tools/verify-data-agent.cjs`
in headless Chromium against the dev server; the output matched the PRs' Proof sections line for
line, with no page errors. The PRs show as closed rather than merged because they were squashed
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
4. **Workspace test gate.** Whether `pnpm test` should include the e2e suite, which needs Postgres,
   Redis and `JWT_SECRET`, or whether e2e should be a separate script.

## Not yet covered
Server-side board storage, the scorecard, foundational primitives, converge, learning-mode
prototypes and robustness work have not started. Agent interface (item 4) is claimed, no PR yet.
