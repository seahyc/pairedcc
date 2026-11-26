import { type Editor, type TLShape, type TLShapeId } from "tldraw";
import { z } from "zod";
import { answerInput, askStates, askStatusInput, asksInput, type AskState } from "./protocol";
import { describeObject, revision, richTextPlain, shapeName } from "./operations";
import { HUMAN, authorOf, resolveMark } from "./scratchbook";
import { atomic, createCard, createComment, freeSpot } from "./agent-operations";
import { ANSWER_CHROME, OPTION_GAP, answerLayout, capWords, describeImage, markOf, mergeHistory, type AskMark, type HistoryEntry } from "./ask-rules";
import { sourceAuthor, sourceOf, sourceText } from "./import-meta";
import { keepForAgent } from "./leave-out";
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
  // A frame the person left out is not part of the context (unless it is itself selected).
  const around = frameOf(editor, targets[0]);
  const frame = around && keepForAgent([around], targets.map((t) => t.id)).kept.length ? around : undefined;
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
  const chart = s as ChartShape, found = editor.getShape(chart.props.datasetId as TLShapeId);
  // Anything but a dataset under that id is treated as a deleted dataset, never read as one.
  const dataset = found?.type === "dataset" ? (found as DatasetShape) : undefined;
  if (!dataset) return `Bar chart whose dataset was deleted. Its last bars: ${chart.props.bars.map((b) => `${b.key} ${b.value}`).join(", ") || "none"}.`;
  const stale = staleness(editor, s);
  if (!stale.length) return chartText(dataset.props.data, chart.props.state);
  const nameOf = (id: string) => {
    const shape = editor.getShape(id as TLShapeId);
    return shape && !editor.isShapeHidden(shape) ? shapeName(shape) : undefined;
  };
  return chartText(dataset.props.data, chart.props.state, { stale: staleReason(stale, nameOf), bars: chart.props.bars });
}

/**
 * An image or video by what the board knows of it (file name, size, caption, alt text). Its
 * caption is a card of its own: one the person left out of asks, or a learning prompt still
 * hides, is not given through the image either.
 */
function mediaText(editor: Editor, s: TLShape, keep: Keep = (x) => x) {
  if (s.type !== "image" && s.type !== "video") return "";
  const props = s.props as { assetId?: string | null; altText?: string };
  const asset = props.assetId ? (editor.getAsset(props.assetId as never) as { props?: { name?: string; w?: number; h?: number } } | undefined) : undefined;
  // Its caption is on the image's own page, which need not be the one open.
  const pageId = editor.getAncestorPageId(s);
  const found = pageId
    ? [...editor.getPageShapeIds(pageId)].flatMap((id) => editor.getShape(id) ?? []).find((c) => c.meta.role === "caption" && c.meta.captionFor === s.id)
    : undefined;
  const caption = found && !editor.isShapeHidden(found) && keep([found]).length ? found : undefined;
  return describeImage({ kind: s.type, name: asset?.props?.name, w: asset?.props?.w, h: asset?.props?.h, caption: caption ? textOf(caption) : undefined, alt: props.altText });
}

const given = (editor: Editor, s: TLShape, max = 2000, keep: Keep = (x) => x): Given => {
  const source = sourceOf(s), mark = markOf(s.meta);
  return {
    id: s.id,
    type: s.type,
    author: source ? sourceAuthor(source) : authorOf(s),
    text: clip(sourceText(s, textOf(s)) || textOf(s) || dataText(editor, s) || mediaText(editor, s, keep) || `(${shapeName(s)}, no text)`, max),
    ...(mark ? { mark } : {}),
  };
};
const said = (editor: Editor, s: TLShape, max: number, keep: Keep = (x) => x): HistoryEntry => {
  const mark = markOf(s.meta), source = sourceOf(s);
  // A frame asked about earlier has no text of its own: say what it held, as the ask did then.
  // Imported material is said with its column names, as in the ask itself.
  const text =
    s.type === "frame"
      ? `the frame "${shapeName(s)}", holding: ${inside(editor, s, new Set(), keep).inside.map((o) => o.text).join("; ") || "nothing with text"}`
      : sourceText(s, textOf(s)) || textOf(s) || mediaText(editor, s, keep);
  return { id: s.id, who: source ? sourceAuthor(source) : authorOf(s), said: clip(text, max), ...(mark ? { mark } : {}) };
};
/** A grouped record is given as its parts: the title line, then each field in column order. */
const parts = (editor: Editor, s: TLShape, keep: Keep = (x) => x): TLShape[] => {
  if (s.type !== "group") return [s];
  const children = keep(editor.getSortedChildIdsForParent(s.id).flatMap((id) => editor.getShape(id) ?? []).filter((c) => c.type !== "arrow"));
  return children.length ? children.flatMap((c) => parts(editor, c, keep)) : [s];
};
/** Drops what the person left out of asks (see leave-out.ts), noting what was withheld. */
type Keep = (shapes: TLShape[]) => TLShape[];

