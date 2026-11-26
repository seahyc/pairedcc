import { type Editor, type TLShape, type TLShapeId } from "tldraw";
import { z } from "zod";
import { answerInput, askStates, askStatusInput, asksInput, type AskState } from "./protocol";
import { describeObject, revision, richTextPlain, shapeName } from "./operations";
import { HUMAN, authorOf, resolveMark } from "./scratchbook";
import { atomic, createCard, createComment, freeSpot } from "./agent-operations";
import { answerLayout, capWords, markOf, mergeHistory, type AskMark, type HistoryEntry } from "./ask-rules";
import { sourceAuthor, sourceOf, sourceText } from "./import-meta";
import { chartText, datasetText, staleReason } from "./data/model";
import { staleness, type ChartShape, type DatasetShape } from "./data/shapes";

// An ask is the human's question to an agent, attached to what they selected. It is a
// pink card on the board (so it is in the feedback queue like any comment) that carries
// its own state: waiting, working, answered or failed. Nothing about it is hidden.

const askMeta = z.object({
  state: z.enum(askStates),
  attempt: z.number().int().nonnegative(),
  contextIds: z.array(z.string()),
  askedAt: z.number(),
  startedAt: z.number().optional(),
  answeredAt: z.number().optional(),
  agent: z.string().optional(),
  note: z.string().optional(),
  error: z.string().optional(),
  read: z.string().optional(),
});
export type AskMeta = z.infer<typeof askMeta>;

export function askOf(shape: TLShape | undefined): AskMeta | undefined {
  const parsed = askMeta.safeParse(shape?.meta.ask);
  return parsed.success ? parsed.data : undefined;
}

const textOf = (s: TLShape) => ("richText" in s.props ? richTextPlain(s.props.richText).trim() : "");
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const frameOf = (editor: Editor, shape: TLShape) => editor.findShapeAncestor(shape, (s) => s.type === "frame");
const targetsOf = (shape: TLShape) =>
  Array.isArray(shape.meta.targetIds) ? shape.meta.targetIds.filter((id): id is string => typeof id === "string") : [];

function setAsk(editor: Editor, shape: TLShape, ask: AskMeta) {
  // The agent's progress is not the human's edit: keep it off their undo stack.
  // Board metadata must be plain JSON, so absent fields are left out rather than set to undefined.
  const clean = Object.fromEntries(Object.entries(ask).filter(([, value]) => value !== undefined));
  editor.run(() => editor.updateShape({ id: shape.id, type: shape.type, meta: { ...shape.meta, ask: clean } }), { history: "ignore" });
}

/** Ask an agent about the given objects. The context is the selection plus the frame it sits in. */
export function createAsk(editor: Editor, value: { targetIds: string[]; question: string }) {
  const targets = value.targetIds.flatMap((id) => editor.getShape(id as TLShapeId) ?? []).filter((s) => s.type !== "arrow");
  if (!targets.length) throw new Error("Select what you mean first, then ask");
  const question = value.question.trim();
  if (!question) throw new Error("Type a question first");
  const frame = frameOf(editor, targets[0]);
  const ask: AskMeta = {
    state: "waiting",
    attempt: 0,
    contextIds: [...targets.map((t) => t.id), ...(frame ? [frame.id] : [])],
    askedAt: Date.now(),
  };
  return createComment(editor, { targetIds: targets.map((t) => t.id), text: question }, { name: "Ask", ask }) as TLShapeId;
}

/** Send a failed or stuck ask again. */
export function retryAsk(editor: Editor, id: string) {
  const shape = editor.getShape(id as TLShapeId), ask = askOf(shape);
  if (!shape || !ask) throw new Error("Not an ask");
  setAsk(editor, shape, { ...ask, state: "waiting", attempt: ask.attempt + 1, askedAt: Date.now(), startedAt: undefined, error: undefined, note: undefined });
  if (shape.meta.status === "resolved") resolveMark(editor, editor.getShape(shape.id)!, "open", HUMAN);
}

type Given = { id: string; type: string; author: string; text: string; mark?: AskMark; inside?: Given[]; insideMore?: number };
/** How many of a selected frame's objects an ask gives, in reading order. */
export const INSIDE_LIMIT = 20;
// Imported material is given with its column names and where it came from.
/**
 * A chart or dataset has no text of its own; an agent answering with no tools reads what it
 * shows instead: the chart's measure, filter, bars and selection, or the dataset's columns and
 * first rows. A stale chart says so and gives the bars the person still sees.
 */
function dataText(editor: Editor, s: TLShape): string {
  if (s.type === "dataset") return datasetText((s as DatasetShape).props.data);
  if (s.type !== "chart") return "";
  const chart = s as ChartShape, dataset = editor.getShape(chart.props.datasetId as TLShapeId) as DatasetShape | undefined;
  if (!dataset) return `Bar chart whose dataset was deleted. Its last bars: ${chart.props.bars.map((b) => `${b.key} ${b.value}`).join(", ") || "none"}.`;
  const stale = staleness(editor, s);
  if (!stale.length) return chartText(dataset.props.data, chart.props.state);
  const nameOf = (id: string) => {
    const shape = editor.getShape(id as TLShapeId);
    return shape && !editor.isShapeHidden(shape) ? shapeName(shape) : undefined;
  };
  return chartText(dataset.props.data, chart.props.state, { stale: staleReason(stale, nameOf), bars: chart.props.bars });
}

