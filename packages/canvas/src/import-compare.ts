// Side by side: bring two imported records next to each other so the same columns line up and
// one can be read against the other (comparing beats describing). A pure plan, so it can be
// tested without a board; import-ui applies it as one undoable step.

export type RecordBox = { id: string; importId: string; x: number; y: number; w: number; h: number };
export type SideBySidePlan =
  | { ok: true; upper: string; lower: string; moves: { id: string; dx: number; dy: number }[] }
  | { ok: false; reason: string };

const SAME_IMPORT = "Side by side works on two records from the same import.";

/**
 * The lower record moves up to sit directly under the upper one, lined up with it. The records of
 * the same import that sat between the two, in the same column, slide down by the lower record's
 * height, so the order of everything else is kept and nothing below the pair moves.
 */
export function planSideBySide(records: readonly RecordBox[], a: string, b: string): SideBySidePlan {
  const first = records.find((r) => r.id === a), second = records.find((r) => r.id === b);
  if (!first || !second || a === b) return { ok: false, reason: "Select two records to see them side by side." };
  if (first.importId !== second.importId) return { ok: false, reason: SAME_IMPORT };
  const [upper, lower] = first.y <= second.y ? [first, second] : [second, first];
  const column = (r: RecordBox) => r.x < upper.x + upper.w && upper.x < r.x + r.w;
  const between = records
    .filter((r) => r !== upper && r !== lower && r.importId === upper.importId && column(r) && r.y > upper.y && r.y < lower.y)
    .sort((p, q) => p.y - q.y);
  const dx = upper.x - lower.x;
  if (!between.length) return { ok: true, upper: upper.id, lower: lower.id, moves: dx ? [{ id: lower.id, dx, dy: 0 }] : [] };
  const slot = between[0].y, gap = slot - (upper.y + upper.h);
  return {
    ok: true,
    upper: upper.id,
    lower: lower.id,
    moves: [{ id: lower.id, dx, dy: slot - lower.y }, ...between.map((r) => ({ id: r.id, dx: 0, dy: lower.h + gap }))],
  };
}
