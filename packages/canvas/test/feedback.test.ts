import { describe, expect, it } from "vitest";
import {
  buildFeedback,
  feedbackCounts,
  feedbackMarkdown,
  feedbackTitle,
  filterFeedback,
  mayBeFeedback,
  textEditStamps,
  type FeedbackSource,
} from "../src/feedback";
import { commandSchema, feedbackInput, replyInput } from "../src/protocol";

const t0 = Date.UTC(2026, 10, 26, 6, 0, 0);
const source = (id: string, over: Partial<FeedbackSource> = {}): FeedbackSource => ({
  id: `shape:${id}`,
  type: "card",
  pageId: "page:1",
  pageName: "Page 1",
  name: id,
  text: "",
  author: "Human",
  revision: 1,
  meta: {},
  bounds: { x: 10.4, y: 20.6, w: 100, h: 50 },
  ...over,
});
const comment = (id: string, text: string, meta: Record<string, unknown> = {}, over: Partial<FeedbackSource> = {}) =>
  source(id, { text, meta: { role: "annotation", status: "open", author: "Human", createdAt: t0, ...meta }, ...over });

describe("feedback queue", () => {
  const board: FeedbackSource[] = [
    source("option-a", { type: "image", name: "Option A", author: "Agent", meta: { createdBy: "Agent", mark: "picked", markStatus: "open", markedAt: t0 + 3000 } }),
    source("option-b", { name: "Option B", text: "Night market", author: "Agent", meta: { mark: "rejected", markStatus: "resolved", markedAt: t0 + 1000, resolvedAt: t0 + 9000, resolvedBy: "MCP agent" } }),
    comment("c-object", "make this shorter", { targetId: "shape:option-b", createdAt: t0 + 2000, updatedAt: t0 + 2500 }),
    comment("c-region", "something is missing here", { createdAt: t0 + 4000 }, { pageId: "page:2", pageName: "Ideas" }),
    comment("c-multi", "these two disagree", { targetId: "shape:option-a", targetIds: ["shape:option-a", "shape:option-b"], createdAt: t0 + 5000 }),
    comment("c-gone", "about a deleted thing", { targetId: "shape:deleted", createdAt: t0 + 6000 }),
    source("ink", { type: "draw", inkTargets: ["shape:option-a"], meta: { createdAt: t0 + 7000 } }),
    source("doodle", { type: "draw", inkTargets: [] }),
    source("plain-note", { text: "just a note" }),
    source("reply-1", { text: "Shortened to six words.", author: "MCP agent", meta: { role: "annotation", author: "MCP agent", targetId: "shape:c-object", replyTo: "shape:c-object", createdAt: t0 + 8000 } }),
    source("reply-2", { text: "Earlier reply", author: "MCP agent", meta: { role: "annotation", author: "MCP agent", targetId: "shape:c-object", createdAt: t0 + 7500 } }),
    source("agent-note", { text: "My read of A", author: "MCP agent", meta: { role: "annotation", author: "MCP agent", targetId: "shape:option-a" } }),
    source("pick-reply", { text: "Rendering A properly.", author: "MCP agent", meta: { role: "annotation", author: "MCP agent", targetId: "shape:option-a", replyTo: "shape:option-a", createdAt: t0 + 9500 } }),
  ];
  const items = buildFeedback(board);
  const byId = (id: string, kind?: string) => items.find((i) => i.id === `shape:${id}` && (!kind || i.kind === kind))!;

  it("collects comments, picks, rejects and ink, and nothing else", () => {
    expect(items.map((i) => `${i.kind}:${i.id}`).sort()).toEqual([
      "comment:shape:c-gone",
      "comment:shape:c-multi",
      "comment:shape:c-object",
      "comment:shape:c-region",
      "ink:shape:ink",
      "pick:shape:option-a",
      "reject:shape:option-b",
    ]);
    expect(feedbackCounts(items)).toEqual({ total: 7, open: 6, resolved: 1, comments: 4, picks: 1, rejects: 1, ink: 1 });
  });

  it("puts open items first, oldest first, and resolved items last", () => {
    expect(items.map((i) => i.id.slice(6))).toEqual(["c-object", "option-a", "c-region", "c-multi", "c-gone", "ink", "option-b"]);
    expect(filterFeedback(items, "resolved").map((i) => i.id)).toEqual(["shape:option-b"]);
    expect(filterFeedback(items, "open")).toHaveLength(6);
    expect(filterFeedback(items, "all")).toHaveLength(7);
  });

  it("describes what each item is about", () => {
    const onObject = byId("c-object");
    expect(onObject).toMatchObject({
      kind: "comment",
      status: "open",
      text: "make this shorter",
      author: "Human",
      pageName: "Page 1",
      targetIds: ["shape:option-b"],
      targets: [{ id: "shape:option-b", type: "card", name: "Option B", text: "Night market" }],
      position: { x: 10, y: 21 },
      createdAt: new Date(t0 + 2000).toISOString(),
      updatedAt: new Date(t0 + 2500).toISOString(),
    });
    expect(byId("c-region")).toMatchObject({ targetIds: [], targets: [], pageId: "page:2", pageName: "Ideas" });
    expect(byId("c-multi").targetIds).toEqual(["shape:option-a", "shape:option-b"]);
    expect(byId("c-gone").targets).toEqual([{ id: "shape:deleted", missing: true }]);
    expect(byId("ink").targetIds).toEqual(["shape:option-a"]);
  });

  it("records who resolved an item and when", () => {
    expect(byId("option-b")).toMatchObject({ kind: "reject", status: "resolved", resolvedBy: "MCP agent", resolvedAt: new Date(t0 + 9000).toISOString() });
    expect(byId("option-a").resolvedAt).toBeUndefined();
  });

  it("threads agent replies under the item they answer, in order", () => {
    expect(byId("c-object").replies.map((r) => r.text)).toEqual(["Earlier reply", "Shortened to six words."]);
    // A note about a picked object is a reply only when it says so.
    expect(byId("option-a", "pick").replies.map((r) => r.id)).toEqual(["shape:pick-reply"]);
    expect(items.some((i) => i.id === "shape:reply-1" || i.id === "shape:agent-note")).toBe(false);
  });

  it("ignores agent-authored notes and human notes that are not feedback", () => {
    const only = buildFeedback([
      source("agent", { author: "Agent", meta: { role: "annotation", author: "Agent", status: "open" } }),
      source("plain", { text: "thinking out loud" }),
    ]);
    expect(only).toEqual([]);
  });

  it("titles rows by what was said or judged", () => {
    expect(feedbackTitle(byId("c-object"))).toBe("make this shorter");
    expect(feedbackTitle(byId("option-a", "pick"))).toBe("Picked: Option A");
    expect(feedbackTitle(byId("option-b"))).toBe("Rejected: Option B");
    expect(feedbackTitle(byId("ink"))).toBe("Ink over Option A");
  });

  it("exports readable Markdown with text, target, author, state and replies", () => {
    const md = feedbackMarkdown(items, { title: "Page 1", exportedAt: new Date(t0) });
    expect(md).toContain("# Feedback: Page 1");
    expect(md).toContain("6 open, 1 resolved (4 comments, 1 picks, 1 rejects, 1 ink marks). Exported 2026-11-26T06:00:00.000Z.");
    expect(md).toContain("## Open (6)");
    expect(md).toContain('1. **Comment** on "Option B" (card, shape:option-b)');
    expect(md).toContain("   > make this shorter");
    expect(md).toContain("   - Reply from MCP agent: Shortened to six words.");
    expect(md).toContain("**Comment** on the board at (10, 21)");
    expect(md).toContain("a deleted object (shape:deleted)");
    expect(md).toContain("## Resolved (1)");
    expect(md).toContain('**Rejected** on "Option B" (card, shape:option-b): "Night market"');
    expect(md).toContain("resolved by MCP agent at 2026-11-26T06:00:09.000Z");
    expect(feedbackMarkdown([])).toContain("No feedback has been left on this board.");
  });
});

