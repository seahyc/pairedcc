import { describe, expect, it } from "vitest";
import { MAX_SUGGESTIONS, SUGGEST_AIR, selectionKey, suggestSize, suggestSpot, suggestionsFor, type Selected } from "../src/suggest";
import { startersFor } from "../src/ask-rules";

const mine = (text: string, type = "card"): Selected => ({ type, text, byPerson: true });

describe("P4: which suggestions a selection gets", () => {
  it("reuses the starters logic, cut to at most two", () => {
    const cases: Selected[][] = [[mine("Charge per seat")], [mine("Should we charge per seat?")], [mine("A"), mine("B")], [mine("", "frame")], [mine("", "chart")], [mine("", "dataset")]];
    for (const sel of cases) {
      expect(suggestionsFor(sel)).toEqual(startersFor(sel).slice(0, 2));
      expect(suggestionsFor(sel).length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    }
    expect(suggestionsFor([mine("Point 3")], true)).toEqual(startersFor([], true).slice(0, 2));
  });
  it("is chosen by what is selected: a thought, several objects, a frame, a chart, a record", () => {
    expect(suggestionsFor([mine("Charge per seat")])).toEqual(["What's missing?", "Give me alternatives"]);
    expect(suggestionsFor([mine("A"), mine("B")])[0]).toBe("Compare these");
    expect(suggestionsFor([mine("", "frame")])[0]).toBe("What do these have in common?");
    expect(suggestionsFor([mine("", "chart")])[0]).toBe("What does this show?");
    expect(suggestionsFor([mine("row")], true)[0]).toBe("Is this point valid?");
  });
  it("never appears on an agent's card, alone or among the person's", () => {
    const agent: Selected = { type: "card", text: "Option A: per seat", byPerson: false };
    expect(suggestionsFor([agent])).toEqual([]);
    expect(suggestionsFor([mine("mine"), agent])).toEqual([]);
  });
  it("never appears on asks, answers, comments, an untouched first-board card, an empty card, or nothing", () => {
    expect(suggestionsFor([])).toEqual([]);
    expect(suggestionsFor([{ ...mine("Why?"), conversation: true }])).toEqual([]);
    expect(suggestionsFor([{ ...mine("Try writing here"), untouchedSeed: true }])).toEqual([]);
    expect(suggestionsFor([{ ...mine(""), blank: true }])).toEqual([]);
  });
});

describe("P4: where suggestions go", () => {
  const sel = { x: 100, y: 100, w: 300, h: 80 };
  const size = { w: 220, h: 68 };
  const overlaps = (spot: { x: number; y: number }, o: { x: number; y: number; w: number; h: number }) =>
    spot.x < o.x + o.w && o.x < spot.x + size.w && spot.y < o.y + o.h && o.y < spot.y + size.h;

  it("goes right under the selection on an empty board", () => {
    expect(suggestSpot(sel, size, [])).toEqual({ x: 100, y: 194 });
  });
  it("leaves room for the selection bar when it sits under the selection", () => {
    expect(suggestSpot(sel, size, [], { under: 50 })).toEqual({ x: 100, y: 244 });
  });
  it("slides down a little past something just under the selection", () => {
    const card = { x: 100, y: 200, w: 300, h: 30 };
    const spot = suggestSpot(sel, size, [card])!;
    expect(spot.x).toBe(100);
    expect(spot.y).toBeGreaterThanOrEqual(card.y + card.h + SUGGEST_AIR);
    expect(overlaps(spot, card)).toBe(false);
  });
  it("goes beside the selection when a tall column is under it", () => {
    const column = { x: 80, y: 190, w: 360, h: 600 };
    const spot = suggestSpot(sel, size, [column])!;
    expect(spot.x).toBeGreaterThanOrEqual(sel.x + sel.w);
    expect(overlaps(spot, column)).toBe(false);
  });
  it("is not shown at all when there is no clear place nearby", () => {
    const below = { x: 0, y: 185, w: 1000, h: 600 }, right = { x: 405, y: 0, w: 600, h: 600 };
    expect(suggestSpot(sel, size, [below, right])).toBeNull();
  });
  it("never covers anything on fixed crowded layouts", () => {
    const grid = Array.from({ length: 30 }, (_, i) => ({ x: (i % 6) * 330, y: Math.floor(i / 6) * 150, w: 300, h: 100 }));
    for (const [i, cell] of grid.entries()) {
      const others = grid.filter((_, j) => j !== i);
      const spot = suggestSpot(cell, size, others);
      if (spot) for (const o of others) expect(overlaps(spot, o)).toBe(false);
    }
  });
});

describe("P4: size and identity", () => {
  it("is as wide as the longest suggestion, one line each", () => {
    const short = suggestSize(["Hi?"]), long = suggestSize(["What dimensions do these differ on?", "Compare these"]);
    expect(long.w).toBeGreaterThan(short.w);
    expect(long.h).toBeGreaterThan(short.h);
  });
  it("names a selection the same whatever order it was made in", () => {
    expect(selectionKey(["b", "a"])).toBe(selectionKey(["a", "b"]));
  });
});

import { suggestScale, SUGGEST_FONT, SUGGEST_LINE, SUGGEST_LINE_TOUCH } from "../src/suggest";
describe("117: readable and in view at any zoom", () => {
  it("keeps the same size on screen whatever the zoom", () => {
    for (const zoom of [0.25, 0.37, 1, 2]) {
      const scale = suggestScale(zoom);
      expect(SUGGEST_FONT * scale * zoom).toBeCloseTo(SUGGEST_FONT);
      const page = suggestSize(["What's missing?", "Give me alternatives"], { scale });
      const base = suggestSize(["What's missing?", "Give me alternatives"]);
      expect(page.w * zoom).toBeCloseTo(base.w);
      expect(page.h * zoom).toBeCloseTo(base.h);
    }
    expect(SUGGEST_FONT).toBeGreaterThanOrEqual(15);
  });
  it("gives taps at least 32 px a line on a touch screen", () => {
    expect(SUGGEST_LINE_TOUCH).toBeGreaterThanOrEqual(32);
    expect(suggestSize(["a", "b"], { touch: true }).h).toBeGreaterThan(suggestSize(["a", "b"]).h);
    expect(SUGGEST_LINE).toBeLessThan(SUGGEST_LINE_TOUCH);
  });
  const sel = { x: 100, y: 100, w: 300, h: 80 };
  const size = { w: 220, h: 68 };
  it("is placed only wholly inside the view", () => {
    const view = { x: 0, y: 0, w: 1000, h: 250 };
    const spot = suggestSpot(sel, size, [], { view })!;
    expect(spot.x).toBeGreaterThanOrEqual(sel.x + sel.w);
    expect(spot.y + size.h).toBeLessThanOrEqual(view.y + view.h);
  });
  it("is not shown when no clear spot is in view", () => {
    expect(suggestSpot(sel, size, [], { view: { x: 90, y: 90, w: 320, h: 120 } })).toBeNull();
  });
  it("keeps its gaps the same on screen when zoomed out", () => {
    const scale = 1 / 0.37;
    const spot = suggestSpot(sel, size, [], { scale })!;
    expect((spot.y - (sel.y + sel.h)) / scale).toBeCloseTo(suggestSpot(sel, size, [])!.y - (sel.y + sel.h));
  });
  it("treats the window's own controls as things not to cover", () => {
    const toolbar = { x: 0, y: 190, w: 1000, h: 60 };
    const spot = suggestSpot(sel, size, [toolbar], { view: { x: 0, y: 0, w: 1000, h: 1000 } })!;
    const hits = spot.y < toolbar.y + toolbar.h && toolbar.y < spot.y + size.h && spot.x < toolbar.x + toolbar.w && toolbar.x < spot.x + size.w;
    expect(hits).toBe(false);
  });
});
