import { z } from "zod";
import { createShapeId, toRichText, DefaultColorStyle, type Editor, type TLPageId, type TLShape, type TLShapeId } from "tldraw";
import { clip } from "./text";

const color = z.enum(DefaultColorStyle.values);
const point = { x: z.number().finite(), y: z.number().finite() };
const styles = {
  fill: z.enum(["none", "semi", "solid", "pattern"]).optional(),
  dash: z.enum(["draw", "solid", "dashed", "dotted"]).optional(),
  font: z.enum(["draw", "sans", "serif", "mono"]).optional(),
  size: z.enum(["s", "m", "l", "xl"]).optional(),
  align: z.enum(["start", "middle", "end"]).optional(),
  opacity: z.number().min(0).max(1).optional(),
  rotation: z.number().finite().optional(),
};
export const createInput = z.object({
  ...styles,
  kind: z.enum(["rectangle", "ellipse", "text", "note", "frame"]),
  x: point.x.optional().describe("Left edge in canvas coordinates. Leave out x and y to place it beside the person's selection, or in the middle of their view, clear of everything."),
  y: point.y.optional().describe("Top edge in canvas coordinates; give both x and y or neither."),
  width: z.number().min(1).max(20000).default(240),
  height: z.number().min(1).max(20000).default(160),
  text: z.string().max(50000).default(""),
  name: z.string().max(200).optional(),
  color: color.default("black"),
  style: z
    .enum(["note", "heading", "quote", "code"])
    .optional()
    .describe("Agent notes only: note (default, casual typed card), heading (large, no card), quote (serif italic, for sourced excerpts) or code (monospace, for data, numbers and code)."),
  inputs: z
    .array(z.string().startsWith("shape:"))
    .max(50)
    .optional()
    .describe("Objects this result was derived from (e.g. a chart you are explaining). Their current versions are recorded; the result shows as stale when one changes."),
});
export const patchInput = z.object({
  ...styles,
  id: z.string().startsWith("shape:"),
  expectedRevision: z.number().int().nonnegative(),
  x: point.x.optional(),
  y: point.y.optional(),
  text: z.string().max(50000).optional(),
  name: z.string().max(200).optional(),
  width: z.number().min(1).max(20000).optional(),
  height: z.number().min(1).max(20000).optional(),
  color: color.optional(),
});

function styleProps(input: z.infer<typeof patchInput> | z.infer<typeof createInput>, type: string) {
  return {
    ...(type === "geo" && input.fill !== undefined ? { fill: input.fill } : {}),
    ...(["geo", "arrow", "draw", "line"].includes(type) && input.dash !== undefined ? { dash: input.dash } : {}),
    ...(["geo", "text", "note", "arrow"].includes(type) ? {
      ...(input.font !== undefined ? { font: input.font } : {}),
      ...(input.size !== undefined ? { size: input.size } : {}),
      ...(type === "text" && input.align !== undefined ? { textAlign: input.align } : {}),
      ...((type === "geo" || type === "note") && input.align !== undefined ? { align: input.align } : {}),
    } : {}),
  };
}

export function revision(shape: Pick<TLShape, "meta">) {
  return typeof shape.meta.revision === "number" ? shape.meta.revision : 0;
}

/** A card's style as agents name it: their own notes are `note`, the person's `handwriting`. */
export function cardStyle(tone: unknown): string | undefined {
  if (tone === "agent") return "note";
  if (tone === "human") return "handwriting";
  return typeof tone === "string" ? tone : undefined;
}

export function shapeName(shape: TLShape) {
  if (typeof shape.meta.name === "string") return shape.meta.name;
  if ("name" in shape.props && typeof shape.props.name === "string")
    return shape.props.name;
  if ("richText" in shape.props) {
    const text = richTextPlain(shape.props.richText);
    if (text) return clip(text.split("\n")[0], 48);
  }
  if (shape.type === "geo")
    return shape.props.geo === "ellipse" ? "Ellipse" : "Rectangle";
  return shape.type[0].toUpperCase() + shape.type.slice(1);
}

