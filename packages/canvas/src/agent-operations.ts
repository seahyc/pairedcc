import { relationships, relationshipsOf, sourceOf, transformationOf, type ArrowEnd, type PrimitiveRecord } from "./primitives";
import { prototypeRefusal } from "./prototype-flags";
import {
  AssetRecordType,
  createShapeId,
  PageRecordType,
  toRichText,
  type Editor,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import { sceneInput, orderedScene, arrangeInput, duplicateInput, layoutPositions, groupInput, frameAround } from "./composition";
import { z } from "zod";
import {
  annotationInput,
  connectionInput,
  imageInput,
  resolveInput,
  feedbackInput,
  replyInput,
  type CanvasCommand,
} from "./protocol";
import {
  createObject,
  patchObject,
  describeObject,
  createBridge,
  richTextPlain,
  revision,
} from "./operations";
import { createPrompt } from "./learning/prompt-shape";
import { bendFor, chooseAnchors } from "./connector-follow";
import { convergeInput, placeBeside, synthesisText } from "./converge/model";
import { overview } from "./overview";
import { matchesText } from "./read-filter";
import { createChart, createDataset, dataFields, recordInputs, setChartState, setDatasetCell, summaryProps } from "./data/agent";
import { agentStyle, collectMarks, collectFeedback, collectLooseNotes, authorOf, humanStyle, HUMAN, resolveMark } from "./scratchbook";
import { answerAsk, listAsks, setAskStatus } from "./asks";
import { feedbackCounts, feedbackMarkdown, filterFeedback } from "./feedback";
import { importForAgent } from "./import-board";

const cardInput = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().min(80).max(4000).optional(),
  text: z.string().max(50000).default(""),
  name: z.string().max(200).optional(),
  style: z.enum(["note", "heading", "quote", "code"]).optional(),
});
/** A comfortable line of handwriting: about six words. */
export const HUMAN_CARD_W = 300;
const agentWidths = { agent: 420, heading: 440, quote: 380, code: 360 } as const;

/**
 * The style a card was written in, as agents name it on create: note, heading, quote or
 * code; "handwriting" for the person's cards and "caption" for image captions.
 */
export function cardStyle(tone: unknown): string | undefined {
  if (tone === "agent") return "note";
  if (tone === "human") return "handwriting";
  return typeof tone === "string" ? tone : undefined;
}

/** Scratchbook card: lavender typed note for agents, pink handwritten scrap for the human. */
export function createCard(editor: Editor, value: unknown, author: string, meta: Record<string, unknown> = {}) {
  const input = cardInput.parse(value), id = createShapeId(), human = author === HUMAN;
  // The human always writes by hand; agents pick a text style for what they are writing.
  const tone = human ? "human" : input.style && input.style !== "note" ? input.style : "agent";
  editor.createShape({
    id,
    type: "card",
    x: input.x,
    y: input.y,
    meta: {
      name: input.name ?? (input.text.split("\n")[0].slice(0, 48) || (human ? "Note" : "Agent note")),
      revision: 0,
      ...(human ? {} : { createdBy: author }),
      ...meta,
    },
    props: { w: input.width ?? (human ? HUMAN_CARD_W : agentWidths[tone as keyof typeof agentWidths]), richText: toRichText(input.text), tone },
  });
  return id;
}

/** Agents' notes become cards; other primitives pass through unchanged. */
function createFor(editor: Editor, value: unknown, actor: string) {
  const kind = value && typeof value === "object" ? (value as { kind?: unknown }).kind : undefined;
  if (kind === "note" && actor !== HUMAN) {
    editor.markHistoryStoppingPoint("create card");
    const id = createCard(editor, value, actor);
    editor.select(id);
    return id;
  }
  return createObject(editor, value);
}

function placeCaption(editor: Editor, imageId: string) {
  const image = find(editor, imageId);
  const caption = editor.getCurrentPageShapes().find(s => s.meta.role === "caption" && s.meta.captionFor === image.id);
  if (!caption || !("h" in image.props)) return;
  if (caption.parentId !== image.parentId) editor.reparentShapes([caption.id], image.parentId);
  editor.updateShape({ id: caption.id, type: caption.type, x: image.x, y: image.y + image.props.h + 6 });
}