describe("feedback operations boundary", () => {
  it("defaults to the whole board, every status, as JSON", () => {
    expect(feedbackInput.parse({})).toEqual({ status: "all", allPages: true, format: "json" });
    expect(feedbackInput.safeParse({ status: "pending" }).success).toBe(false);
  });
  it("requires a feedback item id and text to reply", () => {
    expect(replyInput.safeParse({ id: "shape:x", text: "ok" }).success).toBe(true);
    expect(replyInput.safeParse({ id: "x", text: "ok" }).success).toBe(false);
    expect(replyInput.safeParse({ id: "shape:x", text: "" }).success).toBe(false);
  });
  it("accepts the feedback and reply commands", () => {
    expect(commandSchema.safeParse({ op: "feedback" }).success).toBe(true);
    expect(commandSchema.safeParse({ op: "reply", input: { id: "shape:x", text: "ok" } }).success).toBe(true);
  });
});

describe("counting open items from the objects that can be items", () => {
  const open = (sources: FeedbackSource[]) => buildFeedback(sources).filter((i) => i.status === "open").length;
  const board: FeedbackSource[] = [
    source("thought", { text: "How should we price it?" }),
    source("agent-card", { author: "Claude", text: "Per seat" }),
    source("picked", { author: "Claude", meta: { mark: "picked", markStatus: "open", markedAt: t0 } }),
    source("crossed", { meta: { mark: "rejected", markStatus: "resolved", markedAt: t0 } }),
    comment("c1", "Too vague", { targetId: "shape:thought" }),
    comment("c2", "Done", { targetId: "shape:thought", status: "resolved" }),
    source("reply", { author: "Claude", text: "Fixed", meta: { role: "annotation", replyTo: "shape:c1", author: "Claude" } }),
    source("ink", { type: "draw", inkTargets: ["shape:thought"], meta: { createdAt: t0 } }),
    source("stray-ink", { type: "draw", inkTargets: [], meta: {} }),
    comment("both", "Picked and said why", { mark: "picked", markStatus: "open" }),
    ...Array.from({ length: 50 }, (_, i) => source(`plain-${i}`, { type: i % 2 ? "geo" : "text" })),
  ];
  it("is the same count as from every object", () => {
    expect(open(board)).toBe(5);
    expect(open(board.filter(mayBeFeedback))).toBe(open(board));
  });
  it("leaves out plain objects, agent cards and text", () => {
    expect(board.filter(mayBeFeedback).map((s) => s.id.slice(6))).toEqual(["picked", "crossed", "c1", "c2", "reply", "ink", "stray-ink", "both"]);
  });
  it("is zero on a board with no marks, comments or ink", () => {
    expect(board.filter((s) => s.id.includes("plain")).filter(mayBeFeedback)).toEqual([]);
  });
});

