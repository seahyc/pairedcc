import type { Editor, TLShape, TLShapeId } from "tldraw";
import { learningVisibility } from "./learning/prompt-shape";
import { richTextSearch } from "./read-filter";

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

/**
 * Folded as saved with the board (what an agent is told): the person's choice, else finished, or
 * crowded out (item 144: an undecided thread past the four most recent, see `crowdedOut`).
 */
export function foldedSaved(ask: Meta, answers: Meta[], crowded = false) {
  const choice = foldChoice(ask);
  return choice === "folded" || (choice !== "open" && (crowded || threadFinished(ask, answers)));
}

/** Folded as the board shows it now: as saved, except that a thread the person is on stays open. */
export function foldedShown(ask: Meta, answers: Meta[], touched: boolean, crowded = false) {
  if (foldChoice(ask) === "folded") return true;
  return foldedSaved(ask, answers, crowded) && !touched;
}

/**
 * Item 144 (finding 1, working memory holds about four things): at most four undecided threads
 * open on a page. An undecided thread is an ask that was answered, has answers, and whose answers
 * the person has neither picked nor settled, and that the person has not folded or opened by hand.
 * Past the four most recently asked, the older ones fold to one line. Waiting, working and failed
 * asks never count (the agent must visibly respond), nor does a thread the person opened: their
 * choice wins, so they can keep more open.
 */
export const OPEN_THREADS = 4;
export type OpenThread = { id: string; askedAt: number; state: string; answers: number; finished: boolean; choice: FoldChoice | undefined };
export function crowdedOut(threads: OpenThread[], keep = OPEN_THREADS): Set<string> {
  const undecided = threads
    .filter((t) => t.state === "answered" && t.answers > 0 && !t.finished && t.choice === undefined)
    .sort((a, b) => b.askedAt - a.askedAt || (a.id < b.id ? 1 : -1));
  return new Set(undecided.slice(keep).map((t) => t.id));
}

/** What the folded line says: the question, the answer the person picked (or that it is settled). */
export function foldLine(question: string, answers: { text: string; meta: Meta }[]) {
  const picked = answers.filter((a) => a.meta.mark === "picked" || a.meta.settled === true);
  const first = picked[0]?.text.trim();
  const answer = first ? `${first}${picked.length > 1 ? ` (+${picked.length - 1})` : ""}` : "";
  const more = answers.length - (first ? 1 : 0);
  return { question: question.trim() || "(question)", answer, more };
}

/** The folded line of a thread nothing was picked from yet (item 144): it is still open to decide. */
export function undecidedLine(answers: number) {
  return answers === 1 ? "1 answer, none picked yet" : `${answers} options, none picked yet`;
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

/** The page's crowded-out threads (item 144), worked out once per change of the open page. */
let crowdIndex: { shapes: readonly TLShape[]; crowded: Set<string> } | undefined;
function threadsOf(editor: Editor, shapes: readonly TLShape[], answersFor: (ask: TLShape) => TLShape[]) {
  return shapes.filter(isAsk).map((s) => {
    const ask = s.meta.ask as Meta;
    const answers = answersFor(s);
    return {
      id: s.id,
      askedAt: typeof ask.askedAt === "number" ? ask.askedAt : 0,
      state: typeof ask.state === "string" ? ask.state : "",
      answers: answers.length,
      finished: threadFinished(s.meta, answers.map((a) => a.meta)),
      choice: foldChoice(s.meta),
    };
  });
}
function crowded(editor: Editor, ask: TLShape) {
  const pageId = editor.getAncestorPageId(ask);
  if (!pageId) return false;
  if (pageId === editor.getCurrentPageId()) {
    const shapes = editor.getCurrentPageShapes();
    if (crowdIndex?.shapes !== shapes) {
      const byAsk = repliesOnOpenPage(editor);
      crowdIndex = { shapes, crowded: crowdedOut(threadsOf(editor, shapes, (a) => byAsk.get(a.id) ?? [])) };
    }
    return crowdIndex.crowded.has(ask.id);
  }
  const shapes = [...editor.getPageShapeIds(pageId)].flatMap((id) => editor.getShape(id) ?? []);
  return crowdedOut(threadsOf(editor, shapes, (a) => shapes.filter((s) => s.meta.replyTo === a.id))).has(ask.id);
}

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
  return foldedShown(ask.meta, answers.map((a) => a.meta), touched(editor, ask, answers), crowded(editor, ask));
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
  return foldedSaved(ask.meta, answersOf(editor, ask).map((a) => a.meta), crowded(editor, ask));
}

/**
 * For an agent's read or overview: the ask's thread is folded though nothing in it was picked or
 * settled, because more recent undecided threads are open (item 144) or the person put it away.
 * It is out of view, not decided.
 */
export function foldedUndecided(editor: Editor, shape: TLShape) {
  if (!isAsk(shape) || !foldedForAgent(editor, shape)) return false;
  return !threadFinished(shape.meta, answersOf(editor, shape).map((a) => a.meta));
}

/**
 * For an agent's overview or read of a folded thread's ask: the answer the person picked (the one
 * shown on the folded line), so the agent can build on it without reading the thread.
 */
export function foldedPick(editor: Editor, shape: TLShape): { id: string; text: string } | undefined {
  if (!isAsk(shape) || !foldedForAgent(editor, shape)) return undefined;
  const picked = answersOf(editor, shape).find((a) => a.meta.mark === "picked");
  if (!picked) return undefined;
  const text = "richText" in picked.props ? richTextSearch(picked.props.richText) : "";
  return { id: picked.id, text: text.length > 120 ? `${text.slice(0, 119)}…` : text };
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
