import { describe, it, expect } from "vitest";
import { notePlace, noteWidth, NOTE_GAP, NOTE_AIR, type Rect } from "../src/note-place";

const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const gap = (a: Rect, b: Rect) =>
  Math.hypot(Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)));
// Task 20's board: ten columns of 240 px cards 280 apart, six rows 160 apart.
const grid = Array.from({ length: 60 }, (_, i) => ({ x: (i % 10) * 280, y: Math.floor(i / 10) * 160, w: 240, h: 82 }));

describe("an agent's note beside its target", () => {
  it("goes 60 px under the target when that is free, as before", () => {
    const target = { x: 100, y: 100, w: 240, h: 80 };
    expect(notePlace(target, { w: 300, h: 60 }, [])).toEqual({ x: 100, y: 180 + NOTE_GAP, w: 300, h: 60 });
  });
  it("on a crowded grid, fits in the gap under its card instead of below the whole grid", () => {
    const target = grid[37];
    const others = grid.filter((g) => g !== target);
    const spot = notePlace(target, { w: 200, h: 59 }, others);
    expect(others.some((o) => hits(spot, o))).toBe(false);
    expect(gap(spot, target)).toBeLessThanOrEqual(40);
    expect(spot.y).toBeGreaterThan(target.y + target.h);
  });
  it("leaves air around the note: nothing within NOTE_AIR of it", () => {
    const target = grid[37];
    const others = grid.filter((g) => g !== target);
    const spot = notePlace(target, { w: 200, h: 59 }, others);
    const roomy = { x: spot.x - NOTE_AIR, y: spot.y - NOTE_AIR, w: spot.w + 2 * NOTE_AIR, h: spot.h + 2 * NOTE_AIR };
    expect(others.some((o) => hits(roomy, o))).toBe(false);
  });
  it("stays in the card's column when the space under it is only a little way down", () => {
    // A second card 60 px under the target; empty space to the left, where beside would be nearer.
    const target = { x: 120, y: 560, w: 240, h: 60 };
    const below = { x: 120, y: 680, w: 240, h: 60 };
    const spot = notePlace(target, { w: 420, h: 81 }, [below]);
    expect(spot.x).toBe(120);
    expect(spot.y).toBeGreaterThan(below.y + below.h);
    expect(hits(spot, below)).toBe(false);
  });
  it("goes beside when under is far down and beside is near", () => {
    // A tall column of cards under the target, open space to the right.
    const target = { x: 0, y: 0, w: 240, h: 80 };
    const column = Array.from({ length: 8 }, (_, i) => ({ x: 0, y: 100 + i * 100, w: 240, h: 90 }));
    const spot = notePlace(target, { w: 300, h: 60 }, column);
    expect(column.some((o) => hits(spot, o))).toBe(false);
    expect(spot.x).toBeGreaterThanOrEqual(240);
    expect(gap(spot, target)).toBeLessThanOrEqual(60);
  });
  it("never covers anything, even when nothing near is free", () => {
    const target = grid[37];
    const others = grid.filter((g) => g !== target);
    const spot = notePlace(target, { w: 420, h: 100 }, others);
    expect(others.some((o) => hits(spot, o))).toBe(false);
  });
});

describe("a note's width", () => {
  it("is narrow for a few words and the full 420 px for a paragraph", () => {
    expect(noteWidth("Check this number")).toBeLessThan(260);
    expect(noteWidth("Check this number")).toBeGreaterThanOrEqual(200);
    expect(noteWidth("This is the only figure on the page with a currency. Is it per month or for the whole pilot?")).toBe(420);
  });
  it("follows the longest line", () => {
    expect(noteWidth("Ok\nA much longer second line with more words in it")).toBeGreaterThan(noteWidth("Ok\nShort"));
  });
});

// Item 140 (a), tasks 06, 11 and 26: an agent that wants its note beside the card, not under it,
// says so with side: "beside" instead of working out x/y itself.
describe("a note asked to go beside its target", () => {
  const target = { x: 100, y: 100, w: 240, h: 80 };
  it("goes 60 px right of the target, level with its top, when that is free", () => {
    expect(notePlace(target, { w: 300, h: 60 }, [], "beside")).toEqual({ x: 340 + NOTE_GAP, y: 100, w: 300, h: 60 });
  });
  it("slides further right past something in the way, rather than under", () => {
    const other = { x: 380, y: 90, w: 200, h: 100 };
    const spot = notePlace(target, { w: 300, h: 60 }, [other], "beside");
    expect(hits(spot, other)).toBe(false);
    expect(spot.x).toBeGreaterThanOrEqual(340);
    expect(spot.y).toBeLessThan(180);
  });
  it("when the right side is crowded far out, takes the nearest clear side and never covers anything", () => {
    const wall = Array.from({ length: 12 }, (_, i) => ({ x: 360 + i * 100, y: 0, w: 96, h: 400 }));
    const spot = notePlace(target, { w: 300, h: 60 }, wall, "beside");
    expect(wall.some((o) => hits(spot, o))).toBe(false)
  });
  it("leaves the default under", () => {
    expect(notePlace(target, { w: 300, h: 60 }, [])).toEqual(notePlace(target, { w: 300, h: 60 }, [], "under"));
  });
});
