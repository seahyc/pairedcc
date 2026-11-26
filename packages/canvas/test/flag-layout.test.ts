import { describe, it, expect } from "vitest";
import { flagLayout, FLAG_ROOM } from "../src/data/flag-layout";

const view = { x: 0, y: 0, w: 1000, h: 800 };
const card = (x: number, y: number, w = 300, h = 100) => ({ x, y, w, h });

describe("where a stale flag's reason opens", () => {
  it("opens below an object with room under it, and grows up when focused", () => {
    expect(flagLayout(card(100, 200), view, 1)).toEqual({ inView: true, flagY: 188, openBelow: true, growDown: false });
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
