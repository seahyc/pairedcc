import { describe, it, expect } from "vitest";
import { flagLayout, FLAG_ROOM } from "../src/data/flag-layout";

const view = { x: 0, y: 0, w: 1000, h: 800 };
const card = (x: number, y: number, w = 300, h = 100) => ({ x, y, w, h });

describe("where a stale flag's reason opens", () => {
  it("opens below an object with room under it, and grows up when focused", () => {
    expect(flagLayout(card(100, 200), view, 1)).toEqual({ inView: true, openBelow: true, growDown: false });
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
    expect(flagLayout(card(900, 200), view, 1).inView).toBe(true);
  });
});
