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
- Commit as the repository owner, not as a tool. Before your first commit in a run:
  `git config user.name "$(git log -1 --format=%an 3ee3f06)" && git config user.email "$(git log -1 --format=%ae 3ee3f06)"`.
  No `Co-Authored-By` or other trailers.
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

## Goal and eval (added 26 Nov; read before choosing a task)
**Goal for the sprint:** the working spec's first end-to-end acceptance scenario runs for real on
this branch, driven both by a person in the browser and by an external agent over MCP, with boards
saved on the server.

Whether the canvas is good to think with is a judgment only the maintainer can make, so it is not
measured here. The sprint is judged on this scorecard, produced by `pnpm eval:canvas` and committed
as `packages/canvas/eval/scorecard.json` plus a table in `SPRINT-REPORT.md`:

| Measure | How it is measured | Target |
|---|---|---|
| Acceptance scenario | One headless-browser script walks the spec scenario step by step: import dataset, select a subset, chart it, filter the chart directly, agent reads that exact state, agent adds a result nearby, a manual annotation survives an agent revision, changing an input marks dependents stale, reload restores everything | every step passes |
| Agent usability | A fresh subagent given only `AGENT_API.md` and the MCP tools attempts a fixed set of at least 20 board tasks stored in `packages/canvas/eval/tasks/`; each task has a machine-checked end state | at least 90% completed, median tool calls per task reported |
| Safety of shared edits | Scripted races: stale agent write against a newer human edit, agent undo with interleaved human edits, write to a locked object | 0 human edits lost |
| Persistence | Save, reload in a clean browser profile, and compare the board through the object interface | identical |
| Performance | Time to load and median frame time while panning at 1k and 10k objects | reported, and not worse between runs |
| Existing product | `pnpm build && pnpm test` for the whole workspace | green |

Rules for the eval: whoever implements a feature must not write the agent-usability tasks that
test it. Never weaken a check to make it pass; if a check is wrong, fix it and say why in the PR.
A PR that lowers any measure says so in `## Proof` and explains why.

**Backlog item 0, before anything else: build `pnpm eval:canvas`** and record the baseline
scorecard (failing steps are expected at first). From then on every PR pastes the scorecard before
and after, and the review lane re-runs it on `claude/sprint-int` after each merge. Choose the next
task by which measure is furthest from target, not by backlog order.

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
2. Acceptance scenario prototype | claude/sprint-acceptance-dataset | 2026-11-26T08:45Z

## Done

## Decisions needed

## Log
| UTC time | Lane | Task | PR | Result |
|---|---|---|---|---|