const idInput = z.object({
  id: z.string().startsWith("shape:"),
  includeAsset: z.boolean().default(false),
});
export const focusInput = z.object({ ids: z.array(z.string()).optional() });

export const readInput = z.object({
  ids: z.array(z.string()).optional(),
  text: z.string().max(200).optional(),
});

function find(editor: Editor, id: string) {
  const s = editor.getCurrentPageShapes().find((s) => s.id === id);
  if (!s) throw new Error(`Object not found: ${id}`);
  return s;
}

function checkedObjects(editor: Editor, objects: z.infer<typeof arrangeInput>["objects"]) {
  if (new Set(objects.map(object => object.id)).size !== objects.length)
    throw new Error("Object IDs must be unique");
  const shapes = objects.map(object => {
    const shape = find(editor, object.id);
    if (shape.isLocked || editor.isShapeOrAncestorLocked(shape)) throw new Error("Unlock objects before changing them");
    if (revision(shape) !== object.expectedRevision) throw new Error(`Object changed: ${shape.id}. Read before changing it.`);
    return shape;
  });
  const ids = new Set(shapes.map(shape => shape.id));
  for (const shape of shapes) {
    let parent = editor.getShape(shape.parentId);
    while (parent) {
      if (ids.has(parent.id)) throw new Error("Specify the parent or its descendants, not both");
      parent = editor.getShape(parent.parentId);
    }
  }
  return shapes;
}

export function atomic<T>(editor: Editor, name: string, work: () => T): T {
  const mark = editor.markHistoryStoppingPoint(name);
  try {
    const result = work();
    editor.squashToMark(mark);
    return result;
  } catch (error) {
    editor.bailToMark(mark);
    throw error;
  }
}

