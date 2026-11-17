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
        : describeObject(editor, createObject(editor, node.shape));
      if (!created) throw new Error(`Could not create ${node.key}`);
      let shape = find(editor, created.id);
      if (node.parentKey) {
        const parent = objects.get(node.parentKey);
        if (!parent) throw new Error(`Missing frame ${node.parentKey}`);
        editor.reparentShapes([shape.id], parent.id);
      }
      editor.updateShape({ id: shape.id, type: shape.type, x: node.shape.x, y: node.shape.y,
        meta: { ...shape.meta, createdBy: actor, scene: input.name, sceneKey: node.key } });
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
function image(editor: Editor, value: unknown, actor: string) {
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
  });
  return describeObject(editor, id);
}
function connect(editor: Editor, value: unknown, actor: string) {
  const input = connectionInput.parse(value),
    { fromId, toId } = input,
    from = find(editor, fromId),
    to = find(editor, toId);
  if (from.id === to.id) throw new Error("Connect two different objects");
  const a = editor.getShapePageBounds(from),
    b = editor.getShapePageBounds(to);
  if (!a || !b) throw new Error("Objects must have visible bounds");
  const id = createShapeId();
  editor.markHistoryStoppingPoint("connect objects");
  editor.run(() => {
    editor.createShape({
      id,
      type: "arrow",
      x: a.center.x,
      y: a.center.y,
      meta: { fromId, toId, relation: input.relation, createdBy: actor },
      props: {
        start: { x: 0, y: 0 },
        end: { x: b.center.x - a.center.x, y: b.center.y - a.center.y },
        color: "grey",
        dash: "solid",
        size: "s",
        richText: toRichText(input.label),
      },
    });
    for (const [terminal, target] of [
      ["start", from],
      ["end", to],
    ] satisfies ["start" | "end", typeof from][]) {
      editor.createBinding({
        type: "arrow",
        fromId: id,
        toId: target.id,
        props: {
          terminal,
          normalizedAnchor: { x: 0.5, y: 0.5 },
          isPrecise: false,
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
  const id = createShapeId();
  editor.markHistoryStoppingPoint("add feedback");
  editor.run(() => {
    editor.createShape({
      id,
      type: "note",
      x: input.x ?? bounds.x,
      y: input.y ?? bounds.maxY + 60,
      meta: {
        name: "Feedback",
        role: "annotation",
        targetId: target.id,
        status: "open",
        author: input.author,
      },
      props: {
        richText: toRichText(input.text),
        font: "sans",
        color: "light-red",
        size: "s",
      },
    });
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
      const id = createObject(editor, command.input);
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
      if (s.meta.role !== "annotation")
        throw new Error("Object is not an annotation");
      if (s.isLocked)
        throw new Error("Unlock the annotation before editing it");
      if (revision(s) !== input.expectedRevision)
        throw new Error("Annotation changed. Read it before updating.");
      editor.markHistoryStoppingPoint("resolve feedback");
      const meta = {
        ...s.meta,
        name: input.status === "resolved" ? "Feedback · resolved" : "Feedback",
        status: input.status,
        resolvedBy: actor,
      };
      if (s.type === "note")
        editor.updateShape({
          id: s.id,
          type: "note",
          meta,
          props: {
            color: input.status === "resolved" ? "light-green" : "light-red",
          },
        });
      else editor.updateShape({ id: s.id, type: s.type, meta });
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
