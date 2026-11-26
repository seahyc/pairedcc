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

## How humans think intuitively

Endorsed by YC as design grounding, 2026-11-18. These are well-supported findings from cognitive science; the agent primitives below exist to serve them.

1. **Working memory holds only about four things.** People think well by putting their thinking out into the world and working on it there (Clark and Chalmers, the "extended mind").
2. **Moving things is thinking.** People rearrange Scrabble tiles and Tetris pieces to work things out, not to make progress (Kirsh, "epistemic actions"). Arranging a canvas is reasoning, not tidying.
3. **Spatial thinking comes first.** Abstract thought builds on spatial thought (Tversky, *Mind in Motion*). "Close", "above" and "central" are how we reason about ideas.
4. **We think with our eyes.** Grouping, outliers and contrast are seen before they are reasoned about, so a good representation turns a reasoning problem into a seeing problem.
5. **Concrete before abstract.** Understanding starts from specific examples and moves outward. Abstractions without examples don't stick.
6. **Comparing beats describing.** Two alternatives side by side show what one alone can't. This is why Thariq's board works.
7. **Recognising beats recalling.** Picking from options is much easier than producing an answer from nothing.
8. **Rough means unfinished.** A sketchy, rough look tells people an idea is still open to change. A polished look makes them stop questioning it.
9. **Understanding needs effort and repetition.** Reading an explanation feels like understanding, but often isn't.

## What produces understanding

Reading a clear explanation creates familiarity, not understanding (Matuschak, "Why books don't work"). The learning-science findings below describe what does. In each case the learner does the work.

