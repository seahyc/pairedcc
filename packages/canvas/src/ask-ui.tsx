import { useEffect, useRef, useState } from "react";
import { startEditingShapeWithRichText, useEditor, useValue, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { agentListeners, agentLink, announceAsk } from "./agent-client";
import { askDirect, askOf, createAsk, describeAsk, retryAsk, shouldSend } from "./asks";
import { askStatusLine, isQuestion } from "./ask-rules";
import { richTextPlain, shapeName } from "./operations";
import { HUMAN, authorOf, toggleMark } from "./scratchbook";

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

export function sendAsk(editor: Editor, id: string) {
  const shape = editor.getShape(id as TLShapeId);
  if (shape) announceAsk(describeAsk(editor, shape));
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
    if (!shapes.length) return onNotice("Write a thought first: double-click the board. A question is sent as soon as you finish writing it.");
    const host = shapes.find((s) => authorOf(s) === HUMAN && textOf(s));
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
      editor.run(() => editor.deleteShapes([shape.id]), { history: "ignore" });
      return;
    }
    if (shouldSend(editor, shape)) sendCard(editor, shape.id, [], keepInView);
  }, [editing, editor, keepInView]);
  return null;
}

/** Page-space layer: each ask's state under it, and an outline around what the agent was given. */
export function AskLayer() {
  const editor = useEditor();
  const listeners = useValue("ask listeners", () => agentListeners.get(), []);
  const hosted = useValue("ask link mode", () => agentLink.get().mode === "hosted", []);
  const asks = useValue(
    "asks on page",
    () => {
      const selected = new Set<string>(editor.getSelectedShapeIds());
      return editor.getCurrentPageShapes().flatMap((s) => {
        const ask = askOf(s), b = editor.getShapePageBounds(s);
        if (!ask || !b) return [];
        const answers = editor.getCurrentPageShapes().filter((r) => r.meta.replyTo === s.id);
        const focused = selected.has(s.id) || answers.some((r) => selected.has(r.id)) || ask.state === "working";
        const outlines = focused
          ? ask.contextIds.flatMap((id) => {
              const box = editor.getShapePageBounds(id as TLShapeId);
              return box ? [{ id, x: box.x, y: box.y, w: box.w, h: box.h }] : [];
            })
          : [];
        return [{ id: s.id, ask, x: b.x, y: b.maxY, given: givenLabel(editor, ask.contextIds.filter((id) => id !== s.id)), outlines }];
      });
    },
    [editor],
  );
  const active = asks.some((a) => a.ask.state === "waiting" || a.ask.state === "working");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return (
    <div className="scratch-layer ask-layer">
      {asks.map((a) => {
        const line = askStatusLine(a.ask, { listeners: hosted ? listeners : (listeners ?? []), hosted, now: Math.max(now, Date.now()), given: a.given });
        return (
          <div key={a.id}>
            {a.outlines.map((o) => (
              <div key={o.id} className="ask-given" style={{ transform: `translate(${o.x - 6}px, ${o.y - 6}px)`, width: o.w + 12, height: o.h + 12 }} />
            ))}
            <div className={`ask-status ${line.tone}`} data-ask-state={a.ask.state} data-ask-tone={line.tone} style={{ transform: `translate(${a.x}px, ${a.y + 6}px)` }}>
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
                    retryAsk(editor, a.id);
                    sendAsk(editor, a.id);
                  }}
                >
                  {line.tone === "nobody" ? "Send again" : "Retry"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The next step, shown at the moment it is possible: a small bar on the selection with
 * Ask, Pick, Cross out and Comment. Ask sends what is written; there is no question box.
 */
export function SelectionBar({ onAsk, onComment }: { onAsk: () => void; onComment: () => void }) {
  const editor = useEditor();
  const state = useValue(
    "selection bar",
    () => {
      const shapes = editor.getSelectedShapes().filter((s) => s.type !== "arrow");
      const box = editor.getSelectionRotatedPageBounds();
      if (!shapes.length || !box || !editor.isInAny("select.idle", "select.editing_shape")) return null;
      const from = editor.pageToScreen({ x: box.x, y: box.y }), to = editor.pageToScreen({ x: box.maxX, y: box.maxY });
      const only = shapes.length === 1 ? shapes[0] : undefined;
      const mine = shapes.find((s) => authorOf(s) === HUMAN && textOf(s));
      return {
        x: Math.round(from.x),
        y: Math.round(from.y),
        bottom: Math.round(to.y),
        editing: Boolean(editor.getEditingShapeId()),
        picked: shapes.every((s) => s.meta.mark === "picked"),
        rejected: shapes.every((s) => s.meta.mark === "rejected"),
        blank: shapes.every((s) => "richText" in s.props && !textOf(s)),
        question: Boolean(only && authorOf(only) === HUMAN && (isQuestion(textOf(only)) || only.meta.askWhenWritten === true)),
        mine: Boolean(mine),
        asked: Boolean(mine && askOf(mine)),
      };
    },
    [editor],
  );
  if (!state) return null;
  const width = 330;
  const left = Math.max(70, Math.min(state.x, window.innerWidth - width - 16));
  const top = state.y - 50 > 52 ? state.y - 50 : state.bottom + 12;
  // Keys keep working after a click: the board takes the keyboard back.
  const judge = (mark: "picked" | "rejected") => {
    toggleMark(editor, editor.getSelectedShapes(), mark);
    editor.focus();
  };
  if (state.editing)
    return state.blank ? null : (
      <div className="selection-bar hint" style={{ left, top }}>
        {state.question ? (
          <>
            ✦ Goes to your agent when you finish · <kbd>Esc</kbd> or click away
          </>
        ) : (
          <>
            End with <kbd>?</kbd> and it is asked when you finish · <kbd>⌘↵</kbd> asks now
          </>
        )}
      </div>
    );
  return (
    <div className="selection-bar" style={{ left, top }} role="toolbar" aria-label="What next">
      <button
        className="primary"
        onClick={onAsk}
        title={state.mine ? "Send what you wrote to your agent (⌘↵)" : "Write a question beside this for your agent (⌘↵)"}
      >
        ✦ {state.mine ? (state.asked ? "Ask again" : "Ask") : "Ask about this"} <kbd>⌘↵</kbd>
      </button>
      <button className={state.picked ? "on" : ""} onClick={() => judge("picked")} title="Pick: this one (P)">
        Pick <kbd>P</kbd>
      </button>
      <button className={state.rejected ? "on" : ""} onClick={() => judge("rejected")} title="Cross out: not this (X)">
        Cross out <kbd>X</kbd>
      </button>
      <button onClick={onComment} title="Comment on it (C)">
        Comment <kbd>C</kbd>
      </button>
    </div>
  );
}