/**
 * What a selected frame holds, nested frames included: the person put these together, so an
 * ask about the frame is about them. Reading order (top to bottom, then left to right).
 */
// Objects worth giving with no text of their own: media, and data the ask can describe.
const media = new Set(["image", "video", "bookmark", "embed", "chart", "dataset"]);
function inside(editor: Editor, frame: TLShape, skip: Set<string>, keep: Keep = (x) => x) {
  const found: TLShape[] = [];
  const walk = (id: TLShapeId) => {
    for (const childId of editor.getSortedChildIdsForParent(id)) {
      const child = editor.getShape(childId);
      // Anything a learning prompt still hides stays out of what the agent is given.
      if (!child || skip.has(child.id) || child.type === "arrow" || askOf(child) || editor.isShapeHidden(child)) continue;
      // What the person left out of asks is not given, and neither is what it holds.
      if (!keep([child]).length) continue;
      if (child.type === "frame" || child.type === "group") walk(child.id);
      if (textOf(child) || media.has(child.type)) found.push(child);
    }
  };
  walk(frame.id);
  const at = (s: TLShape) => editor.getShapePageBounds(s) ?? { x: 0, y: 0 };
  found.sort((a, b) => at(a).y - at(b).y || at(a).x - at(b).x);
  return { inside: found.slice(0, INSIDE_LIMIT).map((s) => given(editor, s, 400, keep)), more: Math.max(0, found.length - INSIDE_LIMIT) };
}

/** The exchange that led here, oldest first, when the human asks about an agent's answer. */
function thread(editor: Editor, shape: TLShape, keep: Keep, depth = 0, seen = new Set<string>()): HistoryEntry[] {
  if (depth > 4 || seen.has(shape.id)) return [];
  seen.add(shape.id);
  const parent = typeof shape.meta.replyTo === "string" ? editor.getShape(shape.meta.replyTo as TLShapeId) : undefined;
  if (!parent || !askOf(parent)) return [];
  const about = targetsOf(parent).flatMap((id) => editor.getShape(id as TLShapeId) ?? []);
  const earlier = about.flatMap((t) => thread(editor, t, keep, depth + 1, seen));
  // The other answers to that ask, so an agent asked about option A knows what B and C were
  // and which of them the person crossed out.
  const siblings = keep(editor.store
    .allRecords()
    .filter((r): r is TLShape => r.typeName === "shape" && (r as TLShape).meta.replyTo === parent.id && r.id !== shape.id && !askOf(r as TLShape) && !editor.isShapeHidden(r as TLShape))
    .sort((a, b) => a.y - b.y || a.x - b.x));
  return [
    ...earlier,
    // A grouped record is said as its parts, as the first ask gave it, not as its textless group.
    ...keep(about).flatMap((t) => parts(editor, t, keep)).map((t) => said(editor, t, 600, keep)),
    // The ask card's id keeps two asks with the same words (a starter used twice) apart.
    ...(keep([parent]).length ? [{ id: parent.id, who: `${HUMAN} asked`, said: clip(textOf(parent), 600) }] : []),
    ...siblings.map((s) => said(editor, s, 600, keep)),
  ];
}

