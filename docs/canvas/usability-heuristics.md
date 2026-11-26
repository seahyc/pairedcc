# Canvas usability audit

> **Secondary checklist.** The canvas is anchored on [`principles.md`](principles.md): the nine findings about how people think, what produces understanding, and the Solveit method. Jakob Nielsen's ten heuristics below are for catching ordinary interface faults after those are satisfied. Where the two disagree, `principles.md` wins. The audit below predates the calm-canvas pass of 26 Nov 2026; the Layers panel, Properties inspector and object counter it describes are now hidden by default.

Audit of the thinking canvas (`packages/canvas`) against Jakob Nielsen's ten usability heuristics, with Michael Nielsen's augmentation ideas as the second lens. Written 26 Nov 2026 for the `yc/heuristics-pass` branch.

How this was done: the local dev build was driven in headless Chromium at 1440×900, on a fresh browser profile (so the welcome board), by clicking and typing through the first few minutes of use: reading the welcome board, selecting, commenting, picking, rejecting, drawing with the pen, dropping notes, undoing, adding a page, reloading, and calling the local agent API against the open tab. Nobody other than the author used it; there is no user research behind this, and nothing below should be read as a finding about real users. "Today" means the state after this pass; what the pass changed is marked **(new)**. A few statements come from reading the code and were not exercised in the browser; they are marked *(code)*.

## The ten heuristics

### 1. Visibility of system status

- **Today:** The top bar shows "N items · M open marks", now counted across every page and clickable **(new)**. Save state is live: "Saving…" while you type, then "Saved on this device · 17:14" **(new)**; it used to be a fixed label. An agent chip shows "Agent ready", names the agent and operation for six seconds after each command ("✦ Test agent: resolve"), and turns red on a failed command or a lost link **(new)**. Open comments carry a pink pin; resolved marks carry a green ✓.
- **Worst gaps:** Nothing marks *which object* an agent is working on, and a long agent run shows no progress between commands. Nothing is ever marked stale. The save label is inferred from store changes; it does not confirm the write to browser storage. "Untitled exploration ⌄" and the "Local" badge look interactive and do nothing.
- **Should be:** A lavender "working" chip on the object an agent has claimed, with the run's name and a cancel. A stale badge on anything derived from an object that changed afterwards. A board title you can rename.

### 2. Match between the system and the real world

- **Today:** The scratchbook language holds up in use: pink handwritten scraps and ink for the person, lavender typed cards with ✦ for agents, a box around a pick, a cross through a reject, a loop of ink around something. A comment is a pink scrap pinned to the thing it is about **(new: one key, and it can sit on empty paper)**.
- **Worst gaps:** The Layers list reads like a debugger: frames named "6" and "5", rows called "Arrow". Properties ends with a raw object id and revision number. Three words cover one idea: "marks" in the top bar, "Feedback" on the panel, "comment" on the key.
- **Should be:** One word for the queue (pick "feedback" or "marks" and use it everywhere). Layer names from content. Identity and revision behind a disclosure meant for agents.

### 3. User control and freedom

- **Today:** Undo and redo work for everything tried. A comment, with its arrow and its text, undoes in one step. Each agent command is one undo step, and a multi-object scene is one step *(code)*. Picking or rejecting twice clears the mark *(code)*. A resolved item can be reopened by the person from the queue **(new)**. Esc leaves text editing, tools and dialogs. A comment left empty removes itself **(new)**.
- **Worst gaps:** The person and the agent share one undo stack, so ⌘Z after an agent writes undoes the agent's work, and repeated undo walks back through both interleaved *(code)*. There is no tray for rejected or removed things: reject fades in place, delete is gone apart from undo, and an agent can `remove` a person's object if it holds the current revision.
- **Should be:** Separate undo per author. A tray that receives rejected and agent-removed objects, so nothing the person made disappears because an agent decided so.

### 4. Consistency and standards

