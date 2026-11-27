import { type Editor, type TLPageId, type TLShape, type TLShapeId } from "tldraw";
import { z } from "zod";
import { answerInput, askStates, askStatusInput, asksInput, type AskState } from "./protocol";
import { describeObject, revision, richTextPlain, shapeName } from "./operations";
import { HUMAN, authorOf, resolveMark } from "./scratchbook";
import { atomic, createCard, createComment, freeSpot } from "./agent-operations";
import { ANSWER_CHROME, BESIDE_GAP, OPTION_GAP, answerLayout, answerTexts, optionRichText, pickAnswerSpot, capWords, isQuestion, describeImage, markOf, mergeHistory, type AskMark, type HistoryEntry } from "./ask-rules";
import { sourceAuthor, sourceOf, sourceText } from "./import-meta";
import { isLeftOut, isPinned, keepForAgent, pinnedFor } from "./leave-out";
import { followers } from "./follow";
import { hiddenFromAgents } from "./fold";
import { unclipFromFrame } from "./frame-edge";
import { clusterAround, relation } from "./arrangement";
import { groupName } from "./overview";
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
  /** The words sent, when the ask is the person's own card: an edit after that is a new ask. */
  sent: z.string().optional(),
});
export type AskMeta = z.infer<typeof askMeta>;

export function askOf(shape: TLShape | undefined): AskMeta | undefined {
  const parsed = askMeta.safeParse(shape?.meta.ask);
  return parsed.success ? parsed.data : undefined;
}

const textOf = (s: TLShape) => ("richText" in s.props ? richTextPlain(s.props.richText).trim() : "");
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const frameOf = (editor: Editor, shape: TLShape) => {
  const found = editor.findShapeAncestor(shape, (s) => s.type === "frame");
  if (found) return found;
  // A card lifted out of its frame so the frame would not cut it off (item 113) still sits in it.
  const within = typeof shape.meta.within === "string" ? editor.getShape(shape.meta.within as TLShapeId) : undefined;
  return within?.type === "frame" ? within : undefined;
};
const targetsOf = (shape: TLShape) =>
  Array.isArray(shape.meta.targetIds) ? shape.meta.targetIds.filter((id): id is string => typeof id === "string") : [];

function setAsk(editor: Editor, shape: TLShape, ask: AskMeta) {
  // The agent's progress is not the human's edit: keep it off their undo stack.
  // Board metadata must be plain JSON, so absent fields are left out rather than set to undefined.
  const clean = Object.fromEntries(Object.entries(ask).filter(([, value]) => value !== undefined));
  editor.run(() => editor.updateShape({ id: shape.id, type: shape.type, meta: { ...shape.meta, ask: clean } }), { history: "ignore" });
}

/** How close another object must be to count as "beside" what was written. */
const NEAR = 48;

/** What sits right beside a card: position carries meaning, so the agent is given it too. */
function beside(editor: Editor, host: TLShape, skip: Set<string>) {
  const box = editor.getShapePageBounds(host);
  if (!box) return [];
  const gap = (b: { x: number; y: number; maxX: number; maxY: number }) =>
    Math.max(0, b.x - box.maxX, box.x - b.maxX) + Math.max(0, b.y - box.maxY, box.y - b.maxY);
  const page = editor.getCurrentPageShapes();
  // What is said about a left-out object (its comments, replies and notes) is as private as it is.
  const leftOut = page.filter((s) => isLeftOut(s.meta)).map((s) => s.id as string);
  const aboutLeftOut = new Set(leftOut.length ? followers(leftOut, page, new Set()) : []);
  const near = page
    .filter((s) => !skip.has(s.id) && !aboutLeftOut.has(s.id) && s.parentId === host.parentId && s.type !== "arrow" && s.type !== "frame" && !s.meta.seed && s.meta.replyTo !== host.id && !hiddenFromAgents(editor, s))
    .flatMap((s) => {
      const b = editor.getShapePageBounds(s);
      return b && gap(b) <= NEAR ? [{ s, d: gap(b) }] : [];
    })
    .sort((x, y) => x.d - y.d)
    .map((n) => n.s);
  return keepForAgent(near).kept.slice(0, 4);
}

