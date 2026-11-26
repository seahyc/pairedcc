import { z } from "zod";

// PROTOTYPE (working spec, "Gaps for Paired beyond the board": Converge). An agent pulls
// branches of alternatives into one synthesis card that keeps a visible, inspectable link
// to each source and goes stale when any source changes, so the person can check the
// synthesis against what it came from, or redraw it.

const shapeId = z.string().startsWith("shape:");
export const convergeInput = z.object({
  sourceIds: z
    .array(shapeId)
    .min(2)
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, "List each source once")
    .describe("The alternatives or branches being pulled together, on the current page."),
  text: z.string().trim().min(1).max(2000).describe("The synthesis: what the sources add up to, and where they still disagree."),
  name: z.string().max(200).optional(),
  x: z.number().finite().optional().describe("Defaults to just right of the sources."),
  y: z.number().finite().optional(),
});
export type ConvergeInput = z.infer<typeof convergeInput>;

type Box = { x: number; y: number; w: number; h: number };

/** Just right of the sources' combined bounds, aligned with their top edge. */
export function placeBeside(boxes: readonly Box[], gap = 80) {
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const top = Math.min(...boxes.map((b) => b.y));
  return { x: right + gap, y: top };
}