- **Today:** Tool keys follow Figma and tldraw (V, H, F, R, O, T, A, ⌘D, ⌘Z, Shift 1), and C for comment matches Figma. Right-click opens tldraw's own menu. Pink and lavender mean the same thing on the board and in the queue, where comments are set in the handwriting face and replies in the agent's **(new)**.
- **Worst gaps:** P is "pick" here and "pen" in Figma; X is "reject" here. Two visual systems sit side by side: the app chrome (grey, Inter) and tldraw's right-click menu.
- **Should be:** Keep P and X (they are the product), and say so in the shortcut sheet, which now exists. Restyle the context menu and add Comment, Pick and Reject to it.

### 5. Error prevention

- **Today:** Agent updates need the object's current revision, so an agent cannot overwrite an edit it has not seen, and locked objects reject agent changes *(code; covered by the existing API checks, not rerun today)*; a reply to something that is not a feedback item is refused with a reason (checked: HTTP 422). Agents have no operation that sets a pick or reject, and deleting a page asks first *(code)*.
- **Worst gaps:** Nothing makes an agent *propose beside* the original; with the right revision it can rewrite or remove a person's note. Typing a letter while a shape is selected can fire a tool or a mark (X rejects the selection) with only the drawn mark as a warning.
- **Should be:** Agent edits to human-authored objects land as a proposal next to the original until accepted. A toast with Undo after P or X.

### 6. Recognition rather than recall

- **Today:** Every open and resolved mark on the board is listed in one queue, with what it is about, the page, how long ago and any reply; clicking a row goes there **(new)**. Tool buttons show their key in the tooltip, and the idle Properties panel lists the main shortcuts.
- **Worst gaps:** Nothing appears *at the selection*: Comment, Pick and Reject are a key press or a trip to the side panel. On first load the welcome board is fitted at 47% zoom, so the tutorial text is small, and its fourth column starts under the right-hand panel. Agents are asked for side-by-side options only by the prompt text in their tool instructions; nothing in the canvas makes alternatives the default shape of an answer.
- **Should be:** A small action bar beside the selection (Comment, Pick, Reject, Ask). A first view that fits the board inside the space between the panels. A "set of alternatives" object that agents fill, so three or four options side by side is a primitive and not a habit.

### 7. Flexibility and efficiency of use

- **Today:** C comments on the selection or pins a comment under the pointer, and you are typing immediately; P and X judge; Shift C opens the queue; ? lists every shortcut **(new, except P and X)**. A note dropped with N now starts in typing mode; before, a single click left it unfocused and the next keystrokes switched tools **(fixed)**.
- **Worst gaps:** No command palette. No keyboard way through the queue (next open item, resolve, reply). No way to ask an agent from the board.
- **Should be:** ⌘K palette; J and K to step through open items with E to resolve; a selection-scoped "ask".

### 8. Aesthetic and minimalist design

- **Today:** The board itself is calm: paper, dot grid, two ink colours. Rough handwriting signals "unfinished".
- **Worst gaps:** The chrome is always on: two side panels take 476 of 1440 pixels and the board runs underneath them. Layers is open by default although a first-time user has no use for it. Agent cards always look finished, whatever their status.
- **Should be:** Panels that fade or collapse while drawing or typing; Layers closed by default; a visibly rough style for agent output until something is picked.

### 9. Help users recognise, diagnose and recover from errors

- **Today:** A failed agent command turns the chip red for six seconds with the reason in its tooltip **(new)**. Losing the local server shows a banner saying agents cannot reach the board and that work is still saved (checked by stopping the service) **(new)**. Other errors are toasts that vanish after 3.5 seconds.
- **Worst gaps:** A failed run leaves nothing on the board, so a failure the person did not happen to watch is invisible. Toasts cannot be reread. If the tab is closed, the agent's error ("Open Paired in a browser first") reaches only the agent.
- **Should be:** A failure card where the result would have gone, with the reason and a retry. A log of agent activity that can be opened from the chip.

### 10. Help and documentation

- **Today:** The welcome board is the tutorial and shows the loop working. ? opens a shortcut sheet with a one-line explanation of pink, lavender and the queue **(new)**; the empty queue explains C, P and X **(new)**.
- **Worst gaps:** The welcome board mentions C only on boards created from now on; existing boards keep the old text. The tutorial's "ask your agent" steps dead-end if no agent is connected, and connecting one is a modal of configuration.
- **Should be:** A welcome board that asks you to do each step and ticks it off, and a built-in assistant so the loop works with nothing connected.

