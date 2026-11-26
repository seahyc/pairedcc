import { describe, expect, it } from "vitest";
import { ANSWER_W, LANDING_MS, MIN_ANSWER_W, OPTION_GAP, OPTION_W, answerFit, answerLayout, landedAnswers } from "../src/ask-rules";

describe("answerFit: answers fit the window they land in", () => {
  it("keeps today's sizes and one row when there is room", () => {
    expect(answerFit(1, 1300)).toEqual({ w: ANSWER_W, perRow: 1 });
    expect(answerFit(4, 1300)).toEqual({ w: OPTION_W, perRow: 4 });
  });
  it("wraps options into as many per row as fit", () => {
    expect(answerFit(4, 2 * OPTION_W + OPTION_GAP)).toEqual({ w: OPTION_W, perRow: 2 });
    expect(answerFit(3, 2 * OPTION_W + OPTION_GAP + 10)).toEqual({ w: OPTION_W, perRow: 2 });
  });
  it("on a phone, narrows cards to the window, one option per row", () => {
    expect(answerFit(1, 286)).toEqual({ w: 286, perRow: 1 });
    expect(answerFit(4, 286)).toEqual({ w: OPTION_W, perRow: 1 });
    expect(answerFit(4, 230)).toEqual({ w: 230, perRow: 1 });
  });
  it("never narrower than a readable card", () => {
    expect(answerFit(1, 90).w).toBe(MIN_ANSWER_W);
  });
});

describe("answerLayout with the window's width", () => {
  it("places wrapped options in rows, left-aligned under the ask", () => {
    const { cards, box } = answerLayout({ x: 100, y: 200 }, ["a", "b", "c", "d"], 2 * OPTION_W + OPTION_GAP);
    expect(cards.map((c) => [c.dx, c.row])).toEqual([[0, 0], [OPTION_W + OPTION_GAP, 0], [0, 1], [OPTION_W + OPTION_GAP, 1]]);
    expect(box.w).toBe(2 * OPTION_W + OPTION_GAP);
    expect(box.h).toBeGreaterThan(answerLayout({ x: 100, y: 200 }, ["a", "b"], 2000).box.h);
  });
  it("is unchanged when no width is given", () => {
    const { cards } = answerLayout({ x: 0, y: 0 }, ["a", "b", "c"]);
    expect(cards.every((c) => c.row === 0)).toBe(true);
  });
});

describe("landedAnswers: which answers just arrived", () => {
  it("reports an answer once, when it is new and recent", () => {
    const seen = new Set<string>();
    expect(landedAnswers([{ id: "a", answeredAt: 1000 }], seen, 2000)).toEqual(["a"]);
    expect(landedAnswers([{ id: "a", answeredAt: 1000 }], seen, 2500)).toEqual([]);
  });
  it("ignores answers from long ago, such as a board just loaded", () => {
    expect(landedAnswers([{ id: "a", answeredAt: 1000 }], new Set(), 1000 + LANDING_MS + 1)).toEqual([]);
  });
  it("ignores asks not answered, and reports a retry's new answer", () => {
    const seen = new Set<string>();
    expect(landedAnswers([{ id: "a" }], seen, 10)).toEqual([]);
    landedAnswers([{ id: "a", answeredAt: 100 }], seen, 200);
    expect(landedAnswers([{ id: "a", answeredAt: 900 }], seen, 1000)).toEqual(["a"]);
  });
});
