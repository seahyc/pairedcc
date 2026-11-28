import { describe, expect, it } from "vitest";
import type { Editor, TLShape } from "tldraw";
import { foldChoice, foldLine, foldedPick, foldedSaved, foldedShown, nextFold, threadFinished } from "../src/fold";

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

// Review of #177 (item 130): the folded line and an agent's `pick` name the same answer.
describe("the folded line and the agent's pick agree", () => {
  const a = { text: "A · per seat", meta: { settled: true } };
  const b = { text: "B · flat fee", meta: { mark: "picked" } };
  it("prefers the picked answer over a settled one before it", () => {
    expect(foldLine("Q", [a, b]).answer.startsWith("B · flat fee")).toBe(true);
  });
  it("falls back to a settled answer when nothing is picked", () => {
    expect(foldLine("Q", [a, { text: "C", meta: {} }]).answer).toBe("A · per seat");
  });
  const doc = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
  const shape = (id: string, meta: Record<string, unknown>, t: string) => ({ id, type: "card", parentId: "page:p", meta, props: { richText: doc(t) } });
  const editorWith = (answers: ReturnType<typeof shape>[]) => {
    const all = [shape("shape:ask", { ask: { state: "answered" } }, "Q"), ...answers];
    const editor = {
      getAncestorPageId: () => "page:p",
      getCurrentPageId: () => "page:p",
      getCurrentPageShapes: () => all,
      getShape: (id: string) => all.find((s) => s.id === id),
    } as unknown as Editor;
    return { editor, ask: all[0] as unknown as TLShape };
  };
  it("pick is the picked answer, and absent when an answer is only settled", () => {
    const both = editorWith([shape("shape:a", { replyTo: "shape:ask", settled: true }, a.text), shape("shape:b", { replyTo: "shape:ask", mark: "picked" }, b.text)]);
    expect(foldedPick(both.editor, both.ask)).toEqual({ id: "shape:b", text: b.text });
    const settledOnly = editorWith([shape("shape:a", { replyTo: "shape:ask", settled: true }, a.text)]);
    expect(foldedPick(settledOnly.editor, settledOnly.ask)).toBeUndefined();
  });
});
