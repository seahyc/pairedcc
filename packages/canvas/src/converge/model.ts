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
  points: z
    .array(z.object({ text: z.string().trim().min(1).max(500), sourceIds: z.array(shapeId).min(1).max(20) }))
    .max(20)
    .optional()
    .describe("Optional claims, each citing the sources it rests on (from sourceIds). The card cites them by the letter on each source's arrow, so the person can check every claim against its evidence."),
  x: z.number().finite().optional().describe("Defaults to just right of the sources."),
  y: z.number().finite().optional(),
});
export type ConvergeInput = z.infer<typeof convergeInput>;

type Box = { x: number; y: number; w: number; h: number };

/**
 * Beside the sources, where no arrow has to cross one: just right of a column of sources
 * (top-aligned), or just below a row of them (left-aligned).
 */
export function placeBeside(boxes: readonly Box[], gap = 80) {
  const left = Math.min(...boxes.map((b) => b.x)), right = Math.max(...boxes.map((b) => b.x + b.w));
  const top = Math.min(...boxes.map((b) => b.y)), bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return right - left > bottom - top ? { x: left, y: bottom + gap } : { x: right + gap, y: top };
}

/** A, B, … Z, AA, AB: the letters on the sources' arrows, which the card's claims cite. */
export function sourceLabel(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : sourceLabel(Math.floor(i / 26) - 1) + sourceLabel(i % 26);
}

/** The card's text: the synthesis, then each claim with the letters of the sources it cites. */
export function synthesisText(input: Pick<ConvergeInput, "sourceIds" | "text" | "points">) {
  const letters = new Map(input.sourceIds.map((id, i) => [id, sourceLabel(i)]));
  const points = input.points ?? [];
  for (const p of points)
    for (const id of p.sourceIds) if (!letters.has(id)) throw new Error(`A point cites ${id}, which is not in sourceIds`);
  const lines = points.map((p) => `• ${p.text} (${p.sourceIds.map((id) => letters.get(id)).join(", ")})`);
  return { text: [input.text, ...(lines.length ? ["", ...lines] : [])].join("\n"), letters };
}