const given = (editor: Editor, s: TLShape, max = 2000): Given => {
  const source = sourceOf(s), mark = markOf(s.meta);
  return {
    id: s.id,
    type: s.type,
    author: source ? sourceAuthor(source) : authorOf(s),
    text: clip(sourceText(s, textOf(s)) || textOf(s) || dataText(editor, s) || `(${shapeName(s)}, no text)`, max),
    ...(mark ? { mark } : {}),
  };
};
const said = (s: TLShape, max: number): HistoryEntry => {
  const mark = markOf(s.meta);
  return { id: s.id, who: authorOf(s), said: clip(textOf(s), max), ...(mark ? { mark } : {}) };
};
/** A grouped record is given as its parts: the title line, then each field in column order. */
const parts = (editor: Editor, s: TLShape): TLShape[] => {
  if (s.type !== "group") return [s];
  const children = editor.getSortedChildIdsForParent(s.id).flatMap((id) => editor.getShape(id) ?? []).filter((c) => c.type !== "arrow");
  return children.length ? children.flatMap((c) => parts(editor, c)) : [s];
};

/**
 * What a selected frame holds, nested frames included: the person put these together, so an
 * ask about the frame is about them. Reading order (top to bottom, then left to right).
 */
// Objects worth giving with no text of their own: media, and data the ask can describe.
const media = new Set(["image", "video", "bookmark", "embed", "chart", "dataset"]);
function inside(editor: Editor, frame: TLShape, skip: Set<string>) {
  const found: TLShape[] = [];
  const walk = (id: TLShapeId) => {
    for (const childId of editor.getSortedChildIdsForParent(id)) {
      const child = editor.getShape(childId);
      if (!child || skip.has(child.id) || child.type === "arrow" || askOf(child)) continue;
      if (child.type === "frame" || child.type === "group") walk(child.id);
      if (textOf(child) || media.has(child.type)) found.push(child);
    }
  };
  walk(frame.id);
  const at = (s: TLShape) => editor.getShapePageBounds(s) ?? { x: 0, y: 0 };
  found.sort((a, b) => at(a).y - at(b).y || at(a).x - at(b).x);
  return { inside: found.slice(0, INSIDE_LIMIT).map((s) => given(editor, s, 400)), more: Math.max(0, found.length - INSIDE_LIMIT) };
}

/** The exchange that led here, oldest first, when the human asks about an agent's answer. */
function thread(editor: Editor, shape: TLShape, depth = 0, seen = new Set<string>()): HistoryEntry[] {
  if (depth > 4 || seen.has(shape.id)) return [];
  seen.add(shape.id);
  const parent = typeof shape.meta.replyTo === "string" ? editor.getShape(shape.meta.replyTo as TLShapeId) : undefined;
  if (!parent || !askOf(parent)) return [];
  const about = targetsOf(parent).flatMap((id) => editor.getShape(id as TLShapeId) ?? []);
  const earlier = about.flatMap((t) => thread(editor, t, depth + 1, seen));
  // The other answers to that ask, so an agent asked about option A knows what B and C were
  // and which of them the person crossed out.
  const siblings = editor.store
    .allRecords()
    .filter((r): r is TLShape => r.typeName === "shape" && (r as TLShape).meta.replyTo === parent.id && r.id !== shape.id && !askOf(r as TLShape))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return [
    ...earlier,
    ...about.map((t) => said(t, 600)),
    { who: `${HUMAN} asked`, said: clip(textOf(parent), 600) },
    ...siblings.map((s) => said(s, 600)),
  ];
}

