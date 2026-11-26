// Side by side: bring two imported records next to each other so the same columns line up and
// one can be read against the other (comparing beats describing). A pure plan, so it can be
// tested without a board; import-ui applies it as one undoable step.

export type RecordBox = { id: string; importId: string; x: number; y: number; w: number; h: number };
export type SideBySidePlan =
  | { ok: true; upper: string; lower: string; moves: { id: string; dx: number; dy: number }[] }
  | { ok: false; reason: string };

const SAME_IMPORT = "Side by side works on two records from the same import.";

/**
 * The lower record moves up to sit directly under the upper one, lined up with it, with the gap
 * that followed the upper record. Records of the same import below the upper one, in its column,
 * slide down only as far as needed to clear what is now above them, so the order of everything
 * else is kept and nothing overlaps, even when the person has spaced records unevenly or dragged
 * one beside the other.
 */
export function planSideBySide(records: readonly RecordBox[], a: string, b: string): SideBySidePlan {
  const first = records.find((r) => r.id === a), second = records.find((r) => r.id === b);
  if (!first || !second || a === b) return { ok: false, reason: "Select two records to see them side by side." };
  if (first.importId !== second.importId) return { ok: false, reason: SAME_IMPORT };
  const [upper, lower] = first.y <= second.y ? [first, second] : [second, first];
  const column = (r: RecordBox) => r.x < upper.x + upper.w && upper.x < r.x + r.w;
  const below = records
    .filter((r) => r !== upper && r !== lower && r.importId === upper.importId && column(r) && r.y > upper.y)
    .sort((p, q) => p.y - q.y);
  const bottom = upper.y + upper.h;
  // The gap the import left after the upper record, or the usual one if that space is gone.
  const next = [...below, ...(column(lower) ? [lower] : [])].filter((r) => r.y >= bottom).sort((p, q) => p.y - q.y)[0];
  const gap = next && next.y - bottom >= 16 ? Math.min(next.y - bottom, 200) : 40;
  const moves: { id: string; dx: number; dy: number }[] = [];
  const lowerY = bottom + gap;
  if (lower.x !== upper.x || lower.y !== lowerY) moves.push({ id: lower.id, dx: upper.x - lower.x, dy: lowerY - lower.y });
  let cursor = lowerY + lower.h + gap;
  for (const r of below) {
    const y = Math.max(r.y, cursor);
    if (y !== r.y) moves.push({ id: r.id, dx: 0, dy: y - r.y });
    cursor = Math.max(cursor, y + r.h + gap);
  }
  return { ok: true, upper: upper.id, lower: lower.id, moves };
}

/**
 * Where each field column sits in a record: one slot per column for the whole import, in the
 * source's column order, four to a row. A record with a blank cell leaves that slot empty, so
 * every record's "Fix" card is in the same place and side by side lines up column by column.
 */
export function fieldSlots(records: readonly { fields: readonly { column: string }[] }[], columnOrder: readonly string[]) {
  const used = new Set(records.flatMap((r) => r.fields.map((f) => f.column)));
  const columns = [...columnOrder.filter((c) => used.has(c)), ...[...used].filter((c) => !columnOrder.includes(c))];
  const perRow = Math.min(4, Math.max(1, columns.length));
  return {
    columns,
    perRow,
    place: (column: string) => {
      const i = Math.max(0, columns.indexOf(column));
      return { col: i % perRow, row: Math.floor(i / perRow) };
    },
  };
}
