import { useEffect, useRef, useState } from "react";
import { useEditor, useValue, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { agentActivity, agentListeners, agentLink, announceAsk, chatAgentActivity } from "./agent-client";
import { askOf, createAsk, describeAsk, retryAsk } from "./asks";
import { askStatusLine, startersFor, suggestQuestion } from "./ask-rules";
import { sourceOf } from "./import-meta";
import { richTextPlain, shapeName } from "./operations";
import { toggleMark } from "./scratchbook";

const textOf = (s: TLShape) => ("richText" in s.props ? richTextPlain(s.props.richText).trim() : "");
const short = (text: string, max = 28) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** "your card “Charge per seat…” + 1 more + frame “Pricing”": what the agent was handed. */
function givenLabel(editor: Editor, ids: string[]) {
  const shapes = ids.flatMap((id) => editor.getShape(id as TLShapeId) ?? []);
  const frames = shapes.filter((s) => s.type === "frame"), things = shapes.filter((s) => s.type !== "frame");
  const first = things[0] ? `“${short(textOf(things[0]) || shapeName(things[0]))}”` : "nothing";
  return `${first}${things.length > 1 ? ` + ${things.length - 1} more` : ""}${frames[0] ? ` + frame “${short(shapeName(frames[0]), 20)}”` : ""}`;
}

export function sendAsk(editor: Editor, id: string) {
  const shape = editor.getShape(id as TLShapeId);
  if (shape) announceAsk(describeAsk(editor, shape));
}

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
        return [{ id: s.id, ask, x: b.x, y: b.maxY, given: givenLabel(editor, ask.contextIds), outlines }];
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
        const line = askStatusLine(a.ask, { listeners: hosted ? listeners : (listeners ?? []), hosted, now: Math.max(now, Date.now()), given: a.given, recent });
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
                {line.tone !== "done" && line.tone !== "failed" && line.tone !== "nobody" ? ` · given ${a.given}` : ""}
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
 * Ask, Pick, Cross out and Comment. Ask opens a one-line question box in place.
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
        ids: shapes.map((s) => s.id).join(","),
        x: Math.round(from.x),
        y: Math.round(from.y),
        bottom: Math.round(to.y),
        editing: Boolean(editor.getEditingShapeId()),
        picked: shapes.every((s) => s.meta.mark === "picked"),
        rejected: shapes.every((s) => s.meta.mark === "rejected"),
        text: only ? textOf(only) : "",
                blank: shapes.every((s) => "richText" in s.props && !textOf(s)),
        // An imported record keeps its own starters; anything else gets ones that fit the selection.
        starters: startersFor(
          shapes.map((s) => ({ type: s.type, text: textOf(s) })),
          shapes.some((s) => ["record", "title", "field"].includes(sourceOf(s)?.kind ?? "")),
        ).join("\n"),
      };
    },
    [editor],
  );
  const [question, setQuestion] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const ids = state?.ids;
  useEffect(() => {
    if (asking && !ids) setAsking(false);
  }, [asking, ids, setAsking]);
  useEffect(() => {
    if (!asking) return;
    setQuestion(suggestQuestion(state?.text ?? ""));
    const timer = setTimeout(() => input.current?.select(), 0);
    return () => clearTimeout(timer);
    // Only when the box opens: typing must not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking]);
  if (!state) return null;

  function submit(text: string) {
    try {
      const id = createAsk(editor, { targetIds: state!.ids.split(","), question: text });
      sendAsk(editor, id);
      setAsking(false);
      editor.selectNone();
      const box = editor.getShapePageBounds(id);
      // Bring the ask and the room for its answer into view; the answer lands just under it.
      if (box) keepInView({ x: box.x, y: box.y, maxX: box.maxX + 60, maxY: box.maxY + 240 });
      editor.focus();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not ask");
    }
  }

  const width = asking ? 430 : 330;
  const left = Math.max(70, Math.min(state.x, window.innerWidth - width - 16));
  // Above the selection, else below it; a selection taller than the screen (two records far
  // apart) keeps the bar on screen instead of pushing it out of reach.
  const top = Math.max(52, Math.min(state.y - 50 > 52 ? state.y - 50 : state.bottom + 12, window.innerHeight - 64));
  // Keys keep working after a click: the board takes the keyboard back.
  const judge = (mark: "picked" | "rejected") => {
    toggleMark(editor, editor.getSelectedShapes(), mark);
    editor.focus();
  };
  const compare = () => {
    const [a, b] = selectedRecords(editor);
    const result = a && b ? sideBySide(editor, a, b) : { ok: false as const, reason: "Select two records to see them side by side." };
    if (!result.ok) onNotice(result.reason);
    editor.focus();
  };
  if (state.editing)
    return state.blank ? null : (
      <div className="selection-bar hint" style={{ left, top }}>
        <kbd>⌘↵</kbd> ask about this · <kbd>Esc</kbd> done
      </div>
    );
  if (asking)
    return (
      <form
        className="selection-bar asking"
        style={{ left, top }}
        onSubmit={(e) => {
          e.preventDefault();
          submit(question);
        }}
      >
        <div className="ask-row">
          <span className="ask-spark">✦</span>
          <input
            ref={input}
            aria-label="Your question"
            value={question}
            placeholder="Ask about this…"
            maxLength={300}
            onChange={(e) => setQuestion(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setAsking(false);
                editor.focus();
              }
            }}
          />
          <button type="submit" className="ask-send" disabled={!question.trim()}>
            Ask ↵
          </button>
        </div>
        <div className="ask-starters">
          {(state?.starters.split("\n") ?? []).map((s) => (
            <button key={s} type="button" onClick={() => submit(s)}>
              {s}
            </button>
          ))}
        </div>
      </form>
    );
  return (
    <div className="selection-bar" style={{ left, top }} role="toolbar" aria-label="What next">
      <button className="primary" onClick={() => setAsking(true)} title="Ask your agent about the selection (⌘↵)">
        ✦ Ask <kbd>⌘↵</kbd>
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
      {state.pair && (
        <button onClick={compare} title="Put these two records next to each other, the same columns lined up (one undo)">
          Side by side
        </button>
      )}
    </div>
  );
}
