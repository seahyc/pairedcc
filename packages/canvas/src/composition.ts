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
export const duplicateInput = z.object({
  objects: targets,
  offsetX: z.number().finite().default(320),
  offsetY: z.number().finite().default(0),
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
