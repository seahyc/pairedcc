import { describe, expect, it } from "vitest";
import { crowdedOut, foldChoice, foldLine, foldedSaved, foldedShown, nextFold, threadFinished, undecidedLine, type OpenThread } from "../src/fold";

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

describe("at most four unfinished threads in view (item 144)", () => {
  const t = (id: string, askedAt: number, over: Partial<OpenThread> = {}): OpenThread => ({ id, askedAt, state: "answered", answers: 2, finished: false, choice: undefined, ...over });
  it("folds an answered, undecided thread once four more recently asked ones are open", () => {
    const threads = [1, 2, 3, 4, 5, 6].map((n) => t(`a${n}`, n));
    expect([...crowdedOut(threads)].sort()).toEqual(["a1", "a2"]);
    expect(crowdedOut(threads.slice(0, 4)).size).toBe(0);
  });
  it("counts only answered, undecided threads the rule decides", () => {
    const threads = [
      t("old", 1),
      t("picked", 2, { finished: true }),
      t("waiting", 3, { state: "waiting", answers: 0 }),
      t("working", 4, { state: "working", answers: 0 }),
      t("failed", 5, { state: "failed", answers: 0 }),
      t("opened", 6, { choice: "open" }),
      t("folded", 7, { choice: "folded" }),
      t("b", 8),
      t("c", 9),
      t("d", 10),
    ];
    // Only old, b, c, d are counted: four, so none folds by the rule.
    expect(crowdedOut(threads).size).toBe(0);
    const more = [...threads, t("e", 11)];
    expect([...crowdedOut(more)]).toEqual(["old"]);
  });
  it("never folds the waiting, working, failed, finished or opened threads", () => {
    const threads = [t("w", 0, { state: "waiting", answers: 0 }), t("o", 0, { choice: "open" }), t("f", 0, { state: "failed" }), ...[1, 2, 3, 4, 5].map((n) => t(`n${n}`, n))];
    expect([...crowdedOut(threads)]).toEqual(["n1"]);
  });
  it("an answered thread with no answers yet is not counted", () => {
    expect(crowdedOut([t("x", 0, { answers: 0 }), ...[1, 2, 3, 4].map((n) => t(`n${n}`, n))]).size).toBe(0);
  });
  it("a crowded thread is folded as saved, unless the person is on it or opened it", () => {
    expect(foldedSaved(ask(), [{}, {}], true)).toBe(true);
    expect(foldedSaved(ask({ fold: "open" }), [{}, {}], true)).toBe(false);
    expect(foldedShown(ask(), [{}, {}], true, true)).toBe(false);
    expect(foldedShown(ask(), [{}, {}], false, true)).toBe(true);
    expect(foldedSaved(ask(), [{}, {}])).toBe(false);
  });
  it("pressing the line of a crowded thread keeps it open", () => {
    expect(nextFold(true, false)).toBe("open");
  });
});

describe("the folded line of an undecided thread (item 144)", () => {
  it("says it is still open to decide, never that it is settled", () => {
    expect(undecidedLine(3)).toBe("3 options, none picked yet");
    expect(undecidedLine(1)).toBe("1 answer, none picked yet");
  });
});