/**
 * Plain text of a tldraw rich-text document. Plain checks rather than a schema: this runs
 * for every shape on every layers-panel render, and building a schema per call made
 * opening a 10k-object board take seconds longer.
 */
export function richTextPlain(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const { text, content } = value as { text?: unknown; content?: unknown };
  if (text !== undefined && typeof text !== "string") return "";
  if (content !== undefined && !Array.isArray(content)) return "";
  if (text !== undefined) return text;
  return (content ?? []).map(richTextPlain).join(" ");
}

const NAME_MAX = 48;
/** The automatic layer name for an object's text: its first line, cut at 48 characters with an ellipsis. */
export const nameFrom = (text: string) => {
  const first = text.split("\n")[0].trim();
  return first.length > NAME_MAX ? `${first.slice(0, NAME_MAX - 1)}…` : first;
};

/**
 * The layer name an object should take when its text changes from `oldText` to `newText`, or
 * undefined to keep it. A name made from the old text (its first line, possibly cut at 48
 * characters) follows the text; a name someone chose is kept, and so is any name when the new
 * text has no first line. Cards saved before they were named with `nameFrom` carry a plain
 * 48-character prefix of their first line, which counts as made from the text too.
 */
export function nameAfterText(oldName: unknown, oldText: string, newText: string): string | undefined {
  const first = oldText.split("\n")[0].trim();
  const made = [first, nameFrom(oldText), clip(oldText.split("\n")[0], NAME_MAX)];
  if (typeof oldName !== "string" || !made.includes(oldName)) return undefined;
  const next = nameFrom(newText);
  return next || undefined;
}

/**
 * Without `parentId`, tldraw puts the new object into whatever frame covers its x/y. Pass the page
 * to keep it a page child: for a provisional spot that is moved once the object has its size.
 */
export function createObject(editor: Editor, value: unknown, parentId?: TLPageId) {
  const parsed = createInput.parse(value),
    input = { ...parsed, x: parsed.x ?? 0, y: parsed.y ?? 0 },
    id = createShapeId(),
    parent = parentId ? { parentId } : {};
  editor.markHistoryStoppingPoint("create object");
  const meta = {
    name: input.name ?? (input.text.split("\n")[0] || input.kind),
    revision: 0,
  };
  editor.run(() => {
    switch (input.kind) {
      case "rectangle":
      case "ellipse":
        editor.createShape({
          id,
          type: "geo",
          ...parent,
          x: input.x,
          y: input.y,
          meta,
          props: {
            geo: input.kind === "ellipse" ? "ellipse" : "rectangle",
            w: input.width,
            h: input.height,
            color: input.color,
            fill: "solid",
            dash: "solid",
            font: "sans",
            richText: toRichText(input.text),
            ...styleProps(input, "geo"),
          },
        });
        break;
      case "text":
        editor.createShape({
          id,
          type: "text",
          ...parent,
          x: input.x,
          y: input.y,
          meta,
          props: {
            richText: toRichText(input.text || "Text"),
            font: "sans",
            color: input.color,
            w: input.width,
            autoSize: false,
            ...styleProps(input, "text"),
          },
        });
        break;
      case "note":
        editor.createShape({
          id,
          type: "note",
          ...parent,
          x: input.x,
          y: input.y,
          meta,
          props: {
            richText: toRichText(input.text),
            font: "sans",
            color: input.color === "black" ? "yellow" : input.color,
            ...styleProps(input, "note"),
          },
        });
        break;
      case "frame":
        editor.createShape({
          id,
          type: "frame",
          ...parent,
          x: input.x,
          y: input.y,
          meta,
          props: {
            w: input.width,
            h: input.height,
            name: input.name || "Frame",
          },
        });
        break;
    }
    const shape = editor.getShape(id);
    if (shape && (input.opacity !== undefined || input.rotation !== undefined)) editor.updateShape({
      id, type: shape.type,
      ...(input.opacity !== undefined ? { opacity: input.opacity } : {}),
      ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
    });
  });
  editor.select(id);
  return id;
}