/**
 * The card is the question. What the person wrote is sent as it stands, with the other
 * selected objects and what sits right beside it as context. No second card, no box.
 */
export function askDirect(editor: Editor, hostId: string, otherIds: string[] = []) {
  const host = editor.getShape(hostId as TLShapeId);
  const question = host ? textOf(host) : "";
  if (!host || !question) throw new Error("Write something first, then ask");
  const earlier = askOf(host);
  if (earlier && earlier.sent === question && (earlier.state === "waiting" || earlier.state === "working")) return host.id;
  const others = otherIds.flatMap((id) => editor.getShape(id as TLShapeId) ?? []).filter((s) => s.id !== host.id && s.type !== "arrow");
  // A card that already points at something (an ask written beside an answer) keeps its targets.
  const kept = targetsOf(host).flatMap((id) => editor.getShape(id as TLShapeId) ?? []);
  const skip = new Set<string>([host.id, ...others.map((s) => s.id), ...kept.map((s) => s.id)]);
  const targets = [...new Map([...kept, ...others, ...beside(editor, host, skip)].map((t) => [t.id, t])).values()];
  const around = frameOf(editor, host);
  // A question card across the frame's edge would be cut off by it; it is lifted onto the page
  // where it is (the frame it sat in is still given as its context).
  unclipFromFrame(editor, host.id);
  const frame = around && keepForAgent([around], targets.map((t) => t.id)).kept.length ? around : undefined;
  const ask: AskMeta = {
    state: "waiting",
    attempt: earlier ? earlier.attempt + 1 : 0,
    contextIds: [...targets.map((t) => t.id), ...(frame ? [frame.id] : [])],
    askedAt: Date.now(),
    sent: question,
  };
  editor.run(
    () => editor.updateShape({ id: host.id, type: host.type, meta: { ...host.meta, targetIds: targets.map((t) => t.id), ask } }),
    { history: "ignore" },
  );
  return host.id;
}

/** The person's writing: their own cards, and a first-board card they wrote over. */
export const writtenByPerson = (s: TLShape) => authorOf(s) === HUMAN || (s.meta.seed === true && typeof s.meta.updatedAt === "number");

/** True when a card the person just finished writing should go to the agent by itself. */
export function shouldSend(shape: TLShape | undefined) {
  if (!shape || !writtenByPerson(shape)) return false;
  const text = textOf(shape), ask = askOf(shape);
  if (!text) return false;
  if (ask) return ask.sent !== undefined && ask.sent !== text;
  return shape.meta.askWhenWritten === true || isQuestion(text);
}

/**
 * Asking about something the person did not write (an agent's answer, imported material):
 * a pink card opens beside it, already pointing at it, and what is written there is sent
 * when the person finishes. With a question (agents, tests) it is sent at once.
 */
export function createAsk(editor: Editor, value: { targetIds: string[]; question?: string; at?: { x: number; y: number } }) {
  const targets = value.targetIds.flatMap((id) => editor.getShape(id as TLShapeId) ?? []).filter((s) => s.type !== "arrow");
  if (!targets.length) throw new Error("Select what you mean first, then ask");
  const question = value.question?.trim() ?? "";
  const id = createComment(editor, { targetIds: targets.map((t) => t.id), text: question, at: value.at }, { name: "Ask", askWhenWritten: true }) as TLShapeId;
  if (question) askDirect(editor, id);
  return id;
}

/** Send a failed or stuck ask again. */
export function retryAsk(editor: Editor, id: string) {
  const shape = editor.getShape(id as TLShapeId), ask = askOf(shape);
  if (!shape || !ask) throw new Error("Not an ask");
  setAsk(editor, shape, { ...ask, state: "waiting", attempt: ask.attempt + 1, askedAt: Date.now(), startedAt: undefined, error: undefined, note: undefined });
  if (shape.meta.status === "resolved") resolveMark(editor, editor.getShape(shape.id)!, "open", HUMAN);
}