describe("the person's own card sent as a question", () => {
  const ask = (state: string) =>
    source("q", { text: "How should we charge?", meta: { ask: { state, attempt: 0, contextIds: [], askedAt: t0 }, targetIds: ["shape:thought"], createdAt: t0 } });
  it("is in the queue like a comment, open until it is answered", () => {
    const items = buildFeedback([source("thought", { text: "Per seat" }), ask("waiting")]);
    expect(items.map((i) => [i.id, i.kind, i.status, i.ask, i.text])).toEqual([["shape:q", "comment", "open", "waiting", "How should we charge?"]]);
    expect(items[0].targetIds).toEqual(["shape:thought"]);
    // Answered and resolved by the answer; a clarifying question leaves it answered but open.
    const resolved = { ...ask("answered"), meta: { ...ask("answered").meta, status: "resolved" } };
    expect(buildFeedback([resolved])[0].status).toBe("resolved");
    expect(buildFeedback([ask("answered")])[0].status).toBe("open");
    expect(mayBeFeedback({ type: "card", meta: ask("waiting").meta })).toBe(true);
  });
  it("carries the agent's answer as its reply", () => {
    const answer = source("a", { text: "Per seat.", author: "Check agent", meta: { role: "annotation", author: "Check agent", replyTo: "shape:q", createdAt: t0 + 1000 } });
    expect(buildFeedback([ask("answered"), answer])[0].replies.map((r) => r.text)).toEqual(["Per seat."]);
  });
  it("a card the person never sent is not in the queue", () => {
    expect(buildFeedback([source("plain", { text: "just a thought" })])).toEqual([]);
  });
});

// Item 140 (c), task 12: the queue says when a comment's target was edited after the comment, so
// an agent knows the comment may already be dealt with (or no longer fit) without reading history.
describe("a target edited after the comment", () => {
  const card = (id: string, updatedAt?: number) => source(id, { text: "Price: £40", meta: { createdAt: t0, ...(updatedAt ? { updatedAt } : {}) } });
  it("carries editedAt when its words changed after the comment was made", () => {
    const [item] = buildFeedback([card("edited", t0 + 9000), comment("c", "too expensive?", { targetId: "shape:edited", createdAt: t0 + 5000 })]);
    expect(item.targets[0].editedAt).toBe(new Date(t0 + 9000).toISOString());
  });
  it("says nothing when the last edit came before the comment, or there was none", () => {
    const before = buildFeedback([card("old", t0 + 1000), comment("c", "hm", { targetId: "shape:old", createdAt: t0 + 5000 })]);
    const never = buildFeedback([card("never"), comment("c", "hm", { targetId: "shape:never", createdAt: t0 + 5000 })]);
    expect(before[0].targets[0].editedAt).toBeUndefined();
    expect(never[0].targets[0].editedAt).toBeUndefined();
  });
  it("works for a pick (against when it was marked) and for ink", () => {
    const picked = source("p", { text: "Option A", author: "Agent", meta: { createdBy: "Agent", mark: "picked", markStatus: "open", markedAt: t0 + 1000, updatedAt: t0 + 3000 } });
    const ink = source("ink", { type: "draw", inkTargets: ["shape:target"], meta: { createdAt: t0 + 1000 } });
    const items = buildFeedback([picked, card("target", t0 + 2000), ink]);
    expect(items.find((i) => i.kind === "pick")!.targets[0].editedAt).toBe(new Date(t0 + 3000).toISOString());
    expect(items.find((i) => i.kind === "ink")!.targets[0].editedAt).toBe(new Date(t0 + 2000).toISOString());
  });
});