function composeScene(editor: Editor, value: unknown, actor: string) {
  const input = sceneInput.parse(value), nodes = orderedScene(input);
  return atomic(editor, input.name, () => {
    const objects = new Map<string, TLShape>();
    for (const node of nodes) {
      const created = node.shape.kind === "image"
        ? image(editor, node.shape, actor)
        : describeObject(editor, createFor(editor, node.shape, actor));
      if (!created) throw new Error(`Could not create ${node.key}`);
      let shape = find(editor, created.id);
      if (node.parentKey) {
        const parent = objects.get(node.parentKey);
        if (!parent) throw new Error(`Missing frame ${node.parentKey}`);
        editor.reparentShapes([shape.id], parent.id);
      }
      editor.updateShape({ id: shape.id, type: shape.type, x: node.shape.x, y: node.shape.y,
        meta: { ...shape.meta, createdBy: actor, scene: input.name, sceneKey: node.key } });
      if (shape.type === "image") placeCaption(editor, shape.id);
      shape = find(editor, shape.id);
      objects.set(node.key, shape);
    }
    const connections = input.connections.map(connection => {
      const from = objects.get(connection.fromKey), to = objects.get(connection.toKey);
      if (!from || !to) throw new Error("Missing connection endpoint");
      return connect(editor, { ...connection, fromId: from.id, toId: to.id }, actor);
    });
    const roots = [...objects.values()].filter(shape => shape.parentId === editor.getCurrentPageId());
    editor.select(...roots.map(shape => shape.id));
    return { name: input.name, objects: Object.fromEntries([...objects].map(([key, shape]) => [key, describeObject(editor, shape.id)])), connections };
  });
}
export function image(editor: Editor, value: unknown, actor: string) {
  const input = imageInput.parse(value),
    assetId = AssetRecordType.createId(),
    id = createShapeId();
  const mimeType = input.src.slice(5, input.src.indexOf(";"));
  editor.markHistoryStoppingPoint("agent image");
  editor.run(() => {
    editor.createAssets([
      AssetRecordType.create({
        id: assetId,
        type: "image",
        props: {
          src: input.src,
          w: input.width,
          h: input.height,
          name: input.name,
          mimeType,
          isAnimated: input.isAnimated,
        },
      }),
    ]);
    editor.createShape({
      id,
      type: "image",
      x: input.x,
      y: input.y,
      meta: {
        name: input.name,
        createdBy: actor,
        revision: 0,
        ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      },
      props: { assetId, w: input.width, h: input.height },
    });
    if (input.caption)
      editor.createShape({
        type: "card",
        x: input.x,
        y: input.y + input.height + 6,
        meta: { name: "Caption", role: "caption", captionFor: id, createdBy: actor, revision: 0 },
        props: { w: Math.max(80, input.width), richText: toRichText(input.caption), tone: "caption" },
      });
  });
  const captionId = editor.getCurrentPageShapes().find(s => s.meta.role === "caption" && s.meta.captionFor === id)?.id;
  const described = describeObject(editor, id);
  if (!described) throw new Error("Could not place the image");
  return { ...described, ...(captionId ? { captionId } : {}) };
}
type Anchor = { x: number; y: number };
/** Fixed anchors (normalised 0..1 on each shape) instead of choosing sides from the angle. */
export type ConnectAnchors = { start: Anchor; end: Anchor };
export function connect(editor: Editor, value: unknown, actor: string, anchors?: ConnectAnchors) {
  const input = connectionInput.parse(value),
    { fromId, toId } = input,
    from = find(editor, fromId),
    to = find(editor, toId);
  if (from.id === to.id) throw new Error("Connect two different objects");
  const a = editor.getShapePageBounds(from),
    b = editor.getShapePageBounds(to);
  if (!a || !b) throw new Error("Objects must have visible bounds");
  const id = createShapeId();
  // Thariq-style connector: thin indigo line with a filled head. Arrows leaving the same
  // side of a card share one anchor point, so several of them fan out from it.
  // Facing sides; src/connector-follow.ts re-picks them when either object moves.
  const facing = chooseAnchors(a, b);
  const startAnchor = anchors?.start ?? facing.start;
  const endAnchor = anchors?.end ?? facing.end;
  // A fixed edge-to-edge route runs straight; the bend is tuned for the chosen sides only.
  const bend = anchors ? 0 : bendFor(facing);
  editor.markHistoryStoppingPoint("connect objects");
  editor.run(() => {
    editor.createShape({
      id,
      type: "arrow",
      x: a.x + startAnchor.x * a.w,
      y: a.y + startAnchor.y * a.h,
      meta: { fromId, toId, relation: input.relation, createdBy: actor, ...(anchors ? { fixedAnchors: true } : {}) },
      props: {
        start: { x: 0, y: 0 },
        end: { x: b.x + endAnchor.x * b.w - (a.x + startAnchor.x * a.w), y: b.y + endAnchor.y * b.h - (a.y + startAnchor.y * a.h) },
        color: actor === HUMAN ? humanStyle.ink : agentStyle.ink,
        dash: "solid",
        size: "s",
        arrowheadEnd: "triangle",
        bend,
        richText: toRichText(input.label),
      },
    });
    for (const [terminal, target, anchor] of [
      ["start", from, startAnchor],
      ["end", to, endAnchor],
    ] satisfies ["start" | "end", typeof from, { x: number; y: number }][]) {
      editor.createBinding({
        type: "arrow",
        fromId: id,
        toId: target.id,
        props: {
          terminal,
          normalizedAnchor: anchor,
          isPrecise: true,
          isExact: false,
          snap: "none",
        },
      });
    }
  });
  return describeObject(editor, id);
}
/**
 * PROTOTYPE: pull alternatives into one synthesis card. The card records each source as an
 * input (so it shows as stale when a source changes) and gets a derived-from arrow from each.
 */
export function converge(editor: Editor, value: unknown, actor: string) {
  const input = convergeInput.parse(value);
  return placeSynthesis(editor, input.sourceIds, actor, { ...synthesisText(input), name: input.name ?? "Synthesis", points: input.points, at: input.x !== undefined && input.y !== undefined ? { x: input.x, y: input.y } : undefined });
}

/**
 * The person's converge: from two or more selected objects, an empty synthesis card linked
 * the same way, in typing mode, so they write the conclusion in their own words.
 */
export function convergeForPerson(editor: Editor, sourceIds: string[]) {
  if (sourceIds.length < 2) throw new Error("Select at least two objects to pull together");
  const { letters } = synthesisText({ sourceIds, text: "", points: [] });
  const made = placeSynthesis(editor, sourceIds, HUMAN, { text: "", letters, name: "Synthesis" });
  editor.setEditingShape(made.synthesis!.id as TLShapeId);
  return made;
}