type Given = { id: string; type: string; author: string; text: string; mark?: AskMark; settled?: true; inside?: Given[]; insideMore?: number };
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
    return shape && !hiddenFromAgents(editor, shape) ? shapeName(shape) : undefined;
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
  const caption = found && !hiddenFromAgents(editor, found) && keep([found]).length ? found : undefined;
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
    ...(s.meta.settled === true ? { settled: true as const } : {}),
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
/**
 * Comments, agent notes, replies and answers about what a frame holds. They sit on the page, not
 * in the frame (so it never clips them), but they belong with its contents, as when the drag
 * follower moves them with it (follow.ts). Asks are left out, as frame children always were.
 */
function attachedTo(editor: Editor, frame: TLShape) {
  const pageId = editor.getAncestorPageId(frame);
  if (!pageId) return [];
  const page = [...editor.getPageShapeIds(pageId)].flatMap((id) => editor.getShape(id) ?? []);
  const subtree = [...editor.getShapeAndDescendantIds([frame.id])] as string[];
  const within = new Set(subtree);
  // What the person left out of asks inside the frame, and what it holds, brings nothing along:
  // a comment about a left-out card is as private as the card.
  const leftOut = subtree.filter((id) => id !== frame.id && isLeftOut(editor.getShape(id as TLShapeId)?.meta));
  const blocked = new Set<string>(leftOut.length ? (editor.getShapeAndDescendantIds(leftOut as TLShapeId[]) as Set<string>) : []);
  // A card lifted out of the frame (item 113) follows it by `meta.within`; one the person left out
  // still blocks what hangs off it, wherever it sits.
  const leftOutAnywhere = new Set(page.filter((s) => isLeftOut(s.meta)).map((s) => s.id as string));
  return followers(subtree.filter((id) => !blocked.has(id)), page, leftOutAnywhere)
    .flatMap((id) => editor.getShape(id as TLShapeId) ?? [])
    .filter((s) => !within.has(s.id) && !askOf(s) && !hiddenFromAgents(editor, s) && textOf(s));
}