// Bolding words is not editing them: the queue's editedAt follows the words, not their formatting.
describe("what counts as a change to a target's words", () => {
  const doc = (...runs: { text: string; marks?: { type: string }[] }[]) => ({ type: "doc", content: [{ type: "paragraph", content: runs.map((r) => ({ type: "text", ...r })) }] });
  const plain = doc({ text: "Price: £40 a month" });
  it("formatting only (bolding all or part of a word) moves updatedAt but not wordsEditedAt", () => {
    const bold = doc({ text: "Price: £" }, { text: "40", marks: [{ type: "bold" }] }, { text: " a month" });
    const half = doc({ text: "Pri" }, { text: "ce: £40 a month", marks: [{ type: "bold" }] });
    expect(textEditStamps(plain, bold, {}, t0 + 5000)).toEqual({ updatedAt: t0 + 5000, wordsEditedAt: null });
    expect(textEditStamps(plain, half, { wordsEditedAt: t0 }, t0 + 5000)).toEqual({ updatedAt: t0 + 5000 });
  });
  it("a real wording edit moves both", () => {
    expect(textEditStamps(plain, doc({ text: "Price: £30 a month" }), {}, t0 + 5000)).toEqual({ updatedAt: t0 + 5000, wordsEditedAt: t0 + 5000 });
  });
  it("nothing when the text is unchanged", () => {
    expect(textEditStamps(plain, plain, {}, t0 + 5000)).toBeUndefined();
  });
  it("a formatting-only edit keeps an older card's last word change (recorded before wordsEditedAt existed)", () => {
    const bold = doc({ text: "Price: £40 a month", marks: [{ type: "bold" }] });
    expect(textEditStamps(plain, bold, { updatedAt: t0 + 1000 }, t0 + 5000)).toEqual({ updatedAt: t0 + 5000, wordsEditedAt: t0 + 1000 });
  });
  it("the queue goes by wordsEditedAt, so a later formatting change is not an edit", () => {
    const card = source("styled", { text: "Price: £40", meta: { createdAt: t0, updatedAt: t0 + 9000, wordsEditedAt: t0 + 1000 } });
    const [item] = buildFeedback([card, comment("c", "too expensive?", { targetId: "shape:styled", createdAt: t0 + 5000 })]);
    expect(item.targets[0].editedAt).toBeUndefined();
    // A card only ever bolded (its words never changed) has none either.
    const bolded = source("bolded", { text: "Price: £40", meta: { createdAt: t0, ...textEditStamps(plain, doc({ text: "Price: £40 a month", marks: [{ type: "bold" }] }), {}, t0 + 9000) } });
    expect(buildFeedback([bolded, comment("c", "hm", { targetId: "shape:bolded", createdAt: t0 + 5000 })])[0].targets[0].editedAt).toBeUndefined();
  });
});

// An Ask made from an existing card: the baseline is when the question was sent, not when the card was made.
describe("a target edited around an Ask from an existing card", () => {
  const asked = (updatedAt: number) => [
    source("thought", { text: "Per seat", meta: { createdAt: t0, updatedAt } }),
    source("q", { text: "How should we charge?", meta: { ask: { state: "waiting", attempt: 0, contextIds: ["shape:thought"], askedAt: t0 + 5000 }, targetIds: ["shape:thought"], createdAt: t0 } }),
  ];
  it("an edit made before the question was sent is not reported", () => {
    const [item] = buildFeedback(asked(t0 + 2000));
    expect(item.targets[0].editedAt).toBeUndefined();
    expect(item.createdAt).toBe(new Date(t0).toISOString());
  });
  it("an edit made after the question was sent is", () => {
    const [item] = buildFeedback(asked(t0 + 8000));
    expect(item.targets[0].editedAt).toBe(new Date(t0 + 8000).toISOString());
    expect(item.createdAt).toBe(new Date(t0).toISOString());
  });
  it("without askedAt, falls back to when the card was made", () => {
    const [thought, q] = asked(t0 + 2000);
    const bare = { ...q, meta: { ...q.meta, ask: { state: "waiting", attempt: 0, contextIds: [] } } };
    expect(buildFeedback([thought, bare])[0].targets[0].editedAt).toBe(new Date(t0 + 2000).toISOString());
  });
});