function placeSynthesis(
  editor: Editor,
  sourceIds: string[],
  actor: string,
  card: { text: string; letters: Map<string, string>; name: string; points?: unknown; at?: { x: number; y: number } },
) {
  const sources = sourceIds.map((id) => find(editor, id));
  for (const s of sources) if (editor.isShapeHidden(s)) throw new Error(`${s.id} is hidden; a synthesis must come from what the person can see`);
  if (sources.some((s) => s.type === "arrow")) throw new Error("Connections cannot be sources; pass the objects they join");
  const boxes = sources.map((s) => editor.getShapePageBounds(s)).filter((b): b is NonNullable<typeof b> => !!b);
  const at = card.at ?? placeBeside(boxes);
  const inputs = recordInputs(editor, sourceIds);
  editor.markHistoryStoppingPoint("converge");
  let id = "";
  const connections: unknown[] = [];
  editor.run(() => {
    id = createCard(editor, { kind: "note", x: at.x, y: at.y, text: card.text, name: card.name }, actor, {
      role: "synthesis",
      convergedFrom: sourceIds,
      ...(card.points ? { points: card.points } : {}),
      inputs,
    });
    // Each arrow carries its source's letter, which the card's claims cite. With the synthesis
    // to the right of its sources, arrows run from each source's right edge to the card's left
    // edge, so they never cut across the stacked sources.
    const placed = editor.getShapePageBounds(id as never);
    for (const [i, source] of sourceIds.entries()) {
      const box = boxes[i];
      const rightward = placed && box && placed.x >= box.x + box.w;
      const anchors = rightward ? { start: { x: 1, y: 0.5 }, end: { x: 0, y: (i + 1) / (sourceIds.length + 1) } } : undefined;
      connections.push(connect(editor, { fromId: source, toId: id, relation: "derived-from", label: card.letters.get(source) }, actor, anchors));
    }
  });
  return { synthesis: describeObject(editor, id), sources: sourceIds, labels: Object.fromEntries(card.letters), connections };
}

export function annotateObject(editor: Editor, value: unknown) {
  const input = annotationInput.parse(value),
    target = find(editor, input.targetId),
    bounds = editor.getShapePageBounds(target);
  if (!bounds) throw new Error("Target must have bounds");
  const x = input.x ?? bounds.x, y = input.y ?? bounds.maxY + 60;
  const meta = { name: input.author === HUMAN ? "Feedback" : "Agent note", role: "annotation", targetId: target.id, status: "open", author: input.author };
  editor.markHistoryStoppingPoint("add feedback");
  let id = createShapeId();
  editor.run(() => {
    id = createCard(editor, { x, y, text: input.text }, input.author, meta);
    connect(
      editor,
      { fromId: id, toId: target.id, relation: "feedback" },
      input.author,
    );
  });
  return describeObject(editor, id);
}
type Rect = { x: number; y: number; w: number; h: number };
const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Nudge a new card down until it no longer sits on top of something else. */
export function freeSpot(editor: Editor, box: Rect, ignore: Set<string> = new Set()) {
  const others = editor
    .getCurrentPageShapes()
    .filter((s) => s.type !== "frame" && s.type !== "arrow" && !ignore.has(s.id))
    .flatMap((s) => editor.getShapePageBounds(s) ?? []);
  const spot = { ...box };
  // Leave a little air around the new card, and keep going past a tall column of earlier answers.
  const roomy = () => ({ x: spot.x - 8, y: spot.y - 14, w: spot.w + 16, h: spot.h + 28 });
  for (let i = 0; i < 60 && others.some((o) => hits(roomy(), o)); i++) spot.y += 28;
  return spot;
}

/**
 * The human's comment: a pink handwritten card pinned to the selected objects (with an
 * arrow to each) or to a spot on the board. It joins the feedback queue as an open item.
 */
