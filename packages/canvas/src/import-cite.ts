// Cited material beside the record that cites it. A review row names the questions it is about
// in a short column ("Q56 vs Q16/Q49"); an imported document has sections headed by those codes
// ("Q56. Fleet costs"). Bringing those sections next to the record puts the claim and its source
// in one view. Pure rules here; import-board applies them as one undoable step.

type Box = { id: string; x: number; y: number; w: number; h: number };
export type SectionBox = Box & { key: string };

const CODE = /\b([A-Za-z]{1,3}\d{1,4}[a-z]?)\b/g;
/** Columns this long are prose, not identifiers (the same cut as a record's title line). */
const SHORT = 50;
const GAP_X = 48, GAP_Y = 16;

/** The codes a record cites: question-style codes in its short columns, in order, once each. */
export function citationsOf(values: Record<string, string>): string[] {
  const out: string[] = [];
  for (const value of Object.values(values)) {
    if (value.length >= SHORT) continue;
    for (const match of value.matchAll(CODE)) {
      const code = match[1].toUpperCase();
      if (/\d/.test(code) && /^[A-Z]/.test(code) && !out.includes(code)) out.push(code);
    }
  }
  return out;
}

/** The code a section heading starts with ("Q56. Fleet costs" → "Q56"), if any. */
export function sectionKey(heading: string | undefined): string | undefined {
  const match = heading?.match(/^\s*(?:§\s*)?([A-Za-z]{1,3}\d{1,4}[a-z]?)(?=$|[\s.:,;)\-–—])/);
  return match ? match[1].toUpperCase() : undefined;
}

/**
 * Where each cited section goes: one column just right of the record, top-aligned with it, in the
 * order the record cites them. The column steps right past anything else already there.
 * `sections` are in reading order; a code that heads two sections takes the first.
 */
export function planCited(record: Box, citations: readonly string[], sections: readonly SectionBox[], obstacles: readonly Box[]) {
  const chosen: SectionBox[] = [], missing: string[] = [];
  for (const code of citations) {
    const section = sections.find((s) => s.key === code);
    if (section && !chosen.includes(section)) chosen.push(section);
    else if (!section) missing.push(code);
  }
  const moving = new Set(chosen.map((s) => s.id));
  const height = chosen.reduce((h, s, i) => h + s.h + (i ? GAP_Y : 0), 0);
  const width = Math.max(0, ...chosen.map((s) => s.w));
  const blockers = obstacles.filter((o) => !moving.has(o.id) && o.id !== record.id);
  let x = record.x + record.w + GAP_X;
  for (let tries = 0; tries < 50; tries++) {
    const hit = blockers.filter((o) => o.x < x + width && x < o.x + o.w && o.y < record.y + height && record.y < o.y + o.h);
    if (!hit.length) break;
    x = Math.max(...hit.map((o) => o.x + o.w)) + GAP_X;
  }
  let y = record.y;
  const moves = chosen.map((s) => {
    const move = { id: s.id, x, y };
    y += s.h + GAP_Y;
    return move;
  });
  return { moves, missing };
}
