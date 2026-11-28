/**
 * Where an agent's note (`annotate` without x/y) goes, and how wide it is. Pure, so it is
 * tested on fixed layouts (test/note-place.test.ts).
 *
 * Under its target, 60 px down, when that is free (as always). When it is taken, the note goes
 * to the nearest clear spot around the target, sliding out from close beside it. It stays
 * under the target if that is within NOTE_STAY_UNDER of the card, so a note keeps to its card's
 * column on an open board; on a crowded grid it no longer runs hundreds of pixels down the page
 * past every row (item 118 (c)). It never covers anything. With `side: "beside"` the same holds
 * to the right of the target (item 140 (a)).
 */
export type Rect = { x: number; y: number; w: number; h: number };

export const NOTE_GAP = 60;
/** The closest a note is put to its target when the usual gap is taken: room for the arrow to show. */
export const NOTE_MIN_GAP = 12;
/** Clear space kept around a placed note, so it never touches another object. */
export const NOTE_AIR = 6;
/** Under the target is kept while it is no further than this from the card. */
export const NOTE_STAY_UNDER = 200;
/** Asked for beside, the note keeps to the right while it is no further than this from the card. */
export const NOTE_STAY_BESIDE = 600;
const FAR = 1200, STEP = 4;

const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const clear = (spot: Rect, others: Rect[]) => {
  const roomy = { x: spot.x - NOTE_AIR, y: spot.y - NOTE_AIR, w: spot.w + 2 * NOTE_AIR, h: spot.h + 2 * NOTE_AIR };
  return !others.some((o) => hits(roomy, o));
};

type Side = "under" | "right" | "above" | "left";
/** The spot `d` px away on one side of the target, lined up with its left/top edge (or right/bottom). */
function at(t: Rect, size: { w: number; h: number }, side: Side, d: number, far: boolean): Rect {
  const { w, h } = size;
  switch (side) {
    case "under": return { x: far ? t.x + t.w - w : t.x, y: t.y + t.h + d, w, h };
    case "above": return { x: far ? t.x + t.w - w : t.x, y: t.y - h - d, w, h };
    case "right": return { x: t.x + t.w + d, y: far ? t.y + t.h - h : t.y, w, h };
    case "left": return { x: t.x - w - d, y: far ? t.y + t.h - h : t.y, w, h };
  }
}

/** The nearest clear distance on one side, or undefined when nothing within FAR is clear. */
function nearest(t: Rect, size: { w: number; h: number }, others: Rect[], side: Side) {
  for (let d = NOTE_MIN_GAP; d <= FAR; d += STEP)
    for (const far of [false, true]) {
      const spot = at(t, size, side, d, far);
      if (clear(spot, others)) return { spot, d };
    }
  return undefined;
}

/** Which side the note is for: under the target (the default), or beside it (to the right). */
export type NoteSide = "under" | "beside";

export function notePlace(target: Rect, size: { w: number; h: number }, others: Rect[], side: NoteSide = "under"): Rect {
  const first: Side = side === "beside" ? "right" : "under";
  const usual = at(target, size, first, NOTE_GAP, false);
  if (clear(usual, others)) return usual;
  const near = nearest(target, size, others, first);
  if (near && near.d <= (side === "beside" ? NOTE_STAY_BESIDE : NOTE_STAY_UNDER)) return near.spot;
  let best = near;
  for (const s of ["under", "right", "above", "left"] as const) {
    if (s === first) continue;
    const found = nearest(target, size, others, s);
    if (found && (!best || found.d < best.d)) best = found;
  }
  if (best) return best.spot;
  // Nothing clear within reach on any side: straight down past everything below.
  let y = usual.y;
  while (!clear({ ...usual, y }, others)) y += 28;
  return { ...usual, y };
}

/** An agent card's width for a note: narrow for a few words, the usual 420 px for a paragraph. */
export const NOTE_MAX_W = 420;
const NOTE_MIN_W = 200, CHAR_W = 8.5, CARD_PAD = 44;
export function noteWidth(text: string) {
  const longest = Math.max(0, ...text.split("\n").map((line) => [...line].length));
  const w = Math.ceil((longest * CHAR_W + CARD_PAD) / 20) * 20;
  return Math.min(NOTE_MAX_W, Math.max(NOTE_MIN_W, w));
}