function inside(editor: Editor, frame: TLShape, skip: Set<string>, keep: Keep = (x) => x) {
  const found: TLShape[] = [];
  const walk = (id: TLShapeId) => {
    for (const childId of editor.getSortedChildIdsForParent(id)) {
      const child = editor.getShape(childId);
      // Anything a learning prompt still hides stays out of what the agent is given.
      if (!child || skip.has(child.id) || child.type === "arrow" || askOf(child) || hiddenFromAgents(editor, child)) continue;
      // What the person left out of asks is not given, and neither is what it holds.
      if (!keep([child]).length) continue;
      if (child.type === "frame" || child.type === "group") walk(child.id);
      if (textOf(child) || media.has(child.type)) found.push(child);
    }
  };
  walk(frame.id);
  for (const s of keep(attachedTo(editor, frame).filter((a) => !skip.has(a.id)))) found.push(s);
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
    .filter((r): r is TLShape => r.typeName === "shape" && (r as TLShape).meta.replyTo === parent.id && r.id !== shape.id && !askOf(r as TLShape) && !hiddenFromAgents(editor, r as TLShape))
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

/** What the person pinned on a page for every ask there (see leave-out.ts), minus what is already given. */
export function pinnedOnPage(editor: Editor, pageId: TLPageId, given: Iterable<string>) {
  const marked = [...editor.getPageShapeIds(pageId)].flatMap((id) => editor.getShape(id) ?? []).filter((s) => s.type !== "arrow" && isPinned(s.meta));
  if (!marked.length) return { pinned: [] as TLShape[], more: 0 };
  const found = pinnedFor(
    marked.map((shape) => {
      const b = editor.getShapePageBounds(shape);
      return { id: shape.id, x: b?.x ?? 0, y: b?.y ?? 0, meta: shape.meta, hidden: hiddenFromAgents(editor, shape), shape };
    }),
    given,
  );
  return { pinned: found.pinned.map((p) => p.shape), more: found.more };
}

/**
 * The rest of the group the ask's card sits in (objects chained within CLUSTER_GAP at its own
 * level), each with where it sits relative to the card, minus what the ask already gives.
 * Answers to this ask, the first board's seeded cards, hidden and left-out objects are not part of it.
 */
function groupOf(editor: Editor, host: TLShape, skip: ReadonlySet<string>, keep: Keep) {
  const placed = editor
    .getSortedChildIdsForParent(host.parentId)
    .flatMap((id) => editor.getShape(id) ?? [])
    .filter((s) => s.id === host.id || (s.type !== "arrow" && s.type !== "frame" && !s.meta.seed && s.meta.replyTo !== host.id && !hiddenFromAgents(editor, s)))
    .flatMap((s) => {
      const b = editor.getShapePageBounds(s);
      return b ? [{ id: s.id as string, x: b.x, y: b.y, w: b.w, h: b.h }] : [];
    });
  const found = clusterAround(placed, host.id, skip);
  // A left-out member is withheld (and counted as such), like anything else around the ask.
  const kept = new Set<string>(keep(found.members.flatMap((m) => editor.getShape(m.id as TLShapeId) ?? [])).map((s) => s.id));
  const members = found.members.filter((m) => kept.has(m.id)).map((m) => ({ ...given(editor, editor.getShape(m.id as TLShapeId)!, 400, keep), relation: m.relation }));
  // The group's name, as the overview (O) shows it, from everything in it but the ask's own card
  // (an ask is never the name of what it asks about) and what the person left out.
  const whole = clusterAround(placed, host.id, new Set(), Infinity).members.flatMap((m) => editor.getShape(m.id as TLShapeId) ?? []);
  // Filtered without counting: naming the group must not change how many objects the ask says it withheld.
  const name = whole.length ? groupName(editor, keepForAgent(whole, []).kept) : undefined;
  return { members, more: found.more, ...(name ? { name } : {}) };
}

/** Where a target sits relative to the ask's card, in words, when both are on the board and apart from each other. */
function whereFrom(editor: Editor, target: TLShape, host: TLShape): { relation?: string } {
  if (target.id === host.id) return {};
  const a = editor.getShapePageBounds(target), b = editor.getShapePageBounds(host);
  if (!a || !b) return {};
  return { relation: relation({ id: target.id, x: a.x, y: a.y, w: a.w, h: a.h }, { id: host.id, x: b.x, y: b.y, w: b.w, h: b.h }) };
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
  const around = frameOf(editor, selected[0] ?? shape);
  const frame = around && keep([around]).length ? around : undefined;
  const skip = new Set<string>([shape.id, ...targets.map((t) => t.id)]);
  const givenTargets = targets.map((t) => {
    if (t.type !== "frame") return { ...given(editor, t, 2000, keep), ...whereFrom(editor, t, shape) };
    const held = inside(editor, t, skip, keep);
    return { ...given(editor, t, 2000, keep), inside: held.inside, ...(held.more ? { insideMore: held.more } : {}) };
  });
  const frameObjects = frame
    ? keep(
        editor
          .getSortedChildIdsForParent(frame.id)
          .flatMap((id) => editor.getShape(id) ?? [])
          .filter((s) => !skip.has(s.id) && s.type !== "arrow" && !askOf(s) && !hiddenFromAgents(editor, s) && (textOf(s) || s.type === "chart" || s.type === "dataset"))
          .concat(attachedTo(editor, frame).filter((a) => !skip.has(a.id))),
      ).slice(0, 12)
    : [];
  // Where things sit carries meaning: the group the card is in, said with relations. What the
  // ask already gives (targets, and the frame's objects when the card is in a frame) is not repeated.
  const group = editor.getShapePageBounds(shape)
    ? groupOf(editor, shape, new Set([...skip, ...(frame ? editor.getSortedChildIdsForParent(frame.id) : []), ...frameObjects.map((s) => s.id)]), keep)
    : { members: [], more: 0 };
  // Pinned for every ask on this page, unless this ask already gives it.
  const alreadyGiven = [...skip, ...group.members.map((m) => m.id), ...(frame ? [frame.id] : []), ...frameObjects.map((s) => s.id), ...givenTargets.flatMap((t) => t.inside?.map((i) => i.id) ?? [])];
  const pins = page ? pinnedOnPage(editor, page.id, alreadyGiven) : { pinned: [], more: 0 };
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
    targets: givenTargets,
    history: mergeHistory(targets.flatMap((t) => thread(editor, t, keep)), targets.map((t) => t.id)),
    ...(frame
      ? {
          frame: {
            id: frame.id,
            name: shapeName(frame),
            objects: frameObjects.map((s) => given(editor, s, 400, keep)),
          },
        }
      : {}),
    ...(group.members.length ? { cluster: group.members, ...(group.more ? { clusterMore: group.more } : {}) } : {}),
    // What the group the card sits in is called, even when everything in it is already a target.
    ...(group.name ? { group: group.name } : {}),
    // Counted once the parts above are built: how many objects the person kept out of this ask.
    ...(withheld.size ? { leftOut: withheld.size } : {}),
    ...(pins.pinned.length ? { pinned: pins.pinned.map((s) => given(editor, s, 400)), ...(pins.more ? { pinnedMore: pins.more } : {}) } : {}),
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
  const texts = answerTexts(input);
  // The room the person's window has beside the canvas chrome, so no answer lands off screen.
  const available = (editor.getViewportScreenBounds().w - ANSWER_CHROME) / editor.getZoomLevel();
  const layout = answerLayout({ x: anchor.x, y: bottom }, texts, available);
  // Under the ask, or beside it when the space under it is taken (later asks stacked below),
  // so the answer never ends up under someone else's question.
  const under = freeSpot(editor, layout.box, new Set([shape.id]), pageId);
  const besideBox = { ...layout.box, x: anchor.maxX + BESIDE_GAP, y: anchor.y };
  const beside = freeSpot(editor, besideBox, new Set([shape.id]), pageId);
  const spot = pickAnswerSpot(under.y - layout.box.y, beside.y - besideBox.y) === "under" ? under : beside;
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
      if (input.alternatives && input.dimensions) {
        const card = editor.getShape(id as TLShapeId)!;
        editor.updateShape({ id: card.id, type: card.type, props: { richText: optionRichText(text, input.dimensions) } } as never);
      }
      rowBottom = Math.max(rowBottom, editor.getShapePageBounds(id as TLShapeId)?.maxY ?? rowY);
      return id;
    });
    // The room was checked with estimated heights; the cards now have their measured ones. If
    // they reach something below that room, the whole answer moves down until it is clear.
    const boxes = made.flatMap((id) => editor.getShapePageBounds(id as TLShapeId) ?? []);
    if (boxes.length) {
      const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
      const real = { x, y, w: Math.max(...boxes.map((b) => b.maxX)) - x, h: Math.max(...boxes.map((b) => b.maxY)) - y };
      const skip = new Set<string>([shape.id, ...made]);
      const down = freeSpot(editor, real, skip, pageId);
      if (down.y > real.y) {
        // As when it was placed: under the ask unless that is much further than beside it.
        const besideReal = { ...real, x: anchor.maxX + BESIDE_GAP, y: anchor.y };
        const side = freeSpot(editor, besideReal, skip, pageId);
        const to = pickAnswerSpot(down.y - real.y, side.y - besideReal.y) === "under" ? down : side;
        const dx = to.x - real.x, dy = to.y - real.y;
        for (const id of made) {
          const card = editor.getShape(id as TLShapeId);
          if (card) editor.updateShape({ id: card.id, type: card.type, x: card.x + dx, y: card.y + dy });
        }
      }
    }
    setAsk(editor, editor.getShape(shape.id)!, { ...ask, state: "answered", agent: actor, answeredAt, read: input.read, note: undefined, error: undefined });
    // A clarifying question hands the turn back, so the ask stays open.
    // An answer closes the queue row (a comment's, or the person's own card's); a clarifying
    // question hands the turn back, so it stays open.
    if (!input.question && shape.meta.status !== "resolved") resolveMark(editor, editor.getShape(shape.id)!, "resolved", actor);
    return made;
  });
  return { ask: describeAsk(editor, editor.getShape(shape.id)!), answers: ids.map((id) => describeObject(editor, id, true)) };
}