export function createComment(editor: Editor, value: { targetIds?: string[]; x?: number; y?: number; text?: string }, extra: Record<string, unknown> = {}) {
  const targets = (value.targetIds ?? []).map((id) => find(editor, id));
  let x = value.x ?? 0, y = value.y ?? 0;
  if (targets.length) {
    const boxes = targets.flatMap((t) => editor.getShapePageBounds(t) ?? []);
    if (!boxes.length) throw new Error("Target must have bounds");
    // A card inside a group (an imported record) is commented on from beside the whole group, level with the card.
    const outer = (t: TLShape): TLShape => {
      const parent = editor.getShape(t.parentId);
      return parent?.type === "group" ? outer(parent) : t;
    };
    const around = targets.flatMap((t) => editor.getShapePageBounds(outer(t)) ?? []);
    const right = Math.max(...boxes.map((b) => b.maxX), ...around.map((b) => b.maxX)), top = Math.min(...boxes.map((b) => b.y));
    const spot = freeSpot(editor, { x: right + 56, y: top, w: HUMAN_CARD_W, h: 72 }, new Set(targets.map((t) => t.id)));
    x = spot.x;
    y = spot.y;
  }
  const meta = {
    name: "Feedback",
    role: "annotation",
    status: "open",
    author: HUMAN,
    ...(targets.length ? { targetId: targets[0].id, targetIds: targets.map((t) => t.id) } : {}),
    ...extra,
  };
  let id = createShapeId();
  return atomic(editor, "add comment", () => {
    id = createCard(editor, { x, y, text: value.text ?? "" }, HUMAN, meta);
    for (const target of targets) connect(editor, { fromId: id, toId: target.id, relation: "feedback" }, HUMAN);
    return id;
  });
}

/** An agent's answer to a feedback item, placed directly under it (and under earlier replies). */
export function replyToFeedback(editor: Editor, value: unknown, actor: string) {
  const input = replyInput.parse(value);
  const item = collectFeedback(editor).find((i) => i.id === input.id);
  if (!item) throw new Error("Not a feedback item. Use ids from the feedback operation.");
  if (item.pageId !== editor.getCurrentPageId())
    throw new Error(`That item is on page "${item.pageName}". Ask the human to open that page, then reply.`);
  const anchor = editor.getShapePageBounds(find(editor, input.id));
  if (!anchor) throw new Error("Feedback item has no bounds");
  let bottom = anchor.maxY;
  for (const reply of item.replies) {
    const shape = editor.getShape(reply.id as TLShape["id"]);
    const bounds = shape && editor.getShapePageBounds(shape);
    if (bounds) bottom = Math.max(bottom, bounds.maxY);
  }
  const id = atomic(editor, "reply to feedback", () =>
    createCard(editor, { x: anchor.x + 14, y: bottom + 10, width: 300, text: input.text }, actor, {
      name: "Reply",
      role: "annotation",
      status: "open",
      author: actor,
      targetId: input.id,
      replyTo: input.id,
    }),
  );
  return { reply: describeObject(editor, id), item: collectFeedback(editor).find((i) => i.id === input.id) };
}

/** The whole feedback queue in one call: comments, picks, rejects and ink, with replies. */
export function readFeedback(editor: Editor, value: unknown = {}) {
  const input = feedbackInput.parse(value);
  const all = collectFeedback(editor, { allPages: input.allPages });
  const items = filterFeedback(all, input.status);
  const title = editor.getPages().map((p) => p.name).join(", ");
  return {
    board: { currentPageId: editor.getCurrentPageId(), pages: editor.getPages().map((p) => ({ id: p.id, name: p.name })) },
    counts: feedbackCounts(all),
    items,
    notes: collectLooseNotes(editor),
    ...(input.format === "markdown" ? { markdown: feedbackMarkdown(items, { title, exportedAt: new Date() }) } : {}),
  };
}

