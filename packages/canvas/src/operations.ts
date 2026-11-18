import { z } from "zod";
import { createShapeId, toRichText, DefaultColorStyle, type Editor, type TLShape } from "tldraw";

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
  ...point,
  width: z.number().min(1).max(20000).default(240),
  height: z.number().min(1).max(20000).default(160),
  text: z.string().max(50000).default(""),
  name: z.string().max(200).optional(),
  color: color.default("black"),
  style: z
    .enum(["note", "heading", "quote", "code"])
    .optional()
    .describe("Agent notes only: note (default, casual typed card), heading (large, no card), quote (serif italic, for sourced excerpts) or code (monospace, for data, numbers and code)."),
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

export function revision(shape: TLShape) {
  return typeof shape.meta.revision === "number" ? shape.meta.revision : 0;
}

export function shapeName(shape: TLShape) {
  if (typeof shape.meta.name === "string") return shape.meta.name;
  if ("name" in shape.props && typeof shape.props.name === "string")
    return shape.props.name;
  if ("richText" in shape.props) {
    const text = richTextPlain(shape.props.richText);
    if (text) return text.split("\n")[0].slice(0, 48);
  }
  if (shape.type === "geo")
    return shape.props.geo === "ellipse" ? "Ellipse" : "Rectangle";
  return shape.type[0].toUpperCase() + shape.type.slice(1);
}

export function richTextPlain(value: unknown): string {
  const parsed = z
    .object({
      text: z.string().optional(),
      content: z.array(z.unknown()).optional(),
    })
    .safeParse(value);
  if (!parsed.success) return "";
  if (parsed.data.text !== undefined) return parsed.data.text;
  return (parsed.data.content ?? []).map(richTextPlain).join(" ");
}

export function createObject(editor: Editor, value: unknown) {
  const input = createInput.parse(value),
    id = createShapeId();
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

export function describeObject(editor: Editor, id: string) {
  const shape = editor.getCurrentPageShapes().find((s) => s.id === id);
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
        .map((s) => describeObject(editor, s.id)),
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
