// A comment's arrow must never be drawn across the words of another card: a line over words
// reads as a cross-out (#147). The usual connector joins the facing sides of its two objects
// (connector-follow.ts). When that line would pass over another card, as it does for a comment
// on one card of an imported record (the comment sits beside the whole record, so the line to
// the card runs over its neighbours), this finds the shortest arc between a side of the comment
// and a side of its target that stays clear of every other card. Pure geometry, no editor.

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };
export type Route = { start: Point; end: Point; bend: number };

/** The four side midpoints, as normalized anchors. */
const SIDES: Point[] = [
  { x: 1, y: 0.5 },
  { x: 0, y: 0.5 },
  { x: 0.5, y: 1 },
  { x: 0.5, y: 0 },
];
/** Air kept between an arrow and a card it passes. */
export const CLEARANCE = 6;
const STEP = 6;

export const anchorPoint = (box: Box, anchor: Point): Point => ({ x: box.x + anchor.x * box.w, y: box.y + anchor.y * box.h });

/**
 * Points along the drawn body of an arrow from a to b with tldraw's bend: a circular arc through
 * both ends and the point `bend` away from the middle of the chord, on the chord's left-hand
 * normal (tldraw's curved-arrow: middle = med + per(u) * -bend). A bend of 0 is a straight line.
 */
export function arcPoints(a: Point, b: Point, bend: number, step = STEP): Point[] {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (len === 0) return [a];
  const ux = dx / len, uy = dy / len;
  const m = { x: (a.x + b.x) / 2 - uy * bend, y: (a.y + b.y) / 2 + ux * bend };
  if (Math.abs(bend) < 0.5) {
    const n = Math.max(1, Math.ceil(len / step));
    return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + (dx * i) / n, y: a.y + (dy * i) / n }));
  }
  // Circle through a, m and b.
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  const sq = (p: Point) => p.x * p.x + p.y * p.y;
  const cx = (sq(a) * (m.y - b.y) + sq(m) * (b.y - a.y) + sq(b) * (a.y - m.y)) / d;
  const cy = (sq(a) * (b.x - m.x) + sq(m) * (a.x - b.x) + sq(b) * (m.x - a.x)) / d;
  const r = Math.hypot(a.x - cx, a.y - cy);
  const angle = (p: Point) => Math.atan2(p.y - cy, p.x - cx);
  const turn = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ta = angle(a), toB = turn(angle(b) - ta), toM = turn(angle(m) - ta);
  // Go round the way that passes the middle point.
  const sweep = toM <= toB ? toB : toB - 2 * Math.PI;
  const n = Math.max(2, Math.ceil((Math.abs(sweep) * r) / step));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: cx + r * Math.cos(ta + (sweep * i) / n), y: cy + r * Math.sin(ta + (sweep * i) / n) }));
}

const inside = (p: Point, b: Box, pad: number) => p.x > b.x - pad && p.x < b.x + b.w + pad && p.y > b.y - pad && p.y < b.y + b.h + pad;

/** The path keeps clear of every obstacle and never runs through its own two ends. */
export function pathClear(points: Point[], from: Box, to: Box, obstacles: Box[], clearance = CLEARANCE) {
  return points.every((p) => !inside(p, from, -2) && !inside(p, to, -2) && !obstacles.some((o) => inside(p, o, clearance)));
}

const pathLength = (points: Point[]) => points.reduce((sum, p, i) => (i ? sum + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) : 0), 0);

/**
 * The route for an arrow from `from` to `to`. The preferred route (the facing sides, with their
 * usual gentle bend) is kept whenever it is clear of the obstacles. Otherwise the shortest arc
 * from a side of `from` to a side of `to` that clears them, bends kept as small as they can be;
 * undefined when no side-to-side arc within reach is clear.
 */
export function clearRoute(from: Box, to: Box, obstacles: Box[], preferred: Route): Route | undefined {
  const near = obstacles.filter((o) => {
    const x = Math.min(from.x, to.x) - 400, y = Math.min(from.y, to.y) - 400;
    const right = Math.max(from.x + from.w, to.x + to.w) + 400, bottom = Math.max(from.y + from.h, to.y + to.h) + 400;
    return o.x < right && o.x + o.w > x && o.y < bottom && o.y + o.h > y;
  });
  const clear = (r: Route) => pathClear(arcPoints(anchorPoint(from, r.start), anchorPoint(to, r.end), r.bend), from, to, near);
  if (clear(preferred)) return preferred;
  let best: { route: Route; cost: number } | undefined;
  for (const start of SIDES)
    for (const end of SIDES) {
      const a = anchorPoint(from, start), b = anchorPoint(to, end);
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      const limit = Math.min(320, chord * 0.6);
      // Smallest bend first on each side of the chord: the first clear one is that side's best.
      for (const sign of [1, -1]) {
        for (let size = sign > 0 ? 0 : 8; size <= limit; size += 8) {
          const bend = sign * size;
          const points = arcPoints(a, b, bend);
          if (!pathClear(points, from, to, near)) continue;
          const cost = pathLength(points) + size * 0.5;
          if (!best || cost < best.cost) best = { route: { start, end, bend }, cost };
          break;
        }
      }
    }
  return best?.route;
}