/** Everything an agent is given for one ask: exactly what the board shows as its context. */
export function describeAsk(editor: Editor, shape: TLShape) {
  const ask = askOf(shape);
  if (!ask) throw new Error("Not an ask");
  const page = editor.getPage(editor.getAncestorPageId(shape)!);
  const selected = targetsOf(shape).flatMap((id) => editor.getShape(id as TLShapeId) ?? []);
  const targets = selected.flatMap((s) => parts(editor, s));
  const frame = selected[0] ? frameOf(editor, selected[0]) : undefined;
  const skip = new Set<string>([shape.id, ...targets.map((t) => t.id)]);
  return {
    id: shape.id,
    revision: revision(shape),
    question: textOf(shape),
    state: ask.state,
    attempt: ask.attempt,
    askedAt: new Date(ask.askedAt).toISOString(),
    ...(ask.agent ? { agent: ask.agent } : {}),
    ...(ask.note ? { note: ask.note } : {}),
    ...(ask.error ? { error: ask.error } : {}),
    pageId: page?.id,
    pageName: page?.name,
    targets: targets.map((t) => {
      if (t.type !== "frame") return given(editor, t);
      const held = inside(editor, t, skip);
      return { ...given(editor, t), inside: held.inside, ...(held.more ? { insideMore: held.more } : {}) };
    }),
    history: mergeHistory(targets.flatMap((t) => thread(editor, t)), targets.map((t) => t.id)),
    ...(frame
      ? {
          frame: {
            id: frame.id,
            name: shapeName(frame),
            objects: editor
              .getSortedChildIdsForParent(frame.id)
              .flatMap((id) => editor.getShape(id) ?? [])
              .filter((s) => !skip.has(s.id) && s.type !== "arrow" && !askOf(s) && (textOf(s) || s.type === "chart" || s.type === "dataset"))
              .slice(0, 12)
              .map((s) => given(editor, s, 400)),
          },
        }
      : {}),
  };
}
export type AskView = ReturnType<typeof describeAsk>;

const allAsks = (editor: Editor) =>
  editor.store.allRecords().filter((r): r is TLShape => r.typeName === "shape" && Boolean(askOf(r as TLShape)));

/** Asks across every page, oldest first. */
export function listAsks(editor: Editor, value: unknown = {}) {
  const input = asksInput.parse(value);
  const asks = allAsks(editor)
    .filter((s) => input.state === "all" || askOf(s)!.state === input.state)
    .sort((a, b) => askOf(a)!.askedAt - askOf(b)!.askedAt)
    .map((s) => describeAsk(editor, s));
  return { asks };
}

function findAsk(editor: Editor, id: string) {
  const shape = editor.getShape(id as TLShapeId), ask = askOf(shape);
  if (!shape || !ask) throw new Error("Not an ask. Use ids from the asks operation.");
  return { shape, ask };
}

/** An agent says it has picked an ask up, could not answer it, or hands it back. */
export function setAskStatus(editor: Editor, value: unknown, actor: string) {
  const input = askStatusInput.parse(value), { shape, ask } = findAsk(editor, input.id);
  const state: AskState = input.state;
  setAsk(editor, shape, {
    ...ask,
    state,
    agent: actor,
    note: input.note,
    error: state === "failed" ? (input.error ?? "The agent could not answer") : undefined,
    startedAt: state === "working" ? Date.now() : ask.startedAt,
  });
  return describeAsk(editor, editor.getShape(shape.id)!);
}

/**
 * The agent's answer, placed under the ask: one short card, or two to four alternatives
 * side by side. The human's objects are never moved or edited.
 */
export function answerAsk(editor: Editor, value: unknown, actor: string) {
  const input = answerInput.parse(value), { shape, ask } = findAsk(editor, input.id);
  // The answer goes on the ask's page, whichever page the person has open now: they may
  // have moved on while waiting, and the answer is about what is on the ask's page.
  const pageId = editor.getAncestorPageId(shape);
  if (!pageId) throw new Error("Ask is not on a page");
  const anchor = editor.getShapePageBounds(shape);
  if (!anchor) throw new Error("Ask has no bounds");
  const earlier = [...editor.getPageShapeIds(pageId)]
    .flatMap((id) => editor.getShape(id) ?? [])
    .filter((s) => s.meta.replyTo === shape.id)
    .flatMap((s) => editor.getShapePageBounds(s) ?? []);
  const bottom = Math.max(anchor.maxY, ...earlier.map((b) => b.maxY));
  const texts = input.alternatives
    ? input.alternatives.map((text, i) => `${"ABCD"[i]} · ${capWords(text, 60)}`)
    : [capWords(input.text ?? "", 90)];
  const layout = answerLayout({ x: anchor.x, y: bottom }, texts);
  const spot = freeSpot(editor, layout.box, new Set([shape.id]), pageId);
  const ids = atomic(editor, "answer", () => {
    const made = texts.map((text, i) =>
      createCard(editor, { x: spot.x + layout.cards[i].dx, y: spot.y, width: layout.cards[i].w, text }, actor, {
        name: input.alternatives ? `Option ${"ABCD"[i]}` : input.question ? "Question" : "Answer",
        role: "annotation",
        status: "open",
        author: actor,
        targetId: shape.id,
        replyTo: shape.id,
        ...(input.alternatives ? { option: "ABCD"[i] } : {}),
      }, pageId),
    );
    setAsk(editor, editor.getShape(shape.id)!, { ...ask, state: "answered", agent: actor, answeredAt: Date.now(), read: input.read, note: undefined, error: undefined });
    // A clarifying question hands the turn back, so the ask stays open.
    if (!input.question && shape.meta.status !== "resolved") resolveMark(editor, editor.getShape(shape.id)!, "resolved", actor);
    return made;
  });
  return { ask: describeAsk(editor, editor.getShape(shape.id)!), answers: ids.map((id) => describeObject(editor, id)) };
}
