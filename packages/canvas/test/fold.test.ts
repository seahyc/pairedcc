import { describe, expect, it } from "vitest";
import { foldChoice, foldLine, foldedSaved, foldedShown, nextFold, threadFinished } from "../src/fold";

const ask = (meta: Record<string, unknown> = {}) => ({ ask: { state: "answered" }, ...meta });

describe("folding a finished thread", () => {
  it("a thread is finished when the person picked an answer or settled it", () => {
    expect(threadFinished(ask(), [{}, {}])).toBe(false);
    expect(threadFinished(ask(), [{ mark: "rejected" }, {}])).toBe(false);
    expect(threadFinished(ask(), [{}, { mark: "picked" }])).toBe(true);
    expect(threadFinished(ask({ settled: true }), [])).toBe(true);
    expect(threadFinished(ask(), [{ settled: true }])).toBe(true);
  });
  it("only 'open' and 'folded' are choices", () => {
    expect(foldChoice({ fold: "open" })).toBe("open");
    expect(foldChoice({ fold: "folded" })).toBe("folded");
    expect(foldChoice({ fold: true })).toBeUndefined();
    expect(foldChoice({})).toBeUndefined();
  });
  it("a finished thread folds unless the person opened it", () => {
    const picked = [{ mark: "picked" }, {}];
    expect(foldedSaved(ask(), picked)).toBe(true);
    expect(foldedSaved(ask({ fold: "open" }), picked)).toBe(false);
    expect(foldedSaved(ask(), [{}, {}])).toBe(false);
    expect(foldedSaved(ask({ fold: "folded" }), [{}, {}])).toBe(true);
  });
  it("stays open while the person is on it, and folds when they move on", () => {
    const picked = [{ mark: "picked" }];
    expect(foldedShown(ask(), picked, true)).toBe(false);
    expect(foldedShown(ask(), picked, false)).toBe(true);
    // Folded on purpose: folded even while selected.
    expect(foldedShown(ask({ fold: "folded" }), [], true)).toBe(true);
    expect(foldedShown(ask({ fold: "open" }), picked, false)).toBe(false);
  });
  it("pressing the line unfolds for good; Fold on a finished thread returns it to its default", () => {
    expect(nextFold(true, true)).toBe("open");
    expect(nextFold(true, false)).toBe("open");
    expect(nextFold(false, true)).toBeUndefined();
    expect(nextFold(false, false)).toBe("folded");
  });
  it("the line shows the question and what was picked, with how many it holds", () => {
    const answers = [
      { text: "A · per seat", meta: {} },
      { text: "B · flat fee ", meta: { mark: "picked" } },
      { text: "C · usage", meta: { mark: "rejected" } },
    ];
    expect(foldLine("How should we charge? ", answers)).toEqual({ question: "How should we charge?", answer: "B · flat fee", more: 2 });
    expect(foldLine("Done?", [])).toEqual({ question: "Done?", answer: "", more: 0 });
    expect(foldLine("Q", [{ text: "A", meta: { mark: "picked" } }, { text: "B", meta: { mark: "picked" } }]).answer).toBe("A (+1)");
  });
});
