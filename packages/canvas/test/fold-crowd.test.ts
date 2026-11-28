import { describe, expect, it } from "vitest";
import { CROWD_LIMIT, crowdFolded, foldLine, type ThreadState } from "../src/fold";

// Item 144 (finding 1, working memory holds about four things): at most four unfinished threads
// stay open on a page; an older answered but undecided thread folds to one line.
const t = (id: string, askedAt: number, over: Partial<ThreadState> = {}): ThreadState => ({
  id, askedAt, state: "answered", answers: 2, finished: false, choice: undefined, touched: false, ...over,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => t(`a${i}`, i));

describe("at most four unfinished threads in view", () => {
  it("the limit is four", () => expect(CROWD_LIMIT).toBe(4));
  it("four answered threads all stay open", () => {
    expect([...crowdFolded(many(4))]).toEqual([]);
  });
  it("a fifth folds the oldest answered, undecided thread", () => {
    expect([...crowdFolded(many(5))]).toEqual(["a0"]);
  });
  it("twelve threads leave the four most recently asked open, whatever order they are listed in", () => {
    const folded = crowdFolded([...many(12)].reverse());
    expect(folded.size).toBe(8);
    for (const id of ["a8", "a9", "a10", "a11"]) expect(folded.has(id)).toBe(false);
  });
  it("finished threads are not counted: they fold by their own rule", () => {
    const list = [...many(4), t("done1", 10, { finished: true }), t("done2", 11, { finished: true })];
    expect([...crowdFolded(list)]).toEqual([]);
  });
  it("a waiting, working or failed ask never folds, and counts as open", () => {
    const list = [t("old", 0), t("w", 1, { state: "waiting", answers: 0 }), t("k", 2, { state: "working", answers: 0 }), t("f", 3, { state: "failed", answers: 0 }), t("x", 4)];
    expect([...crowdFolded(list)]).toEqual(["old"]);
    const crowded = [...many(4).map((s) => ({ ...s, askedAt: s.askedAt + 10 })), t("w", 0, { state: "waiting", answers: 0 })];
    expect(crowdFolded(crowded).has("w")).toBe(false);
  });
  it("an ask with no answers yet never folds by this rule", () => {
    expect(crowdFolded([t("empty", 0, { answers: 0 }), ...many(4).map((s) => ({ ...s, askedAt: s.askedAt + 1 }))]).has("empty")).toBe(false);
  });
  it("a thread the person unfolded never folds, and counts as open", () => {
    const list = [t("old", 0), t("mine", 1, { choice: "open" }), t("b", 2), t("c", 3), t("d", 4)];
    expect([...crowdFolded(list)]).toEqual(["old"]);
    expect(crowdFolded([t("mine", 0, { choice: "open" }), ...many(4).map((s) => ({ ...s, askedAt: s.askedAt + 1 }))]).has("mine")).toBe(false);
  });
  it("a thread the person folded is folded already and leaves room for another", () => {
    const list = [t("old", 0), t("put-away", 5, { choice: "folded" }), t("b", 2), t("c", 3), t("d", 4)];
    expect([...crowdFolded(list)]).toEqual([]);
  });
  it("the thread the person is on never folds, and does not push another out", () => {
    const list = [t("on", 0, { touched: true }), ...many(4).map((s) => ({ ...s, askedAt: s.askedAt + 1 }))];
    expect([...crowdFolded(list)]).toEqual([]);
    // Touching a thread changes nothing for the others: the same set as without it, less itself.
    const five = many(5);
    const touched = five.map((s) => (s.id === "a0" ? { ...s, touched: true } : s));
    expect([...crowdFolded(touched)]).toEqual([]);
    const six = many(6).map((s) => (s.id === "a1" ? { ...s, touched: true } : s));
    expect([...crowdFolded(six)].sort()).toEqual(["a0"]);
  });
  it("the folded line says how many options wait and that none is picked", () => {
    const answers = [{ text: "A · per seat", meta: {} }, { text: "B · flat", meta: { mark: "rejected" } }, { text: "C", meta: {} }];
    expect(foldLine("How should we charge?", answers)).toEqual({ question: "How should we charge?", answer: "", more: 3 });
    expect(foldLine("How should we charge?", answers, true)).toEqual({ question: "How should we charge?", answer: "", more: 0, undecided: "3 options, none picked yet" });
    expect(foldLine("Q", [{ text: "Only", meta: {} }], true).undecided).toBe("1 answer, not picked yet");
  });
});

describe("the board and an agent are given the same set", () => {
  it("touching any one thread folds nothing else: the set is the untouched set less that thread", () => {
    for (let n = 1; n <= 12; n++) {
      const base = crowdFolded(many(n));
      for (let k = 0; k < n; k++) {
        const touched = crowdFolded(many(n).map((s, i) => (i === k ? { ...s, touched: true } : s)));
        expect([...touched].sort()).toEqual([...base].filter((id) => id !== `a${k}`).sort());
      }
    }
  });
  it("a finished thread the person unfolded is not one of the four unfinished", () => {
    expect([...crowdFolded([t("old", 0), t("done", 9, { finished: true, choice: "open" }), t("b", 2), t("c", 3), t("d", 4)])]).toEqual([]);
  });
});
