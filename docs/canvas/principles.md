# Canvas principles

This is the anchor for the thinking canvas. Every design choice answers to the nine findings YC endorsed in `working-spec.md` ("How humans think intuitively"), to "What produces understanding" and to the Solveit method. `usability-heuristics.md` (Jakob Nielsen's ten) is a secondary checklist for catching ordinary interface faults; it does not decide what the canvas is.

Status as of 26 Nov 2026, after the calm-canvas pass; the table was brought up to date with the sprint merges through #110 the same evening (PR numbers in brackets). "Does" means built and checked in a browser; "missing" means not built.

## The loop

Write on the board (pink, handwritten, yours). The card is the question: end it with a question mark and it goes to the agent when you finish writing; any other card is sent as it stands with ⌘↵. There is no question box. The agent answers under the card on a short lavender card, reading what sits right beside the card too → pick (P), cross out (X) or write the next thing. To ask about something you did not write (an answer, imported material), Ask opens a pink card beside it and what you write there is sent. (Changed 26 Nov after YC's second playtest: the box made a written question into background and the chip became the ask.)

## The nine findings

| Finding | What it demands here | What the build does | Still missing |
|---|---|---|---|
| 1. Working memory holds about four things | Little on screen. Thinking goes onto the board, not into panels. | The first board holds three things. Layers, properties, the queue, page list and object counts are hidden until asked for from one menu. Five tools on the strip. An answer is one card or at most four options. | Nothing keeps a busy board to a few things in view: no collapsing a finished thread, no focus on one group. |
| 2. Moving things is thinking | Arranging must be free and never undone by the agent. | Everything drags. The agent places its answer under the ask and never moves, edits or rearranges the person's objects; the answer operation cannot. An agent connected over MCP reads arrangement: `canvas_overview` reports clusters of nearby objects (#47). | An ask gives the resident agent only the selection, its frame and the thread behind it, not what lies near it. |
| 3. Spatial thinking comes first | Position carries meaning: beside, under, inside. | An ask sits beside what it is about, joined by a hand-drawn arrow. Its answer sits under it. A frame around the selection becomes part of the ask's context, and an ask about a frame gives what it holds (#67). | No named regions beyond frames; no way to ask "about everything over here". |
| 4. We think with our eyes | Whose is what, and what state it is in, must be seen, not read. | Pink handwriting is the person, lavender print with ✦ is the agent. An ask shows its state in a line under it; what the agent was given is outlined on the board when the ask is selected or being worked on. Picks are boxed, crossed-out ideas are struck and faded but stay. | No overview of a large board; nothing shows which threads are settled. |
| 5. Concrete before abstract | Answers start from a case. | The resident agent's instructions require a concrete example or specific case first. Tables, documents, spreadsheets, PDFs and web pages come in by paste or drop as cards (see Bringing material in), and an ask about a chart or dataset gives what it shows (#86). | The agent cannot fetch an example itself; it answers only from what the ask gives it. |
| 6. Comparing beats describing | Choices arrive as options side by side. | When the ask is a choice or asks for options, the answer is two to four cards in one row, lettered, each short. Picks and cross-outs travel with every later ask, and the resident agent builds on picks and does not offer crossed-out ideas again (#64). Selecting several objects offers "What dimensions do these differ on?" (#42), and imported records can be set side by side (#55). | Answers are not laid out on stated dimensions. |
| 7. Recognising beats recalling | Offer things to pick from; do not ask the person to produce from nothing. | Next actions are shown on the selection (Ask, Pick, Cross out, Comment) with their keys. The ask box offers three starter questions chosen from the selection: several objects, a question, a frame, a chart, a dataset or an imported record each get their own (#42). Key hints name the person's own keys (#83) and a touch screen says tap (#88). Toolbar buttons carry their names. | Starters follow the kind of selection, not what it says. |
| 8. Rough means unfinished | Thoughts and drafts look open to change. | Handwriting, marker arrows, hand-drawn ink, dot-grid paper. Agent answers are plain cards that can be edited, crossed out or deleted like anything else. No added chrome. | Nothing marks an idea as settled, so "rough" has no opposite yet. |
| 9. Understanding needs effort and repetition | Do not hand over a finished answer when the person should be doing the thinking. | The person writes first; the agent answers one step in about 60 words (cut at 90) and stops. A long answer cannot be placed through the answer operation. | Check me (P5 part 1) is on every board, off until asked: on an agent's answer it puts the answer away while the person explains it from memory, then shows the two side by side to compare. Predict-then-check prompts an agent places are still a prototype (`?prototype=learning`, #6). No spaced return yet (P5 part 2, after the settled mark). |

## Bringing material in

Tables, documents and images arrive by paste, drop or an agent, and are laid out by rule: rows of prose become one cluster of cards per row, grids of numbers stay tables, prose becomes one card per section. The rules, which finding each serves and what is not handled are in [`import.md`](import.md). This is the first answer to finding 5's gap (data and examples could not be pulled onto the board) and part of finding 1's (one record in view at a time, with a stepper).

## What produces understanding

Reading an explanation creates familiarity, not understanding; the learner has to do the work (see the table in `working-spec.md`). Working is the default and must be seamless, so the effortful mechanisms stay opt-in and are not built. What this pass guarantees is the floor: the default flow never returns a long finished answer, the agent asks one short question back when an ask is ambiguous, and contrast cases (alternatives side by side) are a first-class kind of answer.

Missing: every mechanism in that table (predict then check, self-explanation, retrieval, spacing, manipulable models).

## Solveit

Sources: [the Solveit method](https://www.answer.ai/posts/2025-10-01-solveit-full.html) and [Solveit features](https://www.fast.ai/posts/2025-11-07-solveit-features.html) (Answer.AI, Jeremy Howard and Johno Whitaker).

| Solveit principle | In its words | Here |
|---|---|---|
| Small steps, each one checked | "small steps, deep understanding, and deep reflection" | One ask, one short answer, then the agent waits. The person judges it (P, X, C) before asking again. |
| The person writes first; the AI helps with one step | "You write one or two lines at a time, understand what they do" | Asks attach to something the person wrote or selected. There is no "generate a board" action in the default flow. |
| Short replies, not walls | "the AI will gently guide you to writing small steps rather than providing a big chunk" | About 60 words or two to four short alternatives; the cap is enforced by the canvas, not only requested in the prompt. |
| AI output is editable and is part of the context | "you can even edit past AI responses"; "The AI always sees the current state of your dialog, not the edit history" | An answer is an ordinary card. Edit it and ask about it: the agent is sent its current text and the exchange that led to it. |
| The context is visible and curated by the person | "the AI should be able to see everything exactly as the human does"; hidden messages "are excluded from AI context" | The agent is given exactly the selection, the frame it sits in and the thread behind it. The ask says what was given and outlines it. The agent runs with no tools, files or memory. |

Hiding objects from context is a prototype (`?prototype=context`, item 67): **Leave out** (L) on the selection bar keeps an object out of what asks give the agent, the board marks it "left out of asks", and the ask says how many were withheld; an object the person selects is still given. **Pin** (I) is its opposite (item 90): every ask on that page gives a pinned object, selected or not, the board fences it as "pinned · given to every ask", and the ask outlines it and says how many were pinned.

Not borrowed yet: token counts, learning/concise/standard modes, ghost text, running code beside notes, undo per message.

## Not done in this pass

- Asks are answered only on a computer running the resident agent or another agent that waits for asks. On paired.cc the relay reports who is listening only for accounts the resident agent serves; for any other account an ask says no agent is listening for it and waits until a connected agent reads it.
- The resident agent sees text only: no images, drawings or the look of the board.
- Answers arrive whole after about three seconds; they are not streamed.
- One ask is about one selection on one page. An answer goes under its ask on that page even when the person has opened another page; they are told who answered and on which page, and the notice's **Show** (G) opens that page with the answer selected beside its ask (item 85). The board never takes them there by itself.
