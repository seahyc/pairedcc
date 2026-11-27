import type { Editor, TLShape, TLShapeId } from "tldraw";
import { richTextPlain } from "../operations";
import { authorOf } from "../scratchbook";
import { CHECK_SIZE, checkPlacement, checkQuestion, checkTarget } from "./check";
import { createPrompt, type PromptShape } from "./prompt-shape";

// Check me on the board: put an agent's answer away behind a prompt that asks the person to
// explain it from memory; the answer comes back beside what they wrote. One undo step.

const textOf = (s: TLShape) => ("richText" in s.props ? richTextPlain(s.props.richText).trim() : "");

/** The open Check me prompt on this object, if one is waiting for the person. */
export function openCheckOn(editor: Editor, id: string) {
  return editor.getCurrentPageShapes().find((s) => s.type === "prompt" && s.meta.check === id && (s as PromptShape).props.status === "open")?.id;
}

/** The person's settled thoughts covered by an open Check me, with the prompt covering each. */
export function coveredThoughts(editor: Editor) {
  return editor.getCurrentPageShapes().flatMap((p) => {
    if (p.type !== "prompt" || (p as PromptShape).props.status !== "open" || typeof p.meta.check !== "string") return [];
    const card = editor.getShape(p.meta.check as TLShapeId);
    if (!card || authorOf(card) !== "Human" || card.meta.settled !== true) return [];
    return [{ id: card.id, prompt: p.id }];
  });
}

/** The one selected object Check me applies to, with the ask it answers, or undefined. */
export function checkable(editor: Editor) {
  const shapes = editor.getSelectedShapes().filter((s) => s.type !== "arrow");
  if (shapes.length !== 1) return undefined;
  const shape = shapes[0];
  const target = checkTarget(
    { type: shape.type, text: textOf(shape), author: authorOf(shape), meta: { ...shape.meta, coveredBy: openCheckOn(editor, shape.id) } },
    (id) => {
      const ask = editor.getShape(id as TLShapeId);
      return ask ? textOf(ask) : undefined;
    },
    (id) => (editor.getShape(id as TLShapeId) as PromptShape | undefined)?.props.status === "open",
  );
  return target ? { shape, ...target } : undefined;
}

/** Start a check on the selected answer. Returns the prompt's id, or a reason it cannot. */
export function checkMe(editor: Editor): { ok: true; id: TLShapeId } | { ok: false; reason: string } {
  const target = checkable(editor);
  if (!target) return { ok: false, reason: "Check me works on one of your agent's answers, or on a thought you settled." };
  const box = editor.getShapePageBounds(target.shape);
  if (!box) return { ok: false, reason: "That answer is not on the board." };
  const others = editor
    .getCurrentPageShapes()
    .filter((s) => s.id !== target.shape.id && s.type !== "frame" && s.type !== "arrow" && !editor.isShapeHidden(s))
    .flatMap((s) => editor.getShapePageBounds(s) ?? []);
  const spot = checkPlacement(box, others);
  const settled = "settled" in target && target.settled === true;
  // An agent's answer is put away behind the prompt; the person's own settled thought is never
  // hidden from them, only covered on the board while the prompt is open (the cover is drawn from the
  // prompt, so their card itself is not changed).
  const made = createPrompt(editor, { mode: "generate", question: checkQuestion(target.question, settled), x: spot.x, y: spot.y, width: CHECK_SIZE.w, hideIds: settled ? [] : [target.shape.id] }, "Human", {
    name: "Check me",
    check: target.shape.id,
  }, CHECK_SIZE.h);

  // Nothing selected: the bar would only sit on the prompt; the cursor goes in its box instead.
  editor.selectNone();
  return { ok: true, id: made.id };
}

/** Check me from the bar or the E key: start the check and put the cursor in its box. */
export function startCheck(editor: Editor, onNotice: (text: string) => void, keepInView: (box: { x: number; y: number; maxX: number; maxY: number }) => void) {
  const answer = checkable(editor)?.shape;
  const result = checkMe(editor);
  if (!result.ok) return onNotice(result.reason);
  // The prompt and the place its answer comes back to, both in view.
  const boxes = [result.id, answer?.id].flatMap((id) => (id ? (editor.getShapePageBounds(id) ?? []) : []));
  if (boxes.length)
    keepInView({ x: Math.min(...boxes.map((b) => b.x)), y: Math.min(...boxes.map((b) => b.y)), maxX: Math.max(...boxes.map((b) => b.maxX)), maxY: Math.max(...boxes.map((b) => b.maxY)) });
  // The prompt's box is drawn on the next frame; write in it straight away.
  const focus = (tries: number) => {
    const box = document.querySelector<HTMLTextAreaElement>(`[data-prompt="${result.id}"] textarea`);
    if (box) box.focus();
    else if (tries > 0) requestAnimationFrame(() => focus(tries - 1));
  };
  requestAnimationFrame(() => focus(10));
}
