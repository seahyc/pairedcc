import { z } from "zod";
import { createInput } from "./operations";
import { imageInput, connectionInput } from "./protocol";

const key = z.string().min(1).max(80);
export const sceneInput = z.object({
  name: z.string().min(1).max(200).default("Agent scene"),
  nodes: z.array(z.object({
    key,
    parentKey: key.optional(),
    shape: z.union([createInput, imageInput.extend({ kind: z.literal("image") })]),
  })).min(1).max(100),
  connections: z.array(z.object({
    fromKey: key,
    toKey: key,
    ...connectionInput.pick({ relation: true, label: true }).shape,
  })).max(200).default([]),
});

/** Return parents before children; reject the whole scene before creating anything. */
export function orderedScene(input: z.infer<typeof sceneInput>) {
  const remaining = new Map(input.nodes.map(node => [node.key, node]));
  if (remaining.size !== input.nodes.length) throw new Error("Scene keys must be unique");
  for (const node of input.nodes) {
    if (node.parentKey && remaining.get(node.parentKey)?.shape.kind !== "frame")
      throw new Error(`Parent ${node.parentKey} must name a frame in this scene`);
  }
  for (const connection of input.connections) {
    if (!remaining.has(connection.fromKey) || !remaining.has(connection.toKey))
      throw new Error("Connections must reference keys in this scene");
    if (connection.fromKey === connection.toKey) throw new Error("Connect two different nodes");
  }
  const ordered: typeof input.nodes = [];
  const done = new Set<string>();
  while (remaining.size) {
    const ready = [...remaining.values()].filter(node => !node.parentKey || done.has(node.parentKey));
    if (!ready.length) throw new Error("Scene frame nesting contains a cycle");
    for (const node of ready) {
      ordered.push(node);
      done.add(node.key);
      remaining.delete(node.key);
    }
  }
  return ordered;
}

const targets = z.array(z.object({
  id: z.string().startsWith("shape:"),
  expectedRevision: z.number().int().nonnegative(),
})).min(1).max(100);
export const arrangeInput = z.object({
  objects: targets,
  layout: z.enum(["row", "column", "grid"]),
  x: z.number().finite(),
  y: z.number().finite(),
  gap: z.number().min(0).max(2000).default(40),
  columns: z.number().int().min(1).max(100).default(3),
});
export const groupInput = z.object({
  objects: targets,
  name: z.string().trim().min(1).max(200).describe("The frame's label: what these objects have in common."),
  padding: z.number().min(0).max(400).default(40),
});

/** A frame around boxes (in one coordinate space), with padding on every side. */
export function frameAround(boxes: { x: number; y: number; w: number; h: number }[], padding: number) {
  const x = Math.min(...boxes.map((b) => b.x)) - padding, y = Math.min(...boxes.map((b) => b.y)) - padding;
  const right = Math.max(...boxes.map((b) => b.x + b.w)) + padding, bottom = Math.max(...boxes.map((b) => b.y + b.h)) + padding;
  return { x, y, w: right - x, h: bottom - y };
}

export const duplicateInput = z.object({
  objects: targets,
  /** Default: the width of the duplicated objects plus 40, so the copy sits just right of them. */
  offsetX: z.number().finite().optional(),
  /** Default 0, or below the originals when a copy beside them would leave its frame. */
  offsetY: z.number().finite().optional(),
});

export function layoutPositions(
  boxes: { w: number; h: number }[],
  input: Pick<z.infer<typeof arrangeInput>, "layout" | "x" | "y" | "gap" | "columns">,
) {
  const columns = input.layout === "row" ? boxes.length : input.layout === "column" ? 1 : input.columns;
  const widths: number[] = [], heights: number[] = [];
  boxes.forEach((box, i) => {
    const col = i % columns, row = Math.floor(i / columns);
    widths[col] = Math.max(widths[col] ?? 0, box.w);
    heights[row] = Math.max(heights[row] ?? 0, box.h);
  });
  return boxes.map((_, i) => ({
    x: input.x + widths.slice(0, i % columns).reduce((sum, w) => sum + w + input.gap, 0),
    y: input.y + heights.slice(0, Math.floor(i / columns)).reduce((sum, h) => sum + h + input.gap, 0),
  }));
}

type Rect = { x: number; y: number; w: number; h: number };

/**
 * The default offset for a copy: beside the originals, else below them, choosing the first
 * where every copy still fits inside the frame that will hold it (a copy keeps its parent
 * frame, which clips anything outside it). Null when neither fits.
 */
export function chooseDuplicateOffset(items: readonly { box: Rect; container?: Rect }[], gap = 40): { x: number; y: number } | null {
  if (!items.length) return { x: 320, y: 0 };
  const boxes = items.map((i) => i.box);
  const left = Math.min(...boxes.map((b) => b.x)), right = Math.max(...boxes.map((b) => b.x + b.w));
  const top = Math.min(...boxes.map((b) => b.y)), bottom = Math.max(...boxes.map((b) => b.y + b.h));
  const candidates = [
    { x: Math.round(right - left + gap), y: 0 },
    { x: 0, y: Math.round(bottom - top + gap) },
  ];
  const fits = (o: { x: number; y: number }) =>
    items.every(({ box, container: c }) => !c || (box.x + o.x >= c.x && box.y + o.y >= c.y && box.x + o.x + box.w <= c.x + c.w && box.y + o.y + box.h <= c.y + c.h));
  return candidates.find(fits) ?? null;
}
