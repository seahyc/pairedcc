import type { Editor, TLShape, TLShapeId } from "tldraw";
import { learningVisibility } from "./learning/prompt-shape";

/**
 * P1, few things in view (finding 1: working memory holds about four things). A finished thread
 * (an ask whose answer the person picked, or which they settled) folds to one line: the question
 * and the picked answer. The person unfolds it with a click and can fold it again; that choice
 * is saved on the ask as `meta.fold`. A thread that has just been finished stays open while the
 * person is still on it (something in it selected or being written), so it never vanishes from
 * under their hand; it folds when they move on.
 */
export type FoldChoice = "open" | "folded";
type Meta = Record<string, unknown>;

/** The person's own choice for this thread, if they made one. */
export function foldChoice(meta: Meta): FoldChoice | undefined {
  return meta.fold === "open" || meta.fold === "folded" ? meta.fold : undefined;
}

/** Finished: the person picked one of its answers, or settled the ask or an answer. */
export function threadFinished(ask: Meta, answers: Meta[]) {
  return ask.settled === true || answers.some((a) => a.mark === "picked" || a.settled === true);
}

/** Folded as saved with the board (what an agent is told): the person's choice, else finished. */
export function foldedSaved(ask: Meta, answers: Meta[]) {
  const choice = foldChoice(ask);
  return choice === "folded" || (choice !== "open" && threadFinished(ask, answers));
}

/** Folded as the board shows it now: as saved, except that a thread the person is on stays open. */
export function foldedShown(ask: Meta, answers: Meta[], touched: boolean) {
  if (foldChoice(ask) === "folded") return true;
  return foldedSaved(ask, answers) && !touched;
}

/** What the folded line says: the question, the answer the person picked (or that it is settled). */
export function foldLine(question: string, answers: { text: string; meta: Meta }[]) {
  const picked = answers.filter((a) => a.meta.mark === "picked" || a.meta.settled === true);
  const first = picked[0]?.text.trim();
  const answer = first ? `${first}${picked.length > 1 ? ` (+${picked.length - 1})` : ""}` : "";
  const more = answers.length - (first ? 1 : 0);
  return { question: question.trim() || "(question)", answer, more };
}

/** The value `meta.fold` should take when the person presses the fold line or Fold. */
export function nextFold(foldedNow: boolean, finished: boolean): FoldChoice | undefined {
  // Folding a finished thread is its default, so the choice is cleared rather than stored.
  if (!foldedNow) return finished ? undefined : "folded";
  return "open";
}

/**
 * Replies by the ask they answer, for the open page. Visibility is asked for every reply each
 * time the board changes, so the page is indexed once per change rather than scanned per reply.
 */
let index: { shapes: readonly TLShape[]; byAsk: Map<string, TLShape[]> } | undefined;
function repliesOnOpenPage(editor: Editor) {
  const shapes = editor.getCurrentPageShapes();
  if (index?.shapes !== shapes) {
    const byAsk = new Map<string, TLShape[]>();
    for (const s of shapes) {
      if (typeof s.meta.replyTo !== "string") continue;
      const list = byAsk.get(s.meta.replyTo);
      if (list) list.push(s);
      else byAsk.set(s.meta.replyTo, [s]);
    }
    index = { shapes, byAsk };
  }
  return index.byAsk;
}
const answersOf = (editor: Editor, ask: TLShape) => {
  const pageId = editor.getAncestorPageId(ask);
  if (!pageId) return [];
  if (pageId === editor.getCurrentPageId()) return repliesOnOpenPage(editor).get(ask.id) ?? [];
  return [...editor.getPageShapeIds(pageId)].flatMap((id) => editor.getShape(id) ?? []).filter((s) => s.meta.replyTo === ask.id);
};
const isAsk = (s: TLShape | undefined) => Boolean(s && s.meta.ask && typeof s.meta.ask === "object");

/** True when the person is on this thread: one of its objects is selected or being written. */
function touched(editor: Editor, ask: TLShape, answers: TLShape[]) {
  const ids = new Set<string>([ask.id, ...answers.map((a) => a.id)]);
  const editing = editor.getEditingShapeId();
  return (editing !== null && ids.has(editing)) || editor.getSelectedShapeIds().some((id) => ids.has(id));
}

/** The thread an object belongs to: itself when it is an ask, or the ask it answers. */
export function threadAsk(editor: Editor, shape: TLShape): TLShape | undefined {
  if (isAsk(shape)) return shape;
  const parent = typeof shape.meta.replyTo === "string" ? editor.getShape(shape.meta.replyTo as TLShapeId) : undefined;
  return parent && isAsk(parent) ? parent : undefined;
}

/** Is this ask's thread folded on the board right now? */
export function isFoldedNow(editor: Editor, ask: TLShape) {
  const answers = answersOf(editor, ask);
  return foldedShown(ask.meta, answers.map((a) => a.meta), touched(editor, ask, answers));
}

/** For <Tldraw getShapeVisibility>: an ask and its answers are out of view while folded. */
export function foldVisibility(shape: TLShape, editor: Editor): "hidden" | undefined {
  if (!shape.meta.ask && typeof shape.meta.replyTo !== "string") return undefined;
  const ask = threadAsk(editor, shape);
  return ask && isFoldedNow(editor, ask) ? "hidden" : undefined;
}

/** For an agent's read: the thread an object is in is folded (as saved with the board). */
export function foldedForAgent(editor: Editor, shape: TLShape) {
  if (!shape.meta.ask && typeof shape.meta.replyTo !== "string") return false;
  const ask = threadAsk(editor, shape);
  if (!ask) return false;
  return foldedSaved(ask.meta, answersOf(editor, ask).map((a) => a.meta));
}

/** Fold or unfold a thread, as one undo step. Nothing moves: folding only takes it out of view. */
export function toggleFold(editor: Editor, askId: string) {
  const ask = editor.getShape(askId as TLShapeId);
  if (!ask || !isAsk(ask)) return;
  const answers = answersOf(editor, ask);
  const next = nextFold(isFoldedNow(editor, ask), threadFinished(ask.meta, answers.map((a) => a.meta)));
  const meta = { ...ask.meta };
  if (next) meta.fold = next;
  else delete meta.fold;
  editor.markHistoryStoppingPoint(next === "open" ? "unfold" : "fold");
  // updateShape merges metadata, so a removed key would survive; replace the record's meta.
  editor.store.update(ask.id, (record) => ({ ...record, meta }));
  // Folding the thread the person is on takes it away from their selection.
  if (next !== "open") editor.setSelectedShapes(editor.getSelectedShapeIds().filter((id) => id !== ask.id && !answers.some((a) => a.id === id)));
}

/**
 * Hidden from an agent's ask context. Folding only takes a thread out of view: the question,
 * its answers and the pick are still what the person has on the board, so they are still given.
 * Anything hidden for another reason (a result behind a learning prompt) stays hidden.
 */
export function hiddenFromAgents(editor: Editor, shape: TLShape) {
  if (!editor.isShapeHidden(shape)) return false;
  if (foldVisibility(shape, editor) !== "hidden") return true;
  if (learningVisibility(shape, editor) === "hidden") return true;
  const parent = editor.getShape(shape.parentId as TLShapeId);
  return parent ? editor.isShapeHidden(parent) : false;
}
