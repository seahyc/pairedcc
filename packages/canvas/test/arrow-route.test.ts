import { describe, expect, it } from "vitest";
import { anchorPoint, arcPoints, clearRoute, pathClear, type Box } from "../src/arrow-route";
import { bendFor, chooseAnchors } from "../src/connector-follow";

const preferredFor = (from: Box, to: Box) => {
  const want = chooseAnchors(from, to);
  return { start: want.start, end: want.end, bend: bendFor(want) };
};
const drawn = (from: Box, to: Box, r: { start: { x: number; y: number }; end: { x: number; y: number }; bend: number }) =>
  arcPoints(anchorPoint(from, r.start), anchorPoint(to, r.end), r.bend);

describe("arcPoints", () => {
  it("is a straight line for no bend", () => {
    const pts = arcPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 0);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 0 });
    expect(pts.every((p) => p.y === 0)).toBe(true);
  });
  it("bows the way tldraw draws it: a positive bend on a rightward chord sags downward", () => {
    const pts = arcPoints({ x: 0, y: 0 }, { x: 200, y: 0 }, 40);
    const mid = pts.reduce((a, b) => (Math.abs(b.x - 100) < Math.abs(a.x - 100) ? b : a));
    expect(mid.y).toBeCloseTo(40, 0);
    expect(pts[pts.length - 1].x).toBeCloseTo(200, 6);
    expect(pts[pts.length - 1].y).toBeCloseTo(0, 6);
  });
});

describe("pathClear", () => {
  it("fails a path through another card, and one through its own ends", () => {
    const from = { x: 400, y: 0, w: 100, h: 50 }, to = { x: 0, y: 0, w: 100, h: 50 };
    const line = arcPoints({ x: 400, y: 25 }, { x: 100, y: 25 }, 0);
    expect(pathClear(line, from, to, [])).toBe(true);
    expect(pathClear(line, from, to, [{ x: 200, y: 0, w: 100, h: 50 }])).toBe(false);
    expect(pathClear(arcPoints({ x: 500, y: 25 }, { x: 100, y: 25 }, 0), from, to, [])).toBe(false);
  });
});

describe("clearRoute", () => {
  // A record's row: the target card, two cards beside it, the comment beyond them (#147).
  const target = { x: 0, y: 40, w: 300, h: 126 };
  const gap = { x: 316, y: 40, w: 300, h: 101 };
  const fix = { x: 632, y: 40, w: 300, h: 120 };
  const title = { x: 0, y: 0, w: 932, h: 28 };
  const comment = { x: 988, y: 40, w: 300, h: 104 };

  it("keeps the facing sides when nothing is in the way", () => {
    const pref = preferredFor(comment, target);
    expect(clearRoute(comment, target, [], pref)).toBe(pref);
  });
  it("routes round the row instead of over its words, ending on an edge of the target", () => {
    const obstacles = [gap, fix, title];
    const pref = preferredFor(comment, target);
    expect(pathClear(drawn(comment, target, pref), comment, target, obstacles)).toBe(false);
    const route = clearRoute(comment, target, obstacles, pref)!;
    expect(route).toBeDefined();
    expect(route).not.toBe(pref);
    expect(pathClear(drawn(comment, target, route), comment, target, obstacles)).toBe(true);
    // Under the row: the title line above leaves no room over it.
    expect(route.end).toEqual({ x: 0.5, y: 1 });
  });
  it("arcs over a single card between a comment and its card", () => {
    const card = { x: 0, y: 0, w: 260, h: 140 }, middle = { x: 360, y: 0, w: 260, h: 170 }, note = { x: 760, y: 0, w: 300, h: 70 };
    const route = clearRoute(note, card, [middle], preferredFor(note, card))!;
    expect(pathClear(drawn(note, card, route), note, card, [middle])).toBe(true);
  });
  it("gives up when the target is walled in", () => {
    const card = { x: 0, y: 0, w: 100, h: 100 }, note = { x: 600, y: 0, w: 100, h: 100 };
    const walls = [
      { x: -60, y: -60, w: 220, h: 30 },
      { x: -60, y: 130, w: 220, h: 30 },
      { x: -60, y: -60, w: 30, h: 220 },
      { x: 130, y: -60, w: 30, h: 220 },
    ];
    expect(clearRoute(note, card, walls, preferredFor(note, card))).toBeUndefined();
  });
});
