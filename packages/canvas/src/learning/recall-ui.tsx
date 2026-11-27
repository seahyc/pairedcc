import { useEffect, useState } from "react";
import { useEditor, useValue, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { richTextPlain } from "../operations";
import { authorOf } from "../scratchbook";
import { coveredThoughts } from "./check-ui";
import { dueRecall, recallLine, recallOf, snoozeRecall } from "./recall";

const textOf = (s: TLShape) => ("richText" in s.props ? richTextPlain(s.props.richText as never).trim() : "");

/**
 * Page-space layer: a settled thought of the person's is covered (face down) while they explain
 * it from memory under Check me. It is never hidden or taken away: it is on the board for agents
 * and comes back the moment they answer or skip.
 */
export function CoverLayer() {
  const editor = useEditor();
  const covers = useValue(
    "check covers",
    () =>
      coveredThoughts(editor).flatMap((c) => {
        const b = editor.getShapePageBounds(c.id as TLShapeId);
        return b ? [{ id: c.id, x: b.x, y: b.y, w: b.w, h: b.h }] : [];
      }),
    [editor],
  );
  if (!covers.length) return null;
  return (
    <div className="scratch-layer cover-layer" aria-hidden>
      {covers.map((c) => (
        <div key={c.id} className="check-cover" data-check-cover={c.id} style={{ transform: `translate(${c.x}px, ${c.y}px)`, width: c.w, height: c.h }}>
          <span>Face down while you explain it</span>
        </div>
      ))}
    </div>
  );
}

/** The thought to bring back now on the open page, if any. */
export function recallNow(editor: Editor, now: number) {
  // A thought already under an open check is being recalled: the line waits.
  const checking = new Set(coveredThoughts(editor).map((c) => c.id as string));
  return dueRecall(
    editor
      .getCurrentPageShapes()
      .filter((s) => s.meta.recall !== undefined && authorOf(s) === "Human" && !checking.has(s.id))
      .map((s) => ({ id: s.id, settled: s.meta.settled === true, text: textOf(s), meta: s.meta })),
    now,
  );
}

/**
 * One quiet line at the board's bottom edge when a settled thought is due to come back: what to
 * recall, Check me (go there and start the check) and Later (tomorrow). Never a modal; nothing
 * on a board where the person never checked a settled thought.
 */
export function RecallLine({ onCheck }: { onCheck: (id: string) => void }) {
  const editor = useEditor();
  // Due dates are days apart: looking again every minute is plenty.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  // The minute tick re-asks; a change on the board re-asks at once, with the clock as it is then.
  const due = useValue("recall due", () => recallNow(editor, Math.max(now, Date.now())), [editor, now]);
  if (!due) return null;
  const later = () => {
    const card = editor.getShape(due.id as TLShapeId);
    const current = card && recallOf(card.meta);
    if (!card || !current) return;
    editor.markHistoryStoppingPoint("recall later");
    editor.updateShape({ id: card.id, type: card.type, meta: { ...card.meta, recall: snoozeRecall(current, Date.now()) } });
  };
  return (
    <div className="recall-line" role="status" data-recall={due.id}>
      <span className="recall-text">{recallLine(due.text, due.recall, Math.max(now, Date.now()))}</span>
      <button type="button" onClick={() => onCheck(due.id)}>
        Check me
      </button>
      <button type="button" className="recall-later" onClick={later}>
        Later
      </button>
    </div>
  );
}