| Mechanism | Finding | Canvas implication (proposal) |
|---|---|---|
| Predict, then check | Committing to a guess before seeing the answer makes the surprise stick, and the error is what teaches. | Before revealing a chart or result, optionally ask "what do you expect?" and keep the guess next to the outcome. |
| Generate and self-explain | Producing an answer or explaining "why" in your own words beats reading it (generation effect; Chi on self-explanation). | Agent asks the human to state a claim or explanation first, then critiques it, rather than writing the conclusion. |
| Retrieve | Recalling something strengthens it far more than rereading it (Roediger and Karpicke, the testing effect). | Resumed work opens with "what did we conclude here, and why?" before showing the answer. |
| Space and revisit | Returning after a delay beats massed study (Bjork, desirable difficulties; Matuschak's mnemonic medium). | Resurface open questions and stale conclusions on return, on a widening interval. |
| Contrast cases | Comparing well-chosen examples reveals which features matter, especially before any explanation (Schwartz and Bransford). | Comparison is a first-class action; agents propose contrasting cases, not only examples. |
| Manipulate the model | Changing an input and watching the effect builds an intuition that static text can't (Victor, explorable explanations; Papert, constructionism). | Any assumption can become a control; dependents update or show as stale. |
| Struggle productively, then get help | Attempting a problem before instruction improves later understanding, if help arrives at the right moment (Kapur, productive failure). | Agent help is offered at a sticking point, not before the attempt. |
| Use it for real | Knowledge applied to a real project in varied contexts transfers; knowledge only rehearsed does not. | Learning sits inside actual work on the canvas, not in a separate tutor panel. |

These mechanisms cost effort, so they apply only when understanding is the goal. See "Working and learning" below.

## Prior art: Bret Victor

Victor's work asks how to make thinking visible and directly manipulable. Its value is in **seeing**, not in effort, so it helps whether you are learning or just getting work done.

| Work | Key point | Canvas implication (proposal) |
|---|---|---|
| "Magic Ink" (2006) | Most software is information software: its job is to answer a question through graphic design, with as little interaction as possible. Interaction is a cost. | The default view of any object answers its likely question at a glance. Controls appear on demand. |
| "Up and Down the Ladder of Abstraction" (2011) | Understand a system by moving between one concrete instance, many instances and the aggregate, with the views linked. | Any aggregate drills down to its rows; any row can be lifted to the pattern. This is the core answer for the 230-tab workbook. |
| "Explorable Explanations" and "Kill Math" (2011) | Numbers in an argument should be adjustable, so readers can explore what depends on them. Replace symbol manipulation with direct manipulation of concrete representations. | Any assumption in a note, table or model can become a control, with dependents updating or marked stale. |
| "Inventing on Principle" (2012) | Creators need an immediate connection to what they create. Any delay between a change and seeing its effect blocks ideas. | Edits, filters and parameter changes show their effect immediately; agent runs show partial progress. |
| "Learnable Programming" (2012) | Show the data, not just the code. Make state and flow visible. Create by reacting to something on screen rather than starting from nothing. | Transformations show sample inputs and outputs inline. New objects start from an example or a suggestion, not a blank card. |
| "Media for Thinking the Unthinkable" (2013) | New representations make new thoughts possible. Multiple linked views of one model let you see it from several angles at once. | Tables, charts, notes and widgets are views of the same underlying object, not copies of it. |
| "Seeing Spaces" (2014) and Dynamicland / Realtalk (2017–present) | Computation should be visible, physical and shared, so people can gather around it, point at it and change it together. "Realtalk is not a codebase. It's a poster gallery." | Everything that matters stays on the canvas, inspectable and pointable. Agent work is visible objects, not hidden state. |

## Prior art: Andy Matuschak

Matuschak's work asks how people actually come to understand and remember things, and what that means for tools. Much of it is about **learning specifically**, so most of it applies in learning mode (see "Working and learning").

| Work | Key point | Canvas implication (proposal) |
|---|---|---|
| "Why books don't work" (2019) | Books and lectures assume understanding transfers by exposure. It doesn't; the reader must do the cognitive work, and the medium can be designed to prompt it. | In learning mode, the canvas prompts the learner to engage instead of only presenting conclusions. |
| "How can we develop transformative tools for thought?" (with Michael Nielsen, 2019) | Transformative tools change how people think, not just how fast they work. They come from deep insight into a real problem, built with serious users, not from generic features. | Prove the canvas on one demanding real workflow, such as the workbook, before generalising. |
| Quantum Country and the mnemonic medium (2019) | Embedding spaced-repetition review in the reading makes memory a choice. Memory is the foundation that understanding is built on. | Learning frames can turn key claims into review prompts that resurface over time. Off by default elsewhere. |
| Evergreen notes (working notes) | Notes should be atomic, concept-oriented and densely linked, and keep developing over time. They compound across projects instead of being written once for one task. | Notes are addressable objects that can be reused and linked across canvases, not trapped on one board. |
| "Tools for thought as cultural practices, not construction projects" | A tool succeeds only alongside the practices people develop around it. | Ship worked example canvases that show how to use it, alongside the features. |
| AI-augmented learning and the "Wizard-of-Oz" learning assistant (2024–2026) | He tested what a good tutor actually does, using a human before building any AI version. Guidance should be embedded in the learner's real work, not a separate chat. An AI that thinks for you skips the processing that creates understanding. | The agent works on the same objects, at the point of need. In learning mode it scaffolds instead of answering. |
| "Apps and programming: two accidental tyrannies" (early 2026) | Apps trap capabilities in silos, and programming is too hard for most people to escape them. His malleable reading prototype lets extensions by different authors compose on the same text without knowing about each other. | Widgets and extensions declare what they contribute and compose on shared objects, as in the widget contract. |

## Working and learning

The canvas serves two kinds of sessions, and many sessions mix them.

- **Working:** the goal is a result, such as an answer, a decision, a chart or a draft. Understanding beyond what the task needs is optional.
- **Learning:** the goal is that the human comes to understand or remember something.

Rules:

1. **Working is the default, and it must be seamless.** The agent does what is asked, directly and quickly. No quizzes, predictions or "explain it yourself" prompts by default.
2. **Victor's principles are always on.** Visible state, linked views, adjustable assumptions, drill-down and immediate feedback make work faster and safer as well as more understandable. They cost the user nothing.
3. **Matuschak's effort-based mechanisms are opt-in.** Prediction, retrieval, self-explanation, spaced resurfacing and "struggle first" turn on only when the human signals a learning goal, for example on a frame brief ("I want to understand this") or on a single request.
4. **Learning prompts never block.** Any prediction, review or explanation prompt can be skipped in one action, and the result is then shown directly.
5. **Mode belongs to a frame or request, not the user.** One canvas can hold a frame for learning a topic beside frames that just get work done.
6. **Cheap understanding is always available.** Even in working mode, every result keeps its sources, assumptions and transformations, so the human can check *why* whenever they choose.

Open question: whether the agent should ever suggest switching to learning mode, for example when the same concept is repeatedly re-asked. Proposed default: no unprompted suggestions until tested with YC.

## Working-mode reference: Thariq's board

Source: frames sampled every three seconds from the 36-second clip in [Thariq's post](https://x.com/trq212/status/2122438328079524159), inspected 2026-11-18. The clip shows the board, not the agent's implementation.

The board is a scratchbook: the agent generates, the human judges, and ideas branch out by association. It fits most of the principles above:

- Thinking lives on the board.
- Arrangement carries meaning.
- Alternatives sit side by side.
- The human recognises and picks rather than specifying.
- Roughness is visible.
- Pointing replaces prose.
- Rejected options stay visible.
- Selected directions become playable.

### Visual language: whose is what, at a glance

| | Human | Agent |
|---|---|---|
| Notes | Pink cards, handwriting font, short ("I like A here.") | Lavender cards, plain type, ✦ mark, long and structured |
| Ink | Pink circles around picks, X through rejects | Indigo arrows linking its notes to what they discuss |
| Captions | — | ✦ caption under every generated artifact, with status: rough, try A/B, locked, PLAYING |
| Role | Judges: picks, rejects, asks | Generates, interprets, critiques, asks, reports back |

Authorship must be **visible at a glance** through this visual language, not only inspectable in history.

### Agent conversation loop

1. **Read back:** restate how it understood the human's mark before acting ("How I read your note: … Correct me on the board if I've got it wrong").
2. **Propose:** generate options side by side, labelled rough until a direction is picked.
3. **Give a view:** "My read: … I lean to the spikes", with reasons.
4. **Ask:** hand decisions back as short numbered questions.
5. **Tell the human how to answer:** "Mark the ones worth a proper render, or mix them."
6. **Close:** "Done: smash A and the spikes are in; the cracks and smash B are out." Resolve the marks it addressed.

### Marks as a queue

Human feedback (notes, picks, rejects, ink over an artifact) counts as an **open mark** until the agent addresses it. The canvas shows the count ("96 items · 0 open marks"), and resolved marks show a ✓. Judgement belongs to the human: agents read picks and rejects but do not set them.

### Gaps for Paired beyond the board

- **Converge:** branching by association sprawls. Paired needs a way to pull branches into a synthesis or conclusion.
- **Data and models:** the board is creative work. Research and analysis also need the ladder of abstraction, adjustable assumptions and stale-marking.
- **Learning:** picking from options suits working mode. Learning mode asks the human to generate first.

The research equivalent of "four character concepts" is several hypotheses, framings or *definitions* side by side, for example three definitions of "paying hirer", each with its own number and trend.

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

## Scratchbook visual language implemented: 2026-11-18

YC asked to replicate Thariq's board. The local canvas now has:

- Human/agent styling (pink handwriting and ink versus lavender ✦ cards and violet arrows).
- Human-only pick (P) and reject (X) marks drawn as rough ink.
- Image captions.
- An "items · open marks" counter.
- Marks in `read`, and `resolve` for any mark.
- MCP instructions describing the agent loop.

Verified live in Dia on a demo page with synthetic data: keyboard pick/reject, agent read-back, questions, a Done note and resolution to zero open marks. Detection of freehand pen ink over an object is implemented but was not exercised live, because synthetic pointer events did not produce a tldraw stroke. Not built: converging branches, learning mode, data widgets.

## Feedback queue and heuristics pass: 2026-11-26

YC asked to anchor the UX on Jakob Nielsen's ten heuristics and Michael Nielsen's augmentation ideas, and to be able to leave feedback inside the canvas as a native primitive. The audit, what was fixed and what remains are in `usability-heuristics.md`.

Built: one-key comments (C) on objects or on a spot on the board; a board-wide queue of comments, picks, rejects and ink with open/resolved state, shown in a Feedback tab with jump, resolve, reopen and Markdown/JSON export; `feedback` and `reply` agent operations (and MCP tools) alongside `resolve`; timestamps on new objects; live save state, an agent status chip, a lost-link banner and a shortcut sheet on `?`.

Verified in headless Chromium against the local dev server: each feedback action, an HTTP and an MCP read returning a comment just left, reply and resolve by an agent, reopen by the human, export, the queue across two pages, and persistence across reload. Not built: comments on part of an object, a human reply box, separate undo per author, a rejected tray, a working chip on objects, a command palette.

## Calm canvas and the Ask loop: 2026-11-26

YC tried the heuristics build and rejected it: hard to use, noisy, too flexible and open-ended, text ran off the board, and nothing showed how to get the agent to respond. The anchor moved from Jakob Nielsen's heuristics to the nine findings above plus Solveit; `principles.md` records what each demands, what is built and what is missing.

Built: a first board of three things with panels behind one menu; a five-tool strip; double-click to write; an action bar on the selection (Ask, Pick, Cross out, Comment); asks as board objects that show waiting, working, answered or failed and what the agent was given; a resident agent that answers asks with the local Claude Code CLI in about three seconds, with one short card or two to four alternatives; plain and pasted text wrapping at a reading width. An existing saved board is kept as its own page and the calm board opens beside it.

Verified in headless Chromium on a fresh profile with `packages/canvas/tools/verify-calm.mjs` (36 checks). Not built: learning mode, context pinning or hiding, streaming answers, images in context, listener presence on the hosted relay.
