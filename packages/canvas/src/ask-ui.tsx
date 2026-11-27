import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { atom, startEditingShapeWithRichText, useEditor, useValue, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { agentActivity, agentListeners, agentLink, announceAsk, chatAgentActivity } from "./agent-client";
import { askDirect, askOf, createAsk, describeAsk, retryAsk, shouldSend, writtenByPerson } from "./asks";
import { announceState, askAnnouncement, askStatusLine, isQuestion, liveText, optionsInLatestRound, retryLabel, BAR_MARGIN, placeBar, statusWidth } from "./ask-rules";
import { sourceOf } from "./import-meta";
import { bringCited, citedBy, selectedRecords, sideBySide } from "./import-board";
import { richTextPlain, shapeName } from "./operations";
import { toggleMark } from "./scratchbook";
import { isLeftOut, isPinned, leftOutLabel, pinnedLabel, toggleLeftOut, togglePinned } from "./leave-out";
import { toggleSettled } from "./settled";
import { foldLine, isFoldedNow, threadFinished, toggleFold } from "./fold";
import { prototypeEnabled } from "./prototype-flags";
import { TOUCH, keys } from "./keys";
import { checkable, startCheck } from "./learning/check-ui";

/** A key cap, left out on a touch screen where it names a key nobody has. */
const Kbd = ({ children }: { children: string }) => (TOUCH ? null : <kbd>{children}</kbd>);

const textOf = (s: TLShape) => ("richText" in s.props ? richTextPlain(s.props.richText).trim() : "");
const short = (text: string, max = 28) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** "your card “Charge per seat…” + 1 more + frame “Pricing”": what the agent was handed. */
function givenLabel(editor: Editor, ids: string[]) {
  const shapes = ids.flatMap((id) => editor.getShape(id as TLShapeId) ?? []);
  const frames = shapes.filter((s) => s.type === "frame"), things = shapes.filter((s) => s.type !== "frame");
  if (!shapes.length) return "";
  const first = things[0] ? `“${short(textOf(things[0]) || shapeName(things[0]))}”` : "nothing";
  return `${first}${things.length > 1 ? ` + ${things.length - 1} more` : ""}${frames[0] ? ` + frame “${short(shapeName(frames[0]), 20)}”` : ""}`;
}

/** "“card” + 1 pinned · 1 left out", or just "1 pinned" when nothing else is given. */
function givenWith(base: string, pins: string, kept: string) {
  const main = [base, pins].filter(Boolean).join(" + ");
  return [main, kept].filter(Boolean).join(" · ");
}

export function sendAsk(editor: Editor, id: string) {
  const shape = editor.getShape(id as TLShapeId);
  if (shape) announceAsk(describeAsk(editor, shape));
}

/**
 * The one selected ask that can be sent again (failed, went quiet, or not heard), with the
 * word its state line uses: Retry or Send again. Reads the same signals as the state line.
 */
/**
 * A clock the selection bar reads, so an ask that goes quiet while selected turns its first
 * button to Retry when its state line does. It ticks only while a selected ask is waiting or
 * working.
 */
export const askClock = atom("ask clock", Date.now());

export function selectedRetry(editor: Editor, now = Date.now()): { id: string; label: "Retry" | "Send again" } | undefined {
  const shapes = editor.getSelectedShapes().filter((s) => s.type !== "arrow");
  const ask = shapes.length === 1 ? askOf(shapes[0]) : undefined;
  if (!ask) return undefined;
  const listeners = agentListeners.get(), hosted = agentLink.get().mode === "hosted";
  const line = askStatusLine(ask, { listeners: hosted ? listeners : (listeners ?? []), hosted, now, given: "", recent: chatAgentActivity(agentActivity.get()) });
  const label = retryLabel(line);
  return label ? { id: shapes[0].id, label } : undefined;
}

/** Send an ask again as a new attempt. */
export function resendAsk(editor: Editor, id: string) {
  retryAsk(editor, id);
  sendAsk(editor, id);
}

/** The folded line spans what it folds (the ask and its answers), within readable limits. */
function foldWidth(ask: { x: number; w: number }, answers: { maxX: number }[]) {
  const span = Math.max(ask.x + ask.w, ...answers.map((a) => a.maxX)) - ask.x;
  return Math.round(Math.min(560, Math.max(320, span)));
}
type Outline = { id: string; x: number; y: number; w: number; h: number };
type Group = { x: number; y: number; w: number; h: number; count: number };
/** Page-space layer: each ask's state under it, and an outline around what the agent was given. */
export function AskLayer() {
  const editor = useEditor();
  const listeners = useValue("ask listeners", () => agentListeners.get(), []);
  const hosted = useValue("ask link mode", () => agentLink.get().mode === "hosted", []);
  const recent = useValue("ask recent agent", () => chatAgentActivity(agentActivity.get()), []);
  const asks = useValue(
    "asks on page",
    () => {
      const selected = new Set<string>(editor.getSelectedShapeIds());
      // Counting what was kept back reads each ask's whole context, so only on a page that has a left-out object.
      const anyLeftOut = editor.getCurrentPageShapes().some((s) => isLeftOut(s.meta));
      // Likewise pins: an ask gives what is pinned now, so its outline and label follow the pins.
      const anyPinned = editor.getCurrentPageShapes().some((s) => isPinned(s.meta));
      return editor.getCurrentPageShapes().flatMap((s) => {
        // Most objects are not asks: skip them before parsing or measuring.
        if (!s.meta.ask) return [];
        const ask = askOf(s), b = editor.getShapePageBounds(s);
        if (!ask || !b) return [];
        const answers = editor.getCurrentPageShapes().filter((r) => r.meta.replyTo === s.id);
        // A finished thread folded away is one line where its question was: nothing else is drawn.
        const finished = threadFinished(s.meta, answers.map((r) => r.meta));
        if (isFoldedNow(editor, s))
          return [{ id: s.id, ask, question: textOf(s), answers: 0, x: b.x, y: b.y, w: foldWidth(b, answers.flatMap((r) => editor.getShapePageBounds(r) ?? [])), given: "", outlines: [] as Outline[], group: undefined as Group | undefined, finished, fold: foldLine(textOf(s), answers.map((r) => ({ text: textOf(r), meta: r.meta }))) }];
        const focused = selected.has(s.id) || answers.some((r) => selected.has(r.id)) || ask.state === "working";
        const view = focused || anyLeftOut || anyPinned ? describeAsk(editor, s) : undefined;
        const pinnedIds = view?.pinned?.map((p) => p.id) ?? [];
        const outlines = focused
          ? [...ask.contextIds, ...pinnedIds].flatMap((id) => {
              const box = editor.getShapePageBounds(id as TLShapeId);
              return box ? [{ id, x: box.x, y: box.y, w: box.w, h: box.h }] : [];
            })
          : [];
        // While the ask is in view of the person (selected or being answered), the group its card
        // sits in is drawn as one soft outline: the agent is given it, so the person sees it.
        const groupIds = focused ? (view?.cluster ?? []).map((m) => m.id) : [];
        const groupBoxes = groupIds.length ? [s.id, ...groupIds].flatMap((id) => editor.getShapePageBounds(id as TLShapeId) ?? []) : [];
        const group = groupBoxes.length
          ? (() => {
              const x = Math.min(...groupBoxes.map((g) => g.x)), y = Math.min(...groupBoxes.map((g) => g.y));
              return { x, y, w: Math.max(...groupBoxes.map((g) => g.maxX)) - x, h: Math.max(...groupBoxes.map((g) => g.maxY)) - y, count: groupIds.length + (view?.clusterMore ?? 0) };
            })()
          : undefined;
        // What the person kept back from this ask, as an agent reading it now would be given it.
        const kept = anyLeftOut && view ? leftOutLabel(view.leftOut ?? 0) : "";
        const pins = anyPinned && view ? pinnedLabel(pinnedIds.length + (view.pinnedMore ?? 0)) : "";
        const groupSaid = group ? `${group.count} more in its group` : "";
        const base = [givenLabel(editor, ask.contextIds.filter((id) => id !== s.id)), groupSaid].filter(Boolean).join(" + ");
        return [{ id: s.id, ask, question: textOf(s), answers: optionsInLatestRound(answers.map((r) => ({ answeredAt: typeof r.meta.answeredAt === "number" ? r.meta.answeredAt : undefined, at: typeof r.meta.createdAt === "number" ? r.meta.createdAt : undefined }))), x: b.x, y: b.maxY, w: b.w, given: givenWith(base, pins, kept), outlines, group, finished, fold: undefined as ReturnType<typeof foldLine> | undefined }];
      });
    },
    [editor],
  );
  // Each change of an ask's state is said once in a polite live region; the state lines tick
  // every second, so they are not live themselves. Asks already there when this page opened
  // (or when the person changes page) are the baseline, not news.
  const pageId = useValue("ask page", () => editor.getCurrentPageId(), [editor]);
  const heard = useRef<{ page: string; states: Map<string, string> } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const active = asks.some((a) => a.ask.state === "waiting" || a.ask.state === "working");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => {
    // An agent that goes quiet past the timeout is news too (its line then offers Retry).
    const at = Math.max(now, Date.now());
    const states = new Map(asks.map((a) => [a.id, announceState(a.ask, at)]));
    if (!heard.current || heard.current.page !== pageId) {
      heard.current = { page: pageId, states };
      return;
    }
    const said = asks.flatMap((a) => askAnnouncement(heard.current!.states.get(a.id), { ...a.ask, state: states.get(a.id) ?? a.ask.state, question: a.question }, a.answers) ?? []);
    heard.current.states = states;
    // The same words twice in a row still have to change the region to be said.
    if (said.length) setAnnouncement((previous) => liveText(previous, said.join(" ")));
  }, [asks, pageId, now]);
  return (
    <div className="scratch-layer ask-layer">
      {createPortal(
        <div className="visually-hidden" role="status" aria-live="polite" data-ask-announcer>
          {announcement}
        </div>,
        document.body,
      )}
      {asks.map((a) => {
        if (a.fold)
          return (
            <button
              key={a.id}
              type="button"
              className="fold-line"
              data-fold-line={a.id}
              aria-expanded={false}
              title="Unfold this thread"
              style={{ transform: `translate(${a.x}px, ${a.y}px)`, width: a.w }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                toggleFold(editor, a.id);
              }}
            >
              <span className="fold-q">{a.fold.question}</span>
              <span className="fold-a">{a.fold.answer ? `✓ ${a.fold.answer}` : "✓ settled"}</span>
              {a.fold.more > 0 && <span className="fold-more" aria-label={`${a.fold.more} more folded`}>+{a.fold.more}</span>}
            </button>
          );
        const line = askStatusLine(a.ask, { listeners: hosted ? listeners : (listeners ?? []), hosted, now: Math.max(now, Date.now()), given: a.given, recent });
        return (
          <div key={a.id}>
            {a.group && (
              <div className="ask-group" data-ask-group={a.id} style={{ transform: `translate(${a.group.x - 18}px, ${a.group.y - 18}px)`, width: a.group.w + 36, height: a.group.h + 36 }} />
            )}
            {a.outlines.map((o) => (
              <div key={o.id} className="ask-given" style={{ transform: `translate(${o.x - 6}px, ${o.y - 6}px)`, width: o.w + 12, height: o.h + 12 }} />
            ))}
            <div className={`ask-status ${line.tone}`} data-ask-state={a.ask.state} data-ask-tone={line.tone} style={{ transform: `translate(${a.x}px, ${a.y + 6}px)`, maxWidth: statusWidth(a.w) }}>
              {(line.tone === "working" || line.tone === "waiting") && <span className="ask-pulse" />}
              <span>
                {line.tone === "working" || line.tone === "done" ? "✦ " : ""}
                {line.text}
                {line.tone !== "done" && line.tone !== "failed" && line.tone !== "nobody" && a.given ? ` · with ${a.given}` : ""}
              </span>
              {line.retry && (
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    resendAsk(editor, a.id);
                  }}
                >
                  {line.tone === "nobody" ? "Send again" : "Retry"}
                </button>
              )}
              {a.finished && (
                <button
                  className="fold-button"
                  data-fold={a.id}
                  aria-expanded={true}
                  title="Fold this thread to one line"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFold(editor, a.id);
                  }}
                >
                  Fold
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type Box = { x: number; y: number; maxX: number; maxY: number };

/** Send a card to the agent as it stands, and bring the room for its answer into view. */
function sendCard(editor: Editor, hostId: string, otherIds: string[], keepInView: (box: Box) => void) {
  const id = askDirect(editor, hostId, otherIds);
  sendAsk(editor, id);
  const box = editor.getShapePageBounds(id as TLShapeId);
  if (box) keepInView({ x: box.x, y: box.y, maxX: box.maxX + 60, maxY: box.maxY + 240 });
}

/**
 * Ask, with no box in between. A card the person wrote is sent as it is. For anything else
 * (an agent's answer, imported material) a pink card opens beside it to write the question on.
 */
export function askSelection(editor: Editor, onNotice: (text: string) => void, keepInView: (box: Box) => void) {
  try {
    const editing = editor.getEditingShapeId();
    if (editing) {
      editor.complete();
      editor.setCurrentTool("select");
      editor.select(editing);
    }
    const shapes = editor.getSelectedShapes().filter((s) => s.type !== "arrow");
    if (!shapes.length) return onNotice("Write a thought first. A question is sent as soon as you finish writing it.");
    const host = shapes.find((s) => writtenByPerson(s) && textOf(s) && !sourceOf(s));
    if (host) {
      sendCard(editor, host.id, shapes.map((s) => s.id), keepInView);
      editor.selectNone();
    } else {
      const id = createAsk(editor, { targetIds: shapes.map((s) => s.id) });
      editor.setCurrentTool("select");
      editor.select(id);
      const box = editor.getShapePageBounds(id);
      if (box) keepInView(box);
      startEditingShapeWithRichText(editor, id, { selectAll: true });
    }
    editor.focus();
  } catch (error) {
    onNotice(error instanceof Error ? error.message : "Could not ask");
  }
}

/** Writing is asking: when the person finishes a card that is a question, it goes to the agent. */
export function AutoAsk({ keepInView }: { keepInView: (box: Box) => void }) {
  const editor = useEditor();
  const editing = useValue("editing shape", () => editor.getEditingShapeId(), [editor]);
  const last = useRef<TLShapeId | null>(null);
  useEffect(() => {
    const done = last.current;
    last.current = editing;
    if (!done || done === editing) return;
    const shape = editor.getShape(done);
    if (!shape) return;
    if (shape.meta.askWhenWritten === true && !askOf(shape) && !textOf(shape)) {
      // Its arrows to what it was about go with it: an empty question leaves nothing behind.
      const arrows = editor.getBindingsInvolvingShape(shape.id).map((b) => b.fromId).filter((id) => id !== shape.id);
      editor.run(() => editor.deleteShapes([shape.id, ...arrows]), { history: "ignore" });
      return;
    }
    if (shouldSend(shape)) sendCard(editor, shape.id, [], keepInView);
  }, [editing, editor, keepInView]);
  return null;
}

/**
 * The next step, shown at the moment it is possible: a small bar on the selection with
 * Ask, Pick, Cross out and Comment. Ask sends what is written; there is no question box.
 */
export function SelectionBar({ asking, setAsking, onComment, onNotice, keepInView }: {
  asking: boolean;
  setAsking: (open: boolean) => void;
  onComment: () => void;
  onNotice: (text: string) => void;
  keepInView: (box: { x: number; y: number; maxX: number; maxY: number }) => void;
}) {
  const editor = useEditor();
  const state = useValue(
    "selection bar",
    () => {
      const shapes = editor.getSelectedShapes().filter((s) => s.type !== "arrow");
      const box = editor.getSelectionRotatedPageBounds();
      if (!shapes.length || !box || !editor.isInAny("select.idle", "select.editing_shape")) return null;
      const from = editor.pageToScreen({ x: box.x, y: box.y }), to = editor.pageToScreen({ x: box.maxX, y: box.maxY });
      const only = shapes.length === 1 ? shapes[0] : undefined;
      return {
        // A failed or unheard ask: the first button sends it again.
        retry: selectedRetry(editor, Math.max(askClock.get(), Date.now()))?.label ?? "",
        // A selected ask still in progress: the clock ticks so going quiet shows on the bar.
        pending: Boolean(only && ["waiting", "working"].includes(askOf(only)?.state ?? "")),
        ids: shapes.map((s) => s.id).join(","),
        x: Math.round(from.x),
        y: Math.round(from.y),
        bottom: Math.round(to.y),
        editing: Boolean(editor.getEditingShapeId()),
        picked: shapes.every((s) => s.meta.mark === "picked"),
        rejected: shapes.every((s) => s.meta.mark === "rejected"),
        settled: shapes.every((s) => s.meta.settled === true),
        leftOut: shapes.every((s) => isLeftOut(s.meta)),
        pinned: shapes.every((s) => isPinned(s.meta)),
        text: only ? textOf(only) : "",
        blank: shapes.every((s) => "richText" in s.props && !textOf(s)),
        question: Boolean(only && writtenByPerson(only) && (isQuestion(textOf(only)) || only.meta.askWhenWritten === true)),
        mine: shapes.some((s) => writtenByPerson(s) && textOf(s) && !sourceOf(s)),
        asked: shapes.some((s) => writtenByPerson(s) && Boolean(askOf(s))),
        // One agent answer: the person can ask to be checked on it (explain it, then compare).
        check: Boolean(checkable(editor)),
        // One record that cites sections of an imported document: they can be brought beside it.
        cites: (() => {
          const records = selectedRecords(editor);
          return records.length === 1 ? citedBy(editor, records[0]).found : [];
        })().join(" "),
        // Exactly two records of one import: they can be put side by side to compare.
        pair: (() => {
          const records = selectedRecords(editor);
          return records.length === 2 && sourceOf(records[0])?.importId === sourceOf(records[1])?.importId;
        })(),
      };
    },
    [editor],
  );
  // The bar's real width (it depends on its labels and font), measured after each render, so
  // placing it never assumes a size it does not have.
  const bar = useRef<HTMLElement | null>(null);
  const setBar = (el: HTMLElement | null) => {
    bar.current = el;
  };
  const [measured, setMeasured] = useState(0);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [viewWidth, setViewWidth] = useState(() => window.innerWidth);
  useLayoutEffect(() => {
    const w = bar.current?.offsetWidth ?? 0;
    if (w && w !== measured) setMeasured(w);
    const h = bar.current?.offsetHeight ?? 0;
    if (h && h !== measuredHeight) setMeasuredHeight(h);
  });
  useEffect(() => {
    const onResize = () => setViewWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const pending = Boolean(state?.pending);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => askClock.set(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [pending]);
  // There is no question box any more: "asking" means send what is selected now.
  useEffect(() => {
    if (!asking) return;
    setAsking(false);
    askSelection(editor, onNotice, keepInView);
  }, [asking, setAsking, editor, onNotice, keepInView]);
  if (!state) return null;

  // The Ask box asks for 430 px; the bar is as wide as its buttons. Both narrow to the window.
  // The Ask box keeps its usual place; the bar is lifted by its real height when its buttons wrap.
  const placed = placeBar(state, measured || 380, viewWidth, state.editing ? undefined : measuredHeight || undefined);
  const { left, width } = placed;
  // A selection taller than the screen (two records far apart) keeps the bar on screen
  // instead of pushing it out of reach.
  const top = Math.max(52, Math.min(placed.top, window.innerHeight - 64));
  // Keys keep working after a click: the board takes the keyboard back.
  const judge = (mark: "picked" | "rejected") => {
    toggleMark(editor, editor.getSelectedShapes(), mark);
    editor.focus();
  };
  const bringSources = () => {
    const [record] = selectedRecords(editor);
    const result = record ? bringCited(editor, record) : { ok: false as const, reason: "Select one record." };
    if (!result.ok) onNotice(result.reason);
    else if (result.missing.length) onNotice(`Not on this page: ${result.missing.join(", ")}`);
    editor.focus();
  };
  const compare = () => {
    const [a, b] = selectedRecords(editor);
    const result = a && b ? sideBySide(editor, a, b) : { ok: false as const, reason: "Select two records to see them side by side." };
    if (!result.ok) onNotice(result.reason);
    editor.focus();
  };
  const askAboutWriting = () => askSelection(editor, onNotice, keepInView);
  if (state.editing) {
    if (state.blank) return null;
    // On a touch screen the hint is the way to ask: no keyboard shortcut can be pressed.
    if (TOUCH)
      return (
        <button
          ref={setBar}
          className="selection-bar hint tappable"
          style={{ left, top, maxWidth: viewWidth - 2 * BAR_MARGIN }}
          onPointerDown={(e) => {
            // Act on the press, before the text editor loses focus and the bar changes under the finger.
            e.preventDefault();
            e.stopPropagation();
            askAboutWriting();
          }}
          // A screen reader or switch activates a button with a click and no pointer press.
          onClick={askAboutWriting}
        >
          ✦ {state.question ? "Ask now" : "Ask this"}
        </button>
      );
    return (
      <div ref={setBar} className="selection-bar hint" style={{ left, top, maxWidth: viewWidth - 2 * BAR_MARGIN }}>
        {state.question ? (
          <>✦ Goes to your agent when you finish · <kbd>Esc</kbd> or click away</>
        ) : (
          <>End with <kbd>?</kbd> and it is asked when you finish · <kbd>{keys("⌘↵")}</kbd> asks now</>
        )}
      </div>
    );
  }
  return (
    <div ref={setBar} className="selection-bar" style={{ left, top, maxWidth: viewWidth - 2 * BAR_MARGIN }} role="toolbar" aria-label="What next">
      {state.retry ? (
        <button
          className="primary"
          onClick={() => {
            const retry = selectedRetry(editor);
            if (retry) resendAsk(editor, retry.id);
            editor.focus();
          }}
          title={keys(`${state.retry}: send this ask to your agent again (⌘↵)`)}
        >
          ↻ {state.retry} <Kbd>{keys("⌘↵")}</Kbd>
        </button>
      ) : (
        <button
          className="primary"
          onClick={() => askSelection(editor, onNotice, keepInView)}
          title={keys(state.mine ? "Send what you wrote to your agent (⌘↵)" : "Write a question beside this for your agent (⌘↵)")}
        >
          ✦ {state.mine ? (state.asked ? "Ask again" : "Ask") : "Ask about this"} <Kbd>{keys("⌘↵")}</Kbd>
        </button>
      )}
      <button className={state.picked ? "on" : ""} onClick={() => judge("picked")} title="Pick: this one (P)">
        Pick <Kbd>P</Kbd>
      </button>
      <button className={state.rejected ? "on" : ""} onClick={() => judge("rejected")} title="Cross out: not this (X)">
        Cross out <Kbd>X</Kbd>
      </button>
      <button className={state.settled ? "on" : ""} onClick={() => { toggleSettled(editor, editor.getSelectedShapes()); editor.focus(); }} title={state.settled ? "Reopen: not settled after all (S)" : "Settle: done for now (S)"}>
        {state.settled ? "Settled ✓" : "Settle"} <Kbd>S</Kbd>
      </button>
      <button onClick={onComment} title="Comment on it (C)">
        Comment <Kbd>C</Kbd>
      </button>
      {state.check && (
        <button onClick={() => startCheck(editor, onNotice, keepInView)} title="Check me: put the answer away, explain it from memory, then compare (E; one undo)">
          Check me <Kbd>E</Kbd>
        </button>
      )}
      {prototypeEnabled("context") && (
        <button
          className={state.leftOut ? "on" : ""}
          onClick={() => {
            toggleLeftOut(editor, editor.getSelectedShapes());
            editor.focus();
          }}
          title={state.leftOut ? "Bring back: asks about things nearby may give this to the agent again (L)" : "Leave out: asks about things nearby will not give this to the agent (L)"}
        >
          {state.leftOut ? "Bring back" : "Leave out"} <Kbd>L</Kbd>
        </button>
      )}
      {prototypeEnabled("context") && (
        <button
          className={state.pinned ? "on" : ""}
          onClick={() => {
            togglePinned(editor, editor.getSelectedShapes());
            editor.focus();
          }}
          title={state.pinned ? "Unpin: asks give this only when it is selected or nearby (I)" : "Pin: every ask on this page gives this to the agent, selected or not (I)"}
        >
          {state.pinned ? "Unpin" : "Pin"} <Kbd>I</Kbd>
        </button>
      )}
      {state.cites && (
        <button onClick={bringSources} title={`Bring the sections this record cites (${state.cites.split(" ").join(", ")}) beside it, linked by arrows (one undo)`}>
          Show {state.cites.split(" ").join(", ")}
        </button>
      )}
      {state.pair && (
        <button onClick={compare} title="Put these two records next to each other, the same columns lined up (one undo)">
          Side by side
        </button>
      )}
    </div>
  );
}
