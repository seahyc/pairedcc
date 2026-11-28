/**
 * Where `canvas_create` puts an object when the agent gives no x/y (item 141). Pure, so it is
 * tested on fixed layouts (test/create-spot.test.ts).
 *
 * Beside the person's selection when there is one: right of it, level with its top (or its
 * bottom), else under, left or above it, whichever clear spot is nearest and wholly in view. Without a selection, or
 * when nothing beside it is clear and in view, the middle of the person's view, moved to the
 * nearest clear spot in view. It never covers anything: on a view with no clear room it steps
 * down from the middle past whatever is there, as answers do.
 */
export type Rect = { x: number; y: number; w: number; h: number };
type Size = { w: number; h: number };

/** The space between the selection and the new object: as an answer keeps from its ask. */
export const CREATE_GAP = 56;
/** Clear space kept around the new object, so it never touches another one. */
export const CREATE_AIR = 8;
const STEP = 8, GRID = 24, FAR = 1200;

const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const clear = (spot: Rect, others: Rect[]) => {
  const roomy = { x: spot.x - CREATE_AIR, y: spot.y - CREATE_AIR, w: spot.w + 2 * CREATE_AIR, h: spot.h + 2 * CREATE_AIR };
  return !others.some((o) => hits(roomy, o));
};
const inView = (a: Rect, v: Rect) => a.x >= v.x && a.y >= v.y && a.x + a.w <= v.x + v.w && a.y + a.h <= v.y + v.h;

type Side = "right" | "under" | "left" | "above";
/** `d` px away on one side, lined up with the selection's top/left edge, or its bottom/right (`far`). */
function beside(sel: Rect, size: Size, side: Side, d: number, far: boolean): Rect {
  const { w, h } = size;
  switch (side) {
    case "right": return { x: sel.x + sel.w + d, y: far ? sel.y + sel.h - h : sel.y, w, h };
    case "under": return { x: far ? sel.x + sel.w - w : sel.x, y: sel.y + sel.h + d, w, h };
    case "left": return { x: sel.x - w - d, y: far ? sel.y + sel.h - h : sel.y, w, h };
    case "above": return { x: far ? sel.x + sel.w - w : sel.x, y: sel.y - h - d, w, h };
  }
}

function besideSelection(sel: Rect, size: Size, view: Rect, others: Rect[]) {
  let best: { spot: Rect; d: number } | undefined;
  for (const side of ["right", "under", "left", "above"] as const)
    search: for (let d = CREATE_GAP; d <= FAR && (!best || d < best.d); d += STEP)
      for (const far of [false, true]) {
        const spot = beside(sel, size, side, d, far);
        if (inView(spot, view) && clear(spot, others)) {
          best = { spot, d };
          break search;
        }
      }
  return best?.spot;
}

function middleOfView(size: Size, view: Rect, others: Rect[], all: Rect[]): Rect {
  const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
  const centre = { x: cx - size.w / 2, y: cy - size.h / 2, w: size.w, h: size.h };
  if (clear(centre, others)) return centre;
  let best: Rect | undefined, bestD = Infinity;
  const nx = Math.floor((view.w - size.w) / 2 / GRID), ny = Math.floor((view.h - size.h) / 2 / GRID);
  for (let i = -nx; i <= nx; i++)
    for (let j = -ny; j <= ny; j++) {
      const d = Math.hypot(i, j);
      if (d >= bestD) continue;
      const spot = { ...centre, x: centre.x + i * GRID, y: centre.y + j * GRID };
      if (clear(spot, others)) {
        best = spot;
        bestD = d;
      }
    }
  if (best) return best;
  // No clear room in view: straight down from the middle, past everything there.
  const spot = { ...centre };
  for (let i = 0; i < 20000 && !clear(spot, all); i++) spot.y += 28;
  return spot;
}

export function createSpot(size: Size, where: { view: Rect; selection?: Rect }, others: Rect[]): Rect {
  const { view, selection } = where;
  // Only what is near the view can be in the way of a spot in it.
  const reach = { x: view.x - FAR, y: view.y - FAR, w: view.w + 2 * FAR, h: view.h + 2 * FAR };
  const near = others.filter((o) => hits(o, reach));
  return (selection && besideSelection(selection, size, view, near)) || middleOfView(size, view, near, others);
}
