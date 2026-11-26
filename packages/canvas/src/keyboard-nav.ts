/**
 * The loop without a pointer: where a card written from the keyboard goes, and which object
 * Tab lands on first. Pure so the rules are tested without a browser.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GAP = 24;
const STEP = 40;

const clear = (a: Box, b: Box, gap: number) =>
  a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y;
const inside = (a: Box, view: Box) => a.x >= view.x && a.y >= view.y && a.x + a.w <= view.x + view.w && a.y + a.h <= view.y + view.h;

/**
 * Where N then Enter puts a new card: wholly in `view`, clear of every other object by a
 * gap, as close as possible to just under `near` (the object last selected) or else to the
 * middle of the view. With no clear room in view, the middle of the view.
 */
export function keyboardCardSpot(view: Box, others: Box[], size: { w: number; h: number }, near?: Box): { x: number; y: number } {
  const start = near
    ? { x: near.x, y: near.y + near.h + GAP }
    : { x: view.x + (view.w - size.w) / 2, y: view.y + (view.h - size.h) / 2 };
  const candidates: { x: number; y: number; d: number }[] = [];
  const reach = Math.ceil(Math.max(view.w, view.h) / STEP);
  for (let i = -reach; i <= reach; i++)
    for (let j = -reach; j <= reach; j++) {
      const x = start.x + i * STEP, y = start.y + j * STEP;
      // Prefer going down and right of the start, the way writing continues.
      const d = Math.hypot(i, j) + (j < 0 ? 0.5 : 0) + (i < 0 ? 0.25 : 0);
      candidates.push({ x, y, d });
    }
  candidates.sort((a, b) => a.d - b.d);
  for (const c of candidates) {
    const box = { x: c.x, y: c.y, w: size.w, h: size.h };
    if (inside(box, view) && others.every((o) => clear(box, o, GAP))) return { x: c.x, y: c.y };
  }
  return { x: view.x + (view.w - size.w) / 2, y: view.y + (view.h - size.h) / 2 };
}

/**
 * The first Tab stop when nothing is selected: the first object in reading order that is
 * wholly on screen, else the first partly on screen, else the first of all. Reverse for
 * Shift+Tab.
 */
export function firstTabStop<T extends { id: string; box: Box }>(ordered: T[], view: Box, backwards = false): string | undefined {
  const list = backwards ? [...ordered].reverse() : ordered;
  const touches = (b: Box) => !clear(b, view, 0);
  return (list.find((o) => inside(o.box, view)) ?? list.find((o) => touches(o.box)) ?? list[0])?.id;
}