export function readCanvas(editor: Editor, value: unknown = {}) {
  const input = readInput.parse(value);
  const objects = editor
    .getCurrentPageShapesSorted()
    .filter((s) => !input.ids || input.ids.includes(s.id))
    .map((s) => {
      const object = describeObject(editor, s.id);
      let asset;
      if ("assetId" in s.props && s.props.assetId) {
        const a = editor.getAsset(s.props.assetId);
        if (a && a.type !== "bookmark")
          asset = {
            id: a.id,
            name: a.props.name,
            mimeType: a.props.mimeType,
            width: a.props.w,
            height: a.props.h,
            isAnimated: a.props.isAnimated,
          };
      }
      // Data objects are summarised: rows and bars appear in dataset/widget, rows only via get.
      const props = object && summaryProps(s.type, object.props as Record<string, unknown>);
      return {
        ...object,
        props,
        ...dataFields(editor, s),
        text:
          "richText" in s.props ? richTextPlain(s.props.richText) : undefined,
        author: authorOf(s),
        ...(s.type === "card" ? { style: cardStyle((s.props as { tone?: unknown }).tone) } : {}),
        meta: s.meta,
        asset,
      };
    })
    .filter((o) => !input.text || matchesText(input.text, o.text, o.name as string | undefined));
  const annotations = editor
    .getCurrentPageShapes()
    .filter((s) => s.meta.role === "annotation")
    .map((s) => ({
      id: s.id,
      revision: revision(s),
      targetId: s.meta.targetId,
      status: s.meta.status,
      author: s.meta.author,
      text: "richText" in s.props ? richTextPlain(s.props.richText) : "",
    }));
  return {
    page: editor.getCurrentPage(),
    pages: editor.getPages(),
    selection: editor.getSelectedShapeIds(),
    objects,
    annotations,
    marks: collectMarks(editor),
    bindings: editor
      .getCurrentPageShapes()
      .filter((s) => s.type === "arrow")
      .flatMap((s) => editor.getBindingsFromShape(s.id, "arrow")),
  };
}

/** PROTOTYPE: the object's relationships on its page, its source and the transformation behind it. */
function primitiveFields(editor: Editor, s: TLShape) {
  const page = editor.getAncestorPageId(s.id);
  const shapes = page ? [...editor.getSortedChildIdsForParent(page)].flatMap(function all(id): TLShape[] {
    const shape = editor.getShape(id);
    return shape ? [shape, ...editor.getSortedChildIdsForParent(id).flatMap(all)] : [];
  }) : [s];
  const ends: ArrowEnd[] = shapes
    .filter((a) => a.type === "arrow")
    .flatMap((a) => editor.getBindingsFromShape(a.id, "arrow").map((b) => ({ arrowId: a.id, terminal: (b.props as { terminal: "start" | "end" }).terminal, toId: b.toId })));
  const source = sourceOf(s as PrimitiveRecord), transformation = transformationOf(s as PrimitiveRecord);
  return {
    relationships: relationshipsOf(s.id, relationships(shapes as PrimitiveRecord[], ends)),
    ...(source ? { source } : {}),
    ...(transformation ? { transformation } : {}),
  };
}

