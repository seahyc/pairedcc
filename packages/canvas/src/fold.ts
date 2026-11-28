import type { Editor, TLPageId, TLShape, TLShapeId } from "tldraw";
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

/**
 * The thread's primary answer, one rule for the folded line and an agent's `pick`: the first
 * answer the person picked; only when nothing is picked, the first settled one (`picked: false`).
 * `others` counts the rest that were picked or settled.
 */
export function primaryAnswer<T extends { meta: Meta }>(answers: readonly T[]) {
  const chosen = answers.filter((a) => a.meta.mark === "picked" || a.meta.settled === true);
  const answer = answers.find((a) => a.meta.mark === "picked") ?? chosen[0];
  return answer ? { answer, picked: answer.meta.mark === "picked", others: chosen.length - 1 } : undefined;
}

/**
 * What the folded line says: the question, the answer the person picked (or that it is settled).
 * A thread folded only to make room (`undecided`) says instead how many answers wait for a pick.
 */
export function foldLine(question: string, answers: { text: string; meta: Meta }[], undecided = false) {
  const q = question.trim() || "(question)";
  if (undecided) {
    const n = answers.length;
    return { question: q, answer: "", more: 0, undecided: n === 1 ? "1 answer, not picked yet" : `${n} options, none picked yet` };
  }
  const primary = primaryAnswer(answers);
  const first = primary?.answer.text.trim();
  const answer = first ? `${first}${primary!.others > 0 ? ` (+${primary!.others})` : ""}` : "";
  const more = answers.length - (first ? 1 : 0);
  return { question: q, answer, more };
}

/**
 * Item 144 (finding 1, working memory holds about four things): at most this many unfinished
 * threads stay open on a page. An older thread that has answers but no pick folds to one line
 * ("question · 3 options, none picked yet") until the person unfolds it.
 */
export const CROWD_LIMIT = 4;
export type ThreadState = {
  id: string;
  askedAt: number;
  /** The ask's state: waiting, working, answered or failed. */
  state: string;
  answers: number;
  finished: boolean;
  choice: FoldChoice | undefined;
  /** The person is on it: something in it selected or being written. */
  touched: boolean;
};
/**
 * The threads on one page folded only because more recent unfinished threads are open. Newest
 * asked first: a waiting, working or failed ask, and one the person unfolded, stay open and count
 * among the four; an answered, undecided one folds once four are open. The thread the person is
 * on stays open and counts too. That never folds another thread: everything older than a thread
 * that was folded is folded already. So the board shows this rule's set less the thread the person
 * is on, and an agent (which is told what is saved, not what is selected) is given the same set.
 * Finished threads and ones the person folded are folded by their own rule and are not counted.
 */
export function crowdFolded(threads: readonly ThreadState[]): Set<string> {
  const folded = new Set<string>();
  let open = 0;
  for (const t of [...threads].sort((a, b) => b.askedAt - a.askedAt || (a.id < b.id ? 1 : -1))) {
    if (t.choice === "folded" || t.finished) continue;
    const foldable = !t.touched && t.choice !== "open" && t.state === "answered" && t.answers > 0;
    if (foldable && open >= CROWD_LIMIT) folded.add(t.id);
    else open++;
  }
  return folded;
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

/**
 * The threads on a page folded only to make room (item 144), as saved with the board: what is
 * selected does not enter into it. Indexed once per change of the page's shapes.
 */
const crowdIndex = new Map<string, { key: unknown; folded: Set<string> }>();
function pageShapes(editor: Editor, pageId: string): readonly TLShape[] {
  if (pageId === editor.getCurrentPageId()) return editor.getCurrentPageShapes();
  return [...editor.getPageShapeIds(pageId as TLPageId)].flatMap((id) => editor.getShape(id) ?? []);
}
function crowdOnPage(editor: Editor, pageId: string) {
  const current = pageId === editor.getCurrentPageId();
  // Another page's shapes are not one cached list: the store's change clock says when anything changed.
  const key = current ? editor.getCurrentPageShapes() : (editor as Partial<Editor>).store?.history.get();
  const hit = crowdIndex.get(pageId);
  if (key !== undefined && hit?.key === key) return hit.folded;
  const threads = pageShapes(editor, pageId).flatMap((s): ThreadState[] => {
    if (!isAsk(s)) return [];
    const ask = s.meta.ask as { state?: unknown; askedAt?: unknown };
    const answers = answersOf(editor, s).map((a) => a.meta);
    return [{
      id: s.id,
      askedAt: typeof ask.askedAt === "number" ? ask.askedAt : 0,
      state: typeof ask.state === "string" ? ask.state : "",
      answers: answers.length,
      finished: threadFinished(s.meta, answers),
      choice: foldChoice(s.meta),
      touched: false,
    }];
  });
  const folded = crowdFolded(threads);
  crowdIndex.set(pageId, { key, folded });
  return folded;
}
/** Folded only because four more recent unfinished threads are open: the person has not decided it. */
function crowded(editor: Editor, ask: TLShape) {
  const pageId = editor.getAncestorPageId(ask);
  return Boolean(pageId && crowdOnPage(editor, pageId).has(ask.id));
}

/** Is this ask's thread folded on the board right now? */
export function isFoldedNow(editor: Editor, ask: TLShape) {
  const answers = answersOf(editor, ask);
  const on = touched(editor, ask, answers);
  return foldedShown(ask.meta, answers.map((a) => a.meta), on) || (!on && crowded(editor, ask));
}

/**
 * The thread an object is in is folded only to make room, not because it was decided: no answer
 * picked or settled, and the person did not fold it. Agents are told so (`undecided: true`).
 */
export function foldedUndecided(editor: Editor, shape: TLShape) {
  if (!shape.meta.ask && typeof shape.meta.replyTo !== "string") return false;
  const ask = threadAsk(editor, shape);
  if (!ask || foldedSaved(ask.meta, answersOf(editor, ask).map((a) => a.meta))) return false;
  return crowded(editor, ask);
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
  return foldedSaved(ask.meta, answersOf(editor, ask).map((a) => a.meta)) || crowded(editor, ask);
}

/**
 * For an agent's overview or read of a folded thread's ask: the answer the person picked (the one
 * shown on the folded line), so the agent can build on it without reading the thread.
 */
export function foldedPick(editor: Editor, shape: TLShape): { id: string; text: string } | undefined {
  if (!isAsk(shape) || !foldedForAgent(editor, shape)) return undefined;
  // The folded line's answer, but only an explicit pick: a settled-only answer is not a pick.
  const primary = primaryAnswer(answersOf(editor, shape));
  if (!primary?.picked) return undefined;
  const picked = primary.answer;
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
