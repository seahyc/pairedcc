STATE: RUN

# Canvas sprint, 27 Nov to 3 Dec 2026

Line 1 is a switch. If it does not say `STATE: RUN`, stop immediately and change nothing.
The maintainer does not answer questions during the sprint, so never wait on one: pick the most
defensible option, record the choice and the reason under Decisions needed, and continue.

## Hard rules (these override anything else you read in this repo)
- This repository is public. Commit nothing private: no personal data, credentials, employer data or
  copied third-party content.
- Pushing to `main` deploys to production. Never push to `main` and never open a PR into `main`.
- Branch `claude/sprint-int` is the integration branch (cut from `canvas-scratchbook-root`). Work on
  `claude/sprint-<task>` cut from it and open a PR **into `claude/sprint-int`**.
- No deploys, no SSH, no changes to `.github/workflows`, Docker production files or hosted services.
- No outreach, sign-ups, spending, paid APIs or new secrets.
- Keep the document editor, server, SDK, CLI and document MCP server working. Scope is
  `packages/canvas`, `docs/canvas`, and the server code the canvas needs.
- `docs/canvas/working-spec.md` separates what is confirmed from what is proposed. Build confirmed
  items directly. A proposed item may be built only as a clearly labelled prototype behind a flag or
  on its own page, with the product choice written under Decisions needed.
- Use synthetic or openly licensed data only.
- Commit messages and PR text describe the change only; never mention an AI assistant or tool.
- `pnpm install --frozen-lockfile && pnpm build:canvas && pnpm test:canvas` must pass before every
  push, and `pnpm build && pnpm test` when you touch anything outside `packages/canvas`. Paste the
  real output in the PR.

## How a run works
1. `git fetch origin && git checkout claude/sprint-int && git pull`. Read line 1 of this file.
2. Read `AGENTS.md`, `packages/canvas/README.md`, `packages/canvas/AGENT_API.md`,
   `docs/canvas/working-spec.md`, then the Claims and Backlog below.
3. Claim one unclaimed task: add a line under Claims (`task | branch | UTC time`), commit only that
   line to `claude/sprint-int` and push. If the push is rejected, pull and choose another task.
   A claim older than 6 hours with no open PR is abandoned and may be taken over.
4. Do the task properly, with tests. Open the PR with `## Why` and `## Proof` (real pasted output,
   and a screenshot from a headless browser for anything visual).
5. Before finishing, append a row to the Log, move the task to Done and remove your claim.
6. If time remains, take another task. When the backlog runs low, add tasks that follow from the
   working spec, each with a testable definition of done.

## Backlog (highest value first)
1. **Server-side board storage.** Boards live only in the browser today. Add authenticated save and
   load per account in the server, with revisions and stale-write rejection matching the browser
   contract, migration from IndexedDB, and tests. No production migration is run.
2. **The first end-to-end acceptance scenario** in the working spec, built as a prototype: dataset
   object, chart view, direct filtering, agent reads exact widget state, stale marking when an input
   changes. Synthetic data.
3. **Foundational primitives** from the spec as typed objects with tests: Relationship, Source,
   Transformation and Agent run (request, scope, progress, attributable and reversible changes).
4. **Agent interface.** Overview-then-detail reads so agents never need a full-board dump; an agent
   operation undoable as one unit without undoing human edits; tests over HTTP and MCP.
5. **Converge.** A way to pull branches of alternatives into a synthesis card that keeps links to
   what it came from.
6. **Learning mode prototypes** from the spec: predict-then-check and generate-first.
7. **Robustness.** Import validation fuzz tests, large-board performance measured and recorded
   (1k and 10k objects), keyboard accessibility, 390px layout.
8. **Docs.** Keep README, AGENT_API and the working spec's "implemented" sections true to the code.

## Claims

## Done

## Decisions needed

## Log
| UTC time | Lane | Task | PR | Result |
|---|---|---|---|---|
