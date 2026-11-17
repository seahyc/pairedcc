> Ownership update, 17 Nov 2026: this canvas now belongs to Paired (`packages/canvas`). Mentions of Picabird below describe the original discussion; Picabird is again a separate shopping/data project.

# Picabird thinking canvas: working specification

Summary: YC wants a rich thinking canvas for web exploration, research, understanding, learning and data analysis. It should feel like tldraw, Figma, Paper and Miro, with agent primitives treated as foundational. This document separates confirmed requirements from proposals for discussion.

Status: current design discussion; not an implementation or release specification. Created 2026-11-17.

## Confirmed by YC

- Develop this direction in the Picabird project.
- Both a built-in assistant and external agents are required from day one, using the same object operations.
- Work out the specifications together before implementation.
- Familiar spatial canvas experience inspired by tldraw, Figma, Paper and Miro.
- Rich content including data and interactive widgets; strong primitives for agents are critical.
- The broader ambition covers the web, research, understanding, learning and analysis.
- Investigate combining the experience with Answer.AI Solveit's approach.

## Existing project, inspected 2026-11-17

AGENTS.md, README.md and STATUS.md describe a live-data-for-agents API and landing page. The inspected tree contains the Worker and source adapters, not an existing thinking canvas. Deployment descriptions are historical project records, not live verification in this session. Source-level provenance is a potentially reusable concept. No implementation, deployment, account, branding or pricing change is implied by this discussion.

## Proposed product contract

A persistent shared workspace where a person and agents manipulate the same addressable objects to investigate questions, test ideas and preserve understanding.

The canvas is the primary surface. Conversations, code, tables and widgets are working objects within it. Their exact presentation remains open.

## Proposed interaction loop

1. Bring material onto the canvas: URL, file, image, text, dataset or an initial question.
2. Arrange and annotate it; select particular objects or parts of them.
3. Ask an agent to explain, investigate, transform, compare or build from that selection.
4. Inspect the resulting artifacts beside the originals; try interactive outputs.
5. Edit directly, annotate specific parts, or explore another branch.
6. Preserve useful results and the sources, assumptions and transformations behind them.

## Proposed canvas behaviour

- Pan/zoom, selection and multiselection, direct manipulation, text editing, drawing, connectors, frames, alignment and undo/redo.
- Useful overview at a distance, readable/editable content when focused; exact zoom behaviour to prototype.
- Handwritten and typed annotations can target a whole object or a specific region.
- Object relationships are distinct from visual proximity. Moving a chart does not silently change execution order or context.
- Human and agent edits appear in the same workspace with inspectable authorship/history.

## Proposed foundational primitives

| Primitive | Contract |
|---|---|
| Object | Stable ID, type, content/state and revision; both humans and agents can read and modify it. Position is presentation state. |
| Selection | Explicit targets: object IDs, text ranges, image regions, rows/cells or data points, as supported by object type. |
| Frame | A named spatial grouping that can carry an investigation brief; rules for inherited context remain to be decided. |
| Relationship | An inspectable connection such as derived-from, alternative-to or depends-on. Decorative connectors remain possible. |
| Source | A reference to origin and retrieved version, with exact location where available. Generated interpretation remains distinguishable from source material. |
| Transformation | Named inputs and parameters producing outputs. Records the input revisions used; changed inputs can mark results stale. |
| Widget | An interactive view with readable state, supported actions and outputs. Manipulation updates shared state, rather than hiding essential meaning inside a rendered page. |
| Agent run | Request, context, allowed edits, progress and resulting changes; cancellable, inspectable and attributable. |

## Proposed agent interface requirements

- Discover an overview, then read only relevant object details; do not require full-board dumps or screenshots for ordinary operations.
- Read semantic object state as well as inspect visual appearance when needed.
- Create, update, connect, group, arrange and annotate objects through structured operations.
- Work against known revisions. Detect stale edits; never silently replace a newer human edit.
- Make a coherent operation reversible without undoing unrelated human work. Concurrency semantics remain an architectural question.
- Widgets expose state and actions to the agent; generated HTML alone is insufficient for critical interactions.
- Execution and other side effects have explicit boundaries. Storage, sandbox, permissions and external-agent authentication are unresolved.
- MCP is a possible transport, not the domain model or the entire agent product contract.

