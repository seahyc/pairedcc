import { describe, it, expect } from "vitest";
import { flagLayout, flagSize, FLAG_ROOM } from "../src/data/flag-layout";

const view = { x: 0, y: 0, w: 1000, h: 800 };
const card = (x: number, y: number, w = 300, h = 100) => ({ x, y, w, h });

describe("where a stale flag's reason opens", () => {
  it("opens below an object with room under it, and grows up when focused", () => {
    expect(flagLayout(card(100, 200), view, 1)).toEqual({ inView: true, flagY: 188, openBelow: true, growDown: false, focusX: 24, focusY: 0 });
  });
  it("opens above an object near the bottom of the view", () => {
    expect(flagLayout(card(100, 800 - 100 - FLAG_ROOM + 10), view, 1).openBelow).toBe(false);
  });
  it("grows down when focused near the top of the view", () => {
    expect(flagLayout(card(100, 30), view, 1).growDown).toBe(true);
  });
  it("measures room in screen pixels, so zooming out leaves more room", () => {
    // At 25% zoom, 100 board units under the card are only 25 screen pixels.
    expect(flagLayout(card(100, 500, 300, 100), { x: 0, y: 0, w: 4000, h: 700 }, 0.25).openBelow).toBe(false);
    expect(flagLayout(card(100, 500, 300, 100), { x: 0, y: 0, w: 4000, h: 3200 }, 0.25).openBelow).toBe(true);
  });
  it("leaves a flag out of the Tab order once it is panned out of view", () => {
    expect(flagLayout(card(1200, 200), view, 1).inView).toBe(false);
    expect(flagLayout(card(100, -300), view, 1).inView).toBe(false);
    expect(flagLayout(card(600, 200), view, 1).inView).toBe(true);
  });
  it("follows the flag as drawn, not the object's span", () => {
    // Only the object's left 50 px are on screen: its compact flag, at its right end, is not.
    expect(flagLayout(card(950, 200), view, 1).inView).toBe(false);
    // Selected with its top above the view: the reason opens under it, on screen.
    expect(flagLayout(card(100, -40), view, 1).inView).toBe(false);
    expect(flagLayout(card(100, -40), view, 1, true).inView).toBe(true);
  });
  it("slides a compact flag down to stay whole when the object's top edge is at the top of the view", () => {
    expect(flagLayout(card(100, 2), view, 1).flagY).toBe(4);
    expect(flagLayout(card(100, -300), view, 1).flagY).toBe(-292);
  });

});

// Item 93: placement follows the flag as drawn, from its text (11 px mono: 6.6 px a character).
const short = "stale · “Cost” changed"; // 22 characters, one line
const long = "stale · " + "“" + "every region keeps its staff and prices rise in spring ".repeat(4).trim() + "” changed";

describe("the drawn flag", () => {
  it("is as wide as its text, up to 320 compact and 420 open; a reason that wraps takes the whole 420", () => {
    expect(flagSize(short, false)).toEqual({ w: 22 * 6.6 + 16, h: 18 });
    expect(flagSize(long, false).w).toBe(320);
    expect(flagSize(short, true)).toEqual({ w: 22 * 6.6 + 16, h: 18 });
    const open = flagSize(long, true);
    expect(open.w).toBe(420);
    expect(open.h).toBe(4 * 14 + 4); // 233 characters wrap by words onto four lines of 61
  });
});

describe("(a) Tab stops follow the drawn flag", () => {
  it("a selected flag whose short reason opens wholly off the left edge is not a Tab stop", () => {
    // Card at x -260: its right 40 px are on screen, the 161 px reason under its left part is not.
    expect(flagLayout(card(-260, 200), view, 1, true, short).inView).toBe(false);
  });
  it("a selected flag opened into view under a card above the view is a Tab stop", () => {
    // At 200% the card's bottom is 23 units above the view; its 2-line reason (32 units) reaches in.
    const two = "stale · " + "word ".repeat(20).trim();
    expect(flagLayout(card(100, -123), view, 2, true, two).inView).toBe(true);
    expect(flagLayout(card(100, -160), view, 2, true, two).inView).toBe(false);
  });
  it("a compact flag counts by its own width, not its right end", () => {
    // A short flag whose right end is 30 units inside the left edge: most of it is off screen.
    expect(flagLayout(card(-270, 200), view, 1, false, short).inView).toBe(false);
    // Its right end 10 units past the right edge: nearly all of it is on screen.
    expect(flagLayout(card(710, 200), view, 1, false, short).inView).toBe(true);
  });
  it("focused near the left edge, it shifts right to stay inside the view; near the right, left", () => {
    expect(flagLayout(card(-100, 200), view, 1, false, long).focusX).toBe(4 - (200 - 420));
    expect(flagLayout(card(400, 200), view, 1, false, short).focusX).toBe(0);
    expect(flagLayout(card(710, 200), view, 1, false, short).focusX).toBe(996 - 1010);
  });
});

describe("(b) room is measured against the reason as drawn at this zoom", () => {
  it("at 200% a four-line reason does not open into 130 px under the card", () => {
    // Four lines are 60 units, 120 px at 200%, plus the 8-unit gap: more than 130 px.
    const z = 2, h = 800 / z, y = h - 130 / z - 100;
    expect(flagLayout(card(100, y), { x: 0, y: 0, w: 500, h }, z, true, long).openBelow).toBe(false);
    // The old fixed 120 px said it fitted.
    expect(flagLayout(card(100, y), { x: 0, y: 0, w: 500, h }, z, true).openBelow).toBe(true);
  });
  it("a one-line reason still opens below in a little room", () => {
    expect(flagLayout(card(100, 800 - 100 - 60), view, 1, true, short).openBelow).toBe(true);
  });
  it("with no room either side, it opens on the side with more", () => {
    const tight = { x: 0, y: 0, w: 1000, h: 260 };
    expect(flagLayout(card(100, 120), tight, 1, true, long).openBelow).toBe(false);
    expect(flagLayout(card(100, 80), tight, 1, true, long).openBelow).toBe(true);
  });
});

describe("(c) a focused flag straddling the top edge", () => {
  it("grows down from the top edge, not from above it", () => {
    // Card top 15 units above the view: the compact flag sits at -7, half above the canvas.
    const l = flagLayout(card(100, -15), view, 1, false, long);
    expect(l.flagY).toBe(-7);
    expect(l.growDown).toBe(true);
    expect(l.flagY + l.focusY).toBe(4);
  });
  it("stays where it is when it already starts inside the view", () => {
    expect(flagLayout(card(100, 30), view, 1, false, long)).toMatchObject({ growDown: true, focusY: 0 });
    expect(flagLayout(card(100, 300), view, 1, false, long)).toMatchObject({ growDown: false, focusY: 0 });
  });
});
