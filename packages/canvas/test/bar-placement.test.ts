import { describe, expect, it } from "vitest";
import { BAR_MARGIN, TOOLS_CLEAR, placeBar, statusWidth } from "../src/ask-rules";

const sel = { x: 400, y: 300, bottom: 420 };

describe("placeBar: a bar that wraps to two rows", () => {
  it("is lifted by its real height, so it never covers the top of the selection", () => {
    const sel = { x: 75, y: 594, bottom: 794 };
    // One row: as before. Two rows (80 px tall on a 390 px phone): its bottom stays above the selection.
    expect(placeBar(sel, 373, 390).top).toBe(544);
    const wrapped = placeBar(sel, 373, 390, 80);
    expect(wrapped.top + 80).toBeLessThanOrEqual(sel.y);
    // No room above for the taller bar: it goes below the selection.
    expect(placeBar({ x: 75, y: 120, bottom: 300 }, 373, 390, 80).top).toBe(312);
  });
});

describe("placeBar: the selection bar and Ask box stay inside the window", () => {
  it("sits at the selection's left edge when there is room", () => {
    expect(placeBar(sel, 373, 1440)).toEqual({ left: 400, top: 250, width: 373 });
  });

  it("uses the bar's real width, so a selection near the right edge keeps the bar on screen", () => {
    const { left, width } = placeBar({ ...sel, x: 1094 }, 373, 1440);
    expect(left + width).toBeLessThanOrEqual(1440 - BAR_MARGIN);
  });

  it("keeps clear of the tool strip when the window is wide enough", () => {
    expect(placeBar({ ...sel, x: 10 }, 373, 1440).left).toBe(TOOLS_CLEAR);
  });

  it("on a phone, narrows to the window and may cover the tool strip rather than run off screen", () => {
    for (const x of [0, 80, 200, 380]) {
      const { left, width } = placeBar({ ...sel, x }, 430, 390);
      expect(width).toBe(390 - 2 * BAR_MARGIN);
      expect(left).toBeGreaterThanOrEqual(BAR_MARGIN);
      expect(left + width).toBeLessThanOrEqual(390 - BAR_MARGIN);
    }
  });

  it("a bar that fits beside the tool strip on a phone stays beside it", () => {
    const { left, width } = placeBar({ ...sel, x: 0 }, 300, 390);
    expect(left).toBe(TOOLS_CLEAR);
    expect(width).toBe(300);
  });

  it("goes under the selection when there is no room above it", () => {
    expect(placeBar({ x: 400, y: 80, bottom: 200 }, 373, 1440).top).toBe(212);
  });
});

describe("statusWidth: an ask's state line wraps within its card's width", () => {
  it("matches a card wider than the minimum", () => {
    expect(statusWidth(340)).toBe(340);
  });
  it("never narrower than a readable line, never wider than 640", () => {
    expect(statusWidth(80)).toBe(260);
    expect(statusWidth(2000)).toBe(640);
  });
});