export function patchObject(editor: Editor, value: unknown) {
  const input = patchInput.parse(value),
    shape = editor.getCurrentPageShapes().find((s) => s.id === input.id);
  if (!shape) throw new Error("Object not found on the current page");
  if (shape.isLocked) throw new Error("Unlock this object before editing it");
  if (revision(shape) !== input.expectedRevision)
    throw new Error(
      "Object changed. Read its current revision before updating.",
    );
  if (input.text !== undefined && !("richText" in shape.props))
    throw new Error("This object does not support text");
  if (input.width !== undefined && !("w" in shape.props))
    throw new Error("This object does not support width");
  if (input.height !== undefined && !("h" in shape.props))
    throw new Error("This object does not support height");
  if (input.color !== undefined && !("color" in shape.props))
    throw new Error("This object does not support color");
  const requestedStyles = styleProps(input, shape.type);
  for (const key of ["fill", "dash", "font", "size", "align"] satisfies (keyof typeof styles)[]) {
    if (input[key] !== undefined && !((key === "align" && shape.type === "text" ? "textAlign" : key) in requestedStyles))
      throw new Error(`This object does not support ${key}`);
  }
  editor.markHistoryStoppingPoint("edit object");
  editor.updateShape({
    id: shape.id,
    type: shape.type,
    ...(input.x !== undefined ? { x: input.x } : {}),
    ...(input.y !== undefined ? { y: input.y } : {}),
    ...(input.opacity !== undefined ? { opacity: input.opacity } : {}),
    ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
    meta: {
      ...shape.meta,
      ...(input.name !== undefined ? { name: input.name } : {}),
      // A name made from the old text follows the new text, so read and overview stay true.
      ...(input.name === undefined && input.text !== undefined && "richText" in shape.props
        ? (() => {
            const renamed = nameAfterText(shape.meta.name, richTextPlain(shape.props.richText as never), input.text);
            return renamed ? { name: renamed } : {};
          })()
        : {}),
    },
    props: {
      ...shape.props,
      ...requestedStyles,
      ...(input.width !== undefined ? { w: input.width } : {}),
      ...(input.height !== undefined ? { h: input.height } : {}),
      ...(input.text !== undefined ? { richText: toRichText(input.text) } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(shape.type === "frame" && input.name !== undefined
        ? { name: input.name }
        : {}),
    },
  });
  return describeObject(editor, shape.id);
}

/** One object as agents see it. Only objects on the open page, unless `anyPage` (an answer placed on its ask's page). */
export function describeObject(editor: Editor, id: string, anyPage = false) {
  const shape = anyPage ? editor.getShape(id as TLShapeId) : editor.getCurrentPageShapes().find((s) => s.id === id);
  if (!shape) return null;
  const bounds = editor.getShapePageBounds(shape);
  return {
    id: shape.id,
    type: shape.type,
    name: shapeName(shape),
    revision: revision(shape),
    parentId: shape.parentId,
    x: shape.x,
    y: shape.y,
    rotation: shape.rotation,
    opacity: shape.opacity,
    bounds: bounds?.toJson(),
    props: shape.props,
    locked: shape.isLocked,
  };
}

export function createBridge(editor: Editor) {
  return {
    version: 1,
    read: () => ({
      page: editor.getCurrentPage(),
      selection: editor.getSelectedShapeIds(),
      objects: editor
        .getCurrentPageShapesSorted()
        .map((s) => ({
          ...describeObject(editor, s.id),
          text: "richText" in s.props ? richTextPlain(s.props.richText) : undefined,
          meta: s.meta,
        })),
      pages: editor.getPages().map((p) => ({ id: p.id, name: p.name })),
    }),
    create: (input: unknown) => createObject(editor, input),
    update: (input: unknown) => patchObject(editor, input),
    select: (ids: unknown) => {
      const parsed = z.array(z.string()).parse(ids);
      const shapes = editor
        .getCurrentPageShapes()
        .filter((s) => parsed.includes(s.id));
      if (shapes.length !== parsed.length)
        throw new Error("Selection contains missing or duplicate object IDs");
      editor.setCurrentTool("select");
      editor.select(...shapes.map((s) => s.id));
      return parsed;
    },
    undo: () => editor.undo(),
    redo: () => editor.redo(),
  };
}
export type CanvasBridge = ReturnType<typeof createBridge>;