## Solveit: what to borrow, what to verify

Borrow editable working context, small inspectable steps, code/notes/dialogue together, and shared execution state. A spatial workspace needs explicit context and dependencies because it has no single linear order.

Unresolved: integrate the actual Solveit runtime/client, offer an optional bridge, or adopt its principles with another execution system. No dependency chosen.

Sources inspected in the discussion:
- https://www.answer.ai/posts/2025-10-01-solveit-full.html
- https://www.fast.ai/posts/2025-11-07-solveit-features.html
- https://github.com/AnswerDotAI/solveit_client
- https://gist.github.com/jph00/9e7b444aba5ecf6d14295ba2cee890c3

## Proposed first end-to-end acceptance scenario

Import a non-confidential dataset and references. Select a subset and ask for an explanation plus an interactive chart. Filter or manipulate the chart directly. The agent can read that exact state, explain the selected values, and add another result nearby. A manual annotation survives agent revisions. Changing an input marks dependent outputs stale. Reopening restores the saved work and useful context.

This tests the shared human/agent workflow before choosing the full object catalogue. Use synthetic or expressly permitted data; do not copy employer data into this project.

## Decisions to discuss first

1. Confirmed: both built-in and external agents from day one. Authentication, transports and supported first clients remain open.
2. First proof of value: research/learning, data analysis, or visual creation?
3. Canvas execution model: object graph with notebook-like execution inside frames, or one shared notebook/runtime with a spatial view?
4. Collaboration scope: one person with agents initially, or multi-human collaboration immediately?
5. Generated-widget freedom: constrained composable components, sandboxed custom widgets, or both?

## Next step

Confirm the first proof of value (research plus data analysis is proposed), collaboration scope and widget extensibility with YC. Refine the user journeys and object contracts before choosing a canvas engine, runtime or implementation plan.

## Proposed first-session scope (awaiting YC)

Research and data analysis first, with native text, drawing, image and annotation support. First-class content objects: note, source/document, dataset, view/chart, interactive widget and dialogue/execution block. These use the shared identities, selections, relationships, runs and revision contracts above.

### Proposed context contract

An agent request starts with explicit selection plus a visible context bundle: selected objects/regions, the local frame brief and pinned references. Agents can discover additional relevant material through structured reads; spatial proximity alone never grants edit scope or silently changes context. Reads and edits have separate scopes. An agent proposal can expand the bundle visibly.

### Proposed widget contract

A widget declares inputs, serializable state, supported actions and outputs. Manual interactions and agent actions update the same state. Agent-generated custom widgets are a proposal; sandbox policy, dependencies, network permissions and trusted actions remain unresolved. Embedding a webpage does not automatically make it agent-operable.

### Proposed collaboration contract

Start with one human working with multiple agents. Design revision/conflict handling for that concurrency immediately. Multi-human live collaboration is a separate product-scope decision, not a prerequisite assumed here.

## Canvas foundation authorised and built: 2026-11-17

YC requested a running, smooth canvas first, with Paper as the visual/interaction reference. The local prototype in `canvas/` uses tldraw 5.6.1, a Paper-inspired shell and a revision-aware browser object interface. See `canvas/README.md` for actual features, checks and limitations. This supersedes the earlier no-implementation checkpoint for the canvas foundation only. Built-in AI, external-agent transport, interactive data widgets and the broader specification remain open. No production deployment or paid license was authorised or performed.

## Local agent access implemented: 2026-11-17

YC requested API/agent access to reproduce Thariq's reference/alternatives/feedback workflow. `canvas/AGENT_API.md` documents the local HTTP/browser relay and stdio MCP adapter. Agents can add image artifacts, bind connections, read targeted feedback, revise specific objects, resolve annotations and render PNG screenshots. Transport is local/development-only and requires an open browser. The Agent studio SVG fixture verifies the workflow but is not an autonomous image-generation agent. A built-in assistant and actual model/provider integration remain open.
