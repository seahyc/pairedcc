import {
  AssetRecordType,
  createShapeId,
  PageRecordType,
  toRichText,
  type Editor,
  type TLShape,
} from "tldraw";
import { sceneInput, orderedScene, arrangeInput, duplicateInput, layoutPositions } from "./composition";
import { z } from "zod";
import {
  annotationInput,
  connectionInput,
  imageInput,
  resolveInput,
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
import { agentStyle, collectMarks, authorOf, humanStyle, HUMAN, resolveMark } from "./scratchbook";

const cardInput = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().min(80).max(4000).optional(),
  text: z.string().max(50000).default(""),
  name: z.string().max(200).optional(),
  style: z.enum(["note", "heading", "quote", "code"]).optional(),
});
const agentWidths = { agent: 420, heading: 440, quote: 380, code: 360 } as const;

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
    props: { w: input.width ?? (human ? 240 : agentWidths[tone as keyof typeof agentWidths]), richText: toRichText(input.text), tone },
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

export const readInput = z.object({ ids: z.array(z.string()).optional() });

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

function atomic<T>(editor: Editor, name: string, work: () => T): T {
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
export function connect(editor: Editor, value: unknown, actor: string) {
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
  const dx = b.center.x - a.center.x, dy = b.center.y - a.center.y;
  const vertical = Math.abs(dy) >= Math.abs(dx) * 0.6;
  const startAnchor = vertical ? { x: 0.5, y: dy > 0 ? 1 : 0 } : { x: dx > 0 ? 1 : 0, y: 0.5 };
  const endAnchor = vertical ? { x: 0.5, y: dy > 0 ? 0 : 1 } : { x: dx > 0 ? 0 : 1, y: 0.5 };
  const bend = Math.max(-60, Math.min(60, (vertical ? dx : -dy) * 0.12)) * (vertical ? (dy > 0 ? 1 : -1) : dx > 0 ? 1 : -1);
  editor.markHistoryStoppingPoint("connect objects");
  editor.run(() => {
    editor.createShape({
      id,
      type: "arrow",
      x: a.x + startAnchor.x * a.w,
      y: a.y + startAnchor.y * a.h,
      meta: { fromId, toId, relation: input.relation, createdBy: actor },
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
      return {
        ...object,
        text:
          "richText" in s.props ? richTextPlain(s.props.richText) : undefined,
        author: authorOf(s),
        meta: s.meta,
        asset,
      };
    });
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

export async function executeCommand(
  editor: Editor,
  command: CanvasCommand,
  actor: string,
): Promise<unknown> {
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
        meta: s.meta,
        ...(asset && includeAsset ? { asset } : {}),
      };
    }
    case "create": {
      const id = createFor(editor, command.input, actor);
      const s = find(editor, id);
      editor.updateShape({
        id: s.id,
        type: s.type,
        meta: { ...s.meta, createdBy: actor },
      });
      return describeObject(editor, id);
    }
    case "update":
      return patchObject(editor, command.input);
    case "learn":
      return createPrompt(editor, command.input, actor);
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
      const input = resolveInput.parse(command.input),
        s = find(editor, input.id);
      if (s.isLocked) throw new Error("Unlock the mark before editing it");
      if (revision(s) !== input.expectedRevision)
        throw new Error("Mark changed. Read it before updating.");
      resolveMark(editor, s, input.status, actor);
      return describeObject(editor, s.id);
    }
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