export async function executeCommand(
  editor: Editor,
  command: CanvasCommand,
  actor: string,
): Promise<unknown> {
  const refusal = prototypeRefusal(command.op);
  if (refusal) throw new Error(refusal);
  switch (command.op) {
    case "scene":
      return composeScene(editor, command.input, actor);
    case "arrange": {
      const input = arrangeInput.parse(command.input);
      const shapes = checkedObjects(editor, input.objects);
      const boxes = shapes.map(shape => {
        const bounds = editor.getShapePageBounds(shape);
        if (!bounds) throw new Error("Object has no visible bounds");
        return bounds;
      });
      const positions = layoutPositions(boxes, input);
      return atomic(editor, "arrange objects", () => {
        editor.run(() => shapes.forEach((shape, i) => {
          const bounds = boxes[i], target = positions[i];
          const transform = editor.getShapePageTransform(shape);
          const origin = transform.applyToPoint({ x: 0, y: 0 });
          const point = editor.getPointInParentSpace(shape, { x: origin.x + target.x - bounds.x, y: origin.y + target.y - bounds.y });
          editor.updateShape({ id: shape.id, type: shape.type, x: point.x, y: point.y });
        }));
        return { objects: shapes.map(shape => describeObject(editor, shape.id)) };
      });
    }
    case "group": {
      // Wrap objects in a named frame without moving them. All or nothing: a stale or locked
      // object rejects the whole call, and the frame and its reparenting are one undo step.
      const input = groupInput.parse(command.input);
      const shapes = checkedObjects(editor, input.objects);
      const parentId = shapes[0].parentId;
      if (shapes.some((shape) => shape.parentId !== parentId)) throw new Error("Group objects that share a parent: all on the page, or all in one frame");
      const boxes = shapes.map((shape) => editor.getShapePageBounds(shape));
      if (boxes.some((b) => !b)) throw new Error("Objects must have visible bounds");
      const box = frameAround(boxes.map((b) => ({ x: b!.x, y: b!.y, w: b!.w, h: b!.h })), input.padding);
      // A frame over objects outside the group would hide them and misstate what belongs together.
      const grouped = new Set(shapes.map((shape) => shape.id));
      const covered = editor
        .getSortedChildIdsForParent(parentId)
        .map((childId) => editor.getShape(childId)!)
        .filter((other) => other && !grouped.has(other.id) && other.type !== "arrow")
        .filter((other) => {
          const b = editor.getShapePageBounds(other);
          return b && b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
        });
      if (covered.length)
        throw new Error(`The frame would cover ${covered.map((o) => o.id).join(", ")}, which ${covered.length === 1 ? "is" : "are"} not in the group. Include ${covered.length === 1 ? "it" : "them"}, move ${covered.length === 1 ? "it" : "them"} (canvas_arrange), or lower padding. Nothing was changed.`);
      return atomic(editor, "group objects", () => {
        const id = createShapeId();
        editor.createShape({ id, type: "frame", x: box.x, y: box.y, meta: { name: input.name, revision: 0, createdBy: actor }, props: { w: box.w, h: box.h, name: input.name } });
        if (parentId !== editor.getCurrentPageId()) editor.reparentShapes([id], parentId);
        editor.reparentShapes(shapes.map((shape) => shape.id), id);
        return { frame: describeObject(editor, id), objects: shapes.map((shape) => describeObject(editor, shape.id)) };
      });
    }
    case "duplicate": {
      const input = duplicateInput.parse(command.input);
      const shapes = checkedObjects(editor, input.objects);
      return atomic(editor, "duplicate exploration", () => {
        const before = new Set(editor.getCurrentPageShapeIds());
        editor.duplicateShapes(shapes, { x: input.offsetX, y: input.offsetY });
        const created = editor.getCurrentPageShapes().filter(shape => !before.has(shape.id));
        if (!created.length) throw new Error("Canvas could not create the duplicate objects");
        const feedbackTargets = new Map<string, string>();
        for (const shape of created) {
          if (shape.type !== "arrow" || shape.meta.relation !== "feedback") continue;
          const bindings = editor.getBindingsFromShape(shape.id, "arrow");
          const start = bindings.find(binding => binding.props.terminal === "start");
          const end = bindings.find(binding => binding.props.terminal === "end");
          if (start && end) feedbackTargets.set(start.toId, end.toId);
        }
        editor.run(() => {
          for (const shape of created) {
            const bindings = shape.type === "arrow" ? editor.getBindingsFromShape(shape.id, "arrow") : [];
            const start = bindings.find(binding => binding.props.terminal === "start");
            const end = bindings.find(binding => binding.props.terminal === "end");
            editor.updateShape({ id: shape.id, type: shape.type,
              meta: { ...shape.meta, createdBy: actor, duplicated: true,
                ...(start ? { fromId: start.toId } : {}),
                ...(end ? { toId: end.toId } : {}),
                ...(feedbackTargets.has(shape.id) ? { targetId: feedbackTargets.get(shape.id) } : {}),
              } });
          }
        });
        return { objects: created.map(shape => describeObject(editor, shape.id)), selection: editor.getSelectedShapeIds() };
      });
    }
    case "overview":
      return overview(editor, command.input ?? {});
    case "runs":
    case "undo_run":
      throw new Error("Agent runs are handled by the command runner");
    case "read":
      return readCanvas(editor, command.input ?? {});
    case "get": {
      const { id, includeAsset } = idInput.parse(command.input),
        s = find(editor, id);
      const result = describeObject(editor, id);
      const asset =
        "assetId" in s.props && s.props.assetId
          ? editor.getAsset(s.props.assetId)
          : undefined;
      return {
        ...result,
        ...(s.type === "card" ? { style: cardStyle((s.props as { tone?: unknown }).tone) } : {}),
        meta: s.meta,
        ...dataFields(editor, s, true),
        ...primitiveFields(editor, s),
        ...(asset && includeAsset ? { asset } : {}),
      };
    }
    case "create": {
      const inputIds = z.object({ inputs: z.array(z.string().startsWith("shape:")).max(50).optional() }).parse(command.input ?? {}).inputs;
      const inputs = inputIds ? recordInputs(editor, inputIds) : undefined;
      const id = createFor(editor, command.input, actor);
      const s = find(editor, id);
      editor.updateShape({
        id: s.id,
        type: s.type,
        meta: { ...s.meta, createdBy: actor, ...(inputs ? { inputs } : {}) },
      });
      return describeObject(editor, id);
    }
    case "update":
      return patchObject(editor, command.input);
    case "learn":
      return createPrompt(editor, command.input, actor);
    case "converge":
      return converge(editor, command.input, actor);
    case "dataset":
      return createDataset(editor, command.input, actor);
    case "chart":
      return createChart(editor, command.input, actor);
    case "chart_state":
      return setChartState(editor, command.input);
    case "cell":
      return setDatasetCell(editor, command.input);
    case "image":
      return image(editor, command.input, actor);
    case "connect":
      return connect(editor, command.input, actor);
    case "annotate":
      return annotateObject(editor, {
        ...annotationInput.parse(command.input),
        author: actor,
      });
    case "resolve": {
      // Marks on other pages can be resolved too: the queue spans the board.
      const input = resolveInput.parse(command.input),
        s = editor.getShape(input.id as TLShape["id"]);
      if (!s) throw new Error(`Object not found: ${input.id}`);
      if (s.isLocked) throw new Error("Unlock the mark before editing it");
      if (revision(s) !== input.expectedRevision)
        throw new Error("Mark changed. Read it before updating.");
      resolveMark(editor, s, input.status, actor);
      return describeObject(editor, s.id) ?? { id: s.id, revision: revision(editor.getShape(s.id) ?? s) };
    }
    case "feedback":
      return readFeedback(editor, command.input ?? {});
    case "reply":
      return replyToFeedback(editor, command.input, actor);
    case "asks":
      return listAsks(editor, command.input ?? {});
    case "ask_status":
      return setAskStatus(editor, command.input, actor);
    case "answer":
      return answerAsk(editor, command.input, actor);
    case "import":
      return importForAgent(editor, command.input, actor);
    case "remove": {
      const input = z
          .object({
            id: z.string().startsWith("shape:"),
            expectedRevision: z.number().int().nonnegative(),
          })
          .parse(command.input),
        s = find(editor, input.id);
      if (s.isLocked) throw new Error("Unlock the object before deleting it");
      if (revision(s) !== input.expectedRevision)
        throw new Error("Object changed. Read it before deleting.");
      editor.markHistoryStoppingPoint("agent delete");
      editor.deleteShapes([s.id]);
      return { removed: s.id };
    }
    case "select":
      return createBridge(editor).select(
        z.object({ ids: z.array(z.string()) }).parse(command.input).ids,
      );
    case "focus": {
      const input = focusInput.parse(command.input ?? {});
      if (input.ids) {
        createBridge(editor).select(input.ids);
        editor.zoomToSelection({ animation: { duration: 200 } });
      } else editor.zoomToFit({ animation: { duration: 200 } });
      return { focused: input.ids ?? "all" };
    }
    case "page": {
      const input = z
          .object({ name: z.string().min(1).max(100) })
          .parse(command.input),
        id = PageRecordType.createId();
      editor.createPage({ id, name: input.name });
      editor.setCurrentPage(id);
      return { id, name: input.name };
    }
    case "screenshot": {
      const { ids } = focusInput.parse(command.input ?? {}),
        shapes = ids
          ? ids.map((id) => find(editor, id))
          : editor.getCurrentPageShapes();
      if (!shapes.length) throw new Error("Canvas has no objects to render");
      const bounds = editor.getShapePageBounds(shapes[0]);
      const all = editor.getCurrentPageBounds();
      const width = all?.w ?? bounds?.w ?? 1000;
      const result = await editor.toImageDataUrl(shapes, {
        format: "png",
        scale: Math.min(1, 1600 / width),
        background: true,
        padding: 24,
      });
      return {
        mimeType: "image/png",
        data: result.url.slice(result.url.indexOf(",") + 1),
        width: result.width,
        height: result.height,
      };
    }
  }
}