## Michael Nielsen's augmentation lens

Carter and Nielsen ("Using Artificial Intelligence to Augment Human Intelligence", Distill, 2017) separate two uses of AI: *cognitive outsourcing*, where the machine returns an answer you take on trust, and *cognitive transformation*, where it changes the operations and representations you think with. Their examples are interfaces in which the model's internal structure becomes something you grab and move, and they argue the test of such a tool is whether you internalise it. Matuschak and Nielsen ("How can we develop transformative tools for thought?", 2019) add that such tools come from deep work on one serious use, not from general features, and that reading an explanation is not the same as understanding it.

What that implies here, measured against the prototype:

1. **Agent output should be a thing to manipulate, not text to read.** Today most agent output is a lavender card of prose. The good case already on the welcome board is three palettes side by side that you pick from. Options, ranges and assumptions should arrive as objects with handles: alternatives you reorder and merge, a number you drag, a claim you can cross out and have dependents react.
2. **Judging is a primitive, so make the whole judgement vocabulary first-class.** Pick, reject, comment and ink are operations the person performs on the agent's representation, and the queue makes them something the agent must answer. The next operations are "combine these two", "more like this" and "why", each as a mark, not a prompt.
3. **Keep the person's representation and the agent's distinct.** Pink and lavender do this visually. The agent API does it only partly: agents cannot pick or reject, but they can rewrite or delete human notes. Proposals beside the original would make the distinction hold in behaviour too.
4. **Aim at internalisation.** A reply the person only reads is outsourcing. Where understanding is the goal, the agent should ask for a prediction or a choice before it reveals its view (the spec's learning mode); nothing of this exists yet.
5. **Earn it on one real task.** The feedback queue was built for a real use, reviewing this prototype from inside it. The next primitive should be forced by the next real session in the same way.

## What this pass fixed, ranked

1. **Feedback as a first-class primitive.** C leaves a comment on the selection (one or several objects) or on empty paper under the pointer and starts typing; an empty one removes itself. Comments, picks, rejects and ink form one queue across all pages, with a count in the top bar and on the panel tab.
2. **A visible queue.** The Feedback tab lists items with their target, page, age and replies; click to jump (switching page if needed); resolve or reopen; filter by open, resolved or all; export as Markdown (copy or file) or JSON.
3. **Agents read and answer it.** `feedback` returns the whole queue in one call (text, target ids and names, position, author, state, created, updated and resolved times, replies); `reply` answers an item in place; `resolve` now works on any page and records who resolved and when. Both are MCP tools (`canvas_feedback`, `canvas_reply`) and are in the hosted manifest. `pnpm --filter @pairedcc/canvas feedback` prints the queue from the open tab.
4. **Status you can see:** live save state, agent chip with last action and failures, banner when the local link drops.
5. **Shortcut sheet** on ? and from a button by the zoom controls.
6. **Notes start in typing mode** when dropped with a single click.
7. **New comments stay in view:** the board pans so a new comment is not created under a side panel.
8. Timestamps on new objects (`createdAt`, and `updatedAt` when text changes), which the queue and export use.

## What remains, ranked

1. Action bar at the selection (Comment, Pick, Reject), so the loop needs no memorised keys.
2. Separate undo for the person and the agent; a tray for rejected and removed things.
3. A "working" chip on the object an agent has claimed, and a failure card with retry where a result was expected.
4. Agent edits to human objects as proposals beside the original.
5. Alternatives as a primitive that agents fill with three or four options.
6. Command palette and keyboard navigation of the queue; a human reply box in the queue (today the person replies by commenting on the agent's reply).
7. Chrome that gets out of the way; first view fitted between the panels; Layers closed by default.
8. One name for the queue across top bar, panel and API (`marks` in `read` and `feedback` now overlap).
9. Comments on a part of an object (a region of an image, a range of text) and on a dragged region of the board; today a comment targets whole objects or a point.
10. Replies and comments do not move with their target; they keep their arrow but stay where they were placed.
11. Stale badges; a rough style for unpicked agent output; a renameable board title.

Not checked in this pass: touch and stylus input, narrow screens, the hosted relay on paired.cc (only the local dev relay was exercised), and screen-reader use of the queue.
