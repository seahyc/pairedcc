import { describe, it, expect } from "vitest";
import { firstTabStop, keyboardCardSpot, type Box } from "../src/keyboard-nav";

const view: Box = { x: 0, y: 0, w: 1200, h: 800 };
const size = { w: 300, h: 72 };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const within = (a: Box, v: Box) => a.x >= v.x && a.y >= v.y && a.x + a.w <= v.x + v.w && a.y + a.h <= v.y + v.h;

describe("keyboard card spot", () => {
  it("goes in the middle of an empty view", () => {
    expect(keyboardCardSpot(view, [], size)).toEqual({ x: 450, y: 364 });
  });
  it("goes just under the object last selected", () => {
    const near = { x: 100, y: 100, w: 300, h: 120 };
    expect(keyboardCardSpot(view, [near], size, near)).toEqual({ x: 100, y: 244 });
  });
  it("never covers what is already there and stays in view", () => {
    const others: Box[] = [
      { x: 400, y: 300, w: 400, h: 200 },
      { x: 100, y: 100, w: 300, h: 600 },
      { x: 820, y: 360, w: 300, h: 80 },
    ];
    const spot = keyboardCardSpot(view, others, size);
    const box = { ...spot, ...size };
    expect(within(box, view)).toBe(true);
    for (const o of others) expect(overlaps(box, o)).toBe(false);
  });
  it("keeps a gap from its neighbours", () => {
    const near = { x: 100, y: 100, w: 300, h: 120 };
    const below = { x: 100, y: 244, w: 300, h: 72 };
    const spot = keyboardCardSpot(view, [near, below], size, near);
    const box = { ...spot, ...size };
    for (const o of [near, below]) expect(overlaps(box, { x: o.x - 23, y: o.y - 23, w: o.w + 46, h: o.h + 46 })).toBe(false);
  });
  it("falls back to the middle of the view when there is no room", () => {
    expect(keyboardCardSpot(view, [{ x: -10, y: -10, w: 1300, h: 900 }], size)).toEqual({ x: 450, y: 364 });
  });
  it("works in page coordinates away from the origin", () => {
    const far = { x: -5000, y: 2000, w: 1000, h: 600 };
    const box = { ...keyboardCardSpot(far, [], size), ...size };
    expect(within(box, far)).toBe(true);
  });
});

describe("first tab stop", () => {
  const at = (id: string, x: number, y: number) => ({ id, box: { x, y, w: 100, h: 50 } });
  it("is the first object in reading order that is wholly on screen", () => {
    expect(firstTabStop([at("off", -500, 0), at("half", -50, 0), at("a", 10, 10), at("b", 200, 10)], view)).toBe("a");
  });
  it("is one partly on screen when none is wholly", () => {
    expect(firstTabStop([at("off", -500, 0), at("half", -50, 0)], view)).toBe("half");
  });
  it("is the first of all when nothing is on screen, and none on an empty page", () => {
    expect(firstTabStop([at("x", 5000, 0), at("y", 6000, 0)], view)).toBe("x");
    expect(firstTabStop([], view)).toBeUndefined();
  });
});
