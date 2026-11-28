import { describe, expect, it } from "vitest";
import { textCue } from "../src/ask-rules";
import { suggestSpot, suggestScale, suggestSize } from "../src/suggest";

describe("128: review findings on #161 and #164", () => {
  it("(a) zoomed in on a phone, suggestions that fit in view are shown though the card they become is wider than the window", () => {
    const zoom = 2, scale = suggestScale(zoom);
    const view = { x: 0, y: 0, w: 390 / zoom, h: 664 / zoom };
    const sel = { x: 10, y: 20, w: 150, h: 40 };
    const size = suggestSize(["What's missing?", "Give me alternatives"], { scale, touch: true });
    const room = { w: 300, h: 72 };
    const spot = suggestSpot(sel, size, [], { view, scale, room });
    expect(spot).not.toBeNull();
    expect(spot!.x + size.w).toBeLessThanOrEqual(view.x + view.w);
  });
  it("(a) the card's room still keeps clear of objects", () => {
    const sel = { x: 0, y: 0, w: 100, h: 40 };
    const size = { w: 100, h: 60 }, room = { w: 300, h: 72 };
    // An object to the right of the suggestions but where the card would land.
    const card = { x: 200, y: 40, w: 50, h: 200 };
    const spot = suggestSpot(sel, size, [card], { room });
    const hit = (s: { x: number; y: number }) => s.x < card.x + card.w && card.x < s.x + room.w && s.y < card.y + card.h && card.y < s.y + room.h;
    expect(spot === null || !hit(spot)).toBe(true);
  });
  it("(a) the window's controls are checked against the suggestions only", () => {
    const sel = { x: 0, y: 0, w: 100, h: 40 };
    const size = { w: 100, h: 60 }, room = { w: 300, h: 72 };
    // A control to the right of the suggestions, where only the (not yet made) card would reach.
    const control = { x: 150, y: 40, w: 60, h: 200 };
    expect(suggestSpot(sel, size, [], { room, chrome: [control] })).toEqual({ x: 0, y: 54 });
  });
  it("(d) any decimal digit is a number", () => {
    expect(textCue("Churn is ٤٪ a month")).toBe("Where does this number come from?");
    expect(textCue("Churn is ４% a month")).toBe("Where does this number come from?");
  });
  it("(e) let’s with a curly apostrophe is a proposal; 'lets' is not", () => {
    expect(textCue("Let’s drop the free plan")).toBe("What would make this wrong?");
    expect(textCue("This lets us ship sooner")).toBe(undefined);
  });
  it("(f) cue words are whole words in any script", () => {
    expect(textCue("No dejes de soñar")).toBe(undefined);
    expect(textCue("Ship it, so we learn")).toBe("What's the strongest objection?");
    // An English cue word joined to an accented letter is not that word (item 149 made
    // "Debería cambiar" a Spanish proposal on purpose, so the boundary is checked here instead).
    expect(textCue("Mustélidos en el jardín")).toBe(undefined);
    expect(textCue("Shouldé vibes")).toBe(undefined);
  });
});
