# Canvas principles

This is the anchor for the thinking canvas. Every design choice answers to the nine findings YC endorsed in `working-spec.md` ("How humans think intuitively"), to "What produces understanding" and to the Solveit method. `usability-heuristics.md` (Jakob Nielsen's ten) is a secondary checklist for catching ordinary interface faults; it does not decide what the canvas is.

Status as of 26 Nov 2026, after the calm-canvas pass. "Does" means built and checked in a browser; "missing" means not built.

## The loop

Write a thought (pink, handwritten, yours) → select what you mean → Ask → the agent answers beside it on a short lavender card, or with two to four alternatives side by side → pick (P), cross out (X) or comment (C) → ask again. Each next step appears on the selection at the moment it is possible.

## The nine findings

| Finding | What it demands here | What the build does | Still missing |
|---|---|---|---|
| 1. Working memory holds about four things | Little on screen. Thinking goes onto the board, not into panels. | The first board holds three things. Layers, properties, the queue, page list and object counts are hidden until asked for from one menu. Five tools on the strip. An answer is one card or at most four options. | Nothing keeps a busy board to a few things in view: no collapsing a finished thread, no focus on one group. |
| 2. Moving things is thinking | Arranging must be free and never undone by the agent. | Everything drags. The agent places its answer under the ask and never moves, edits or rearranges the person's objects; the answer operation cannot. | The agent does not read meaning from arrangement (what is near what, what was grouped). |
| 3. Spatial thinking comes first | Position carries meaning: beside, under, inside. | An ask sits beside what it is about, joined by a hand-drawn arrow. Its answer sits under it. A frame around the selection becomes part of the ask's context. | No named regions beyond frames; no way to ask "about everything over here". |
| 4. We think with our eyes | Whose is what, and what state it is in, must be seen, not read. | Pink handwriting is the person, lavender print with ✦ is the agent. An ask shows its state in a line under it; what the agent was given is outlined on the board when the ask is selected or being worked on. Picks are boxed, crossed-out ideas are struck and faded but stay. | No overview of a large board; nothing shows which threads are settled. |
| 5. Concrete before abstract | Answers start from a case. | The resident agent's instructions require a concrete example or specific case first. | No data or examples can be pulled onto the board yet; the agent answers only from the text it is given. |
| 6. Comparing beats describing | Choices arrive as options side by side. | When the ask is a choice or asks for options, the answer is two to four cards in one row, lettered, each short. | Options cannot be compared on stated dimensions, and picking one does not carry it forward. |
| 7. Recognising beats recalling | Offer things to pick from; do not ask the person to produce from nothing. | Next actions are shown on the selection (Ask, Pick, Cross out, Comment) with their keys. The ask box offers three starter questions. Toolbar buttons carry their names. | Starters are fixed; they do not adapt to what is selected. |
| 8. Rough means unfinished | Thoughts and drafts look open to change. | Handwriting, marker arrows, hand-drawn ink, dot-grid paper. Agent answers are plain cards that can be edited, crossed out or deleted like anything else. No added chrome. | Nothing marks an idea as settled, so "rough" has no opposite yet. |
| 9. Understanding needs effort and repetition | Do not hand over a finished answer when the person should be doing the thinking. | The person writes first; the agent answers one step in about 60 words (cut at 90) and stops. A long answer cannot be placed through the answer operation. | No learning mode: no predict-then-check, retrieval or spaced return. Not built on purpose in this pass. |

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

Not borrowed yet: pinning or hiding objects from context, token counts, learning/concise/standard modes, ghost text, running code beside notes, undo per message.

## Not done in this pass

- Asks are answered only on a computer running the resident agent or another agent that waits for asks. On paired.cc an ask waits until a connected agent reads it; the hosted relay does not report who is listening.
- The resident agent sees text only: no images, drawings or the look of the board.
- Answers arrive whole after about three seconds; they are not streamed.
- One ask is about one selection on one page. An ask on a page that is not open fails with a message and a retry.