/** Everything an agent is given for one ask: exactly what the board shows as its context. */
export function describeAsk(editor: Editor, shape: TLShape) {
  const ask = askOf(shape);
  if (!ask) throw new Error("Not an ask");
  const page = editor.getPage(editor.getAncestorPageId(shape)!);
  const selected = targetsOf(shape).flatMap((id) => editor.getShape(id as TLShapeId) ?? []);
  // What the person selected is given even if left out; around it, left-out objects are not.
  const withheld = new Set<string>();
  const keep: Keep = (shapes) => {
    const result = keepForAgent(shapes, selected.map((s) => s.id));
    for (const id of result.withheld) withheld.add(id);
    return result.kept;
  };
  const targets = selected.flatMap((s) => parts(editor, s, keep));
  const around = selected[0] ? frameOf(editor, selected[0]) : undefined;
  const frame = around && keep([around]).length ? around : undefined;
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
      if (t.type !== "frame") return given(editor, t, 2000, keep);
      const held = inside(editor, t, skip, keep);
      return { ...given(editor, t, 2000, keep), inside: held.inside, ...(held.more ? { insideMore: held.more } : {}) };
    }),
    history: mergeHistory(targets.flatMap((t) => thread(editor, t, keep)), targets.map((t) => t.id)),
    ...(frame
      ? {
          frame: {
            id: frame.id,
            name: shapeName(frame),
            objects: keep(
              editor
                .getSortedChildIdsForParent(frame.id)
                .flatMap((id) => editor.getShape(id) ?? [])
                .filter((s) => !skip.has(s.id) && s.type !== "arrow" && !askOf(s) && !editor.isShapeHidden(s) && (textOf(s) || s.type === "chart" || s.type === "dataset")),
            )
              .slice(0, 12)
              .map((s) => given(editor, s, 400, keep)),
          },
        }
      : {}),
    // Counted once the parts above are built: how many objects the person kept out of this ask.
    ...(withheld.size ? { leftOut: withheld.size } : {}),
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
    .filter((s) => input.page === "all" || editor.getAncestorPageId(s) === editor.getCurrentPageId())
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
  // The room the person's window has beside the canvas chrome, so no answer lands off screen.
  const available = (editor.getViewportScreenBounds().w - ANSWER_CHROME) / editor.getZoomLevel();
  const layout = answerLayout({ x: anchor.x, y: bottom }, texts, available);
  const spot = freeSpot(editor, layout.box, new Set([shape.id]), pageId);
  // On the open page, the answer is one step the person can undo, and tldraw puts it inside a
  // frame it lands in. On another page it is kept off the person's undo stack: undoing their own
  // work here must not silently remove an answer they cannot see (canvas_undo_run still can).
  const offPage = pageId !== editor.getCurrentPageId();
  const place = <T,>(work: () => T): T => {
    if (!offPage) return atomic(editor, "answer", work);
    let result!: T;
    editor.run(() => void (result = work()), { history: "ignore" });
    return result;
  };
  // One answer's cards share its time, so a later answer is never counted with an earlier one.
  const answeredAt = Date.now();
  const ids = place(() => {
    // Rows stack under the measured height of the row above (a card sizes to its text when made).
    let rowY = spot.y, rowBottom = spot.y, row = 0;
    const made = texts.map((text, i) => {
      if (layout.cards[i].row !== row) {
        row = layout.cards[i].row;
        rowY = rowBottom + OPTION_GAP;
      }
      const id = createCard(editor, { x: spot.x + layout.cards[i].dx, y: rowY, width: layout.cards[i].w, text }, actor, {
        name: input.alternatives ? `Option ${"ABCD"[i]}` : input.question ? "Question" : "Answer",
        role: "annotation",
        status: "open",
        author: actor,
        targetId: shape.id,
        replyTo: shape.id,
        answeredAt,
        ...(input.alternatives ? { option: "ABCD"[i] } : {}),
      }, pageId);
      rowBottom = Math.max(rowBottom, editor.getShapePageBounds(id as TLShapeId)?.maxY ?? rowY);
      return id;
    });
    setAsk(editor, editor.getShape(shape.id)!, { ...ask, state: "answered", agent: actor, answeredAt, read: input.read, note: undefined, error: undefined });
    // A clarifying question hands the turn back, so the ask stays open.
    if (!input.question && shape.meta.status !== "resolved") resolveMark(editor, editor.getShape(shape.id)!, "resolved", actor);
    return made;
  });
  return { ask: describeAsk(editor, editor.getShape(shape.id)!), answers: ids.map((id) => describeObject(editor, id, true)) };
}
