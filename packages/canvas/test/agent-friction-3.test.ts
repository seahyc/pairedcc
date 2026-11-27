import { describe, expect, it } from "vitest";
import type { Editor } from "tldraw";
import { overview } from "../src/overview";
import { briefRun, summariseRun, type AgentRun } from "../src/agent-runs";

// Item 118, from the 28-task agent attempt (#159).
const text = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
const shape = (id: string, tone: string, meta: Record<string, unknown> = {}) => ({
  id, type: "card", parentId: "page:p", x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, index: "a1", typeName: "shape",
  meta: { revision: 0, ...meta }, props: { w: 200, h: 60, tone, richText: text(id.slice(6)) },
});
const shapes = [
  shape("shape:picked", "agent", { mark: "picked" }),
  shape("shape:crossed", "agent", { mark: "rejected" }),
  shape("shape:quote", "quote"),
  shape("shape:mine", "human", { settled: true }),
];
const fake = {
  getCurrentPage: () => ({ id: "page:p", name: "Board" }),
  getCurrentPageShapesSorted: () => shapes,
  getCurrentPageShapes: () => shapes,
  getPages: () => [{ id: "page:p", name: "Board" }],
  getSelectedShapeIds: () => [],
  getShapePageBounds: () => ({ x: 0, y: 0, w: 200, h: 60 }),
  isShapeOrAncestorLocked: () => false,
};
const editor = new Proxy(fake, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => { throw new Error(`fake editor lacks ${String(k)}`); }) }) as unknown as Editor;
const row = (id: string) => (overview(editor).objects as Record<string, unknown>[]).find((r) => r.id === id)!;

describe("118 (b): overview says what read would have been needed for", () => {
  it("gives the person's pick or cross-out as mark", () => {
    expect(row("shape:picked").mark).toBe("picked");
    expect(row("shape:crossed").mark).toBe("rejected");
    expect(row("shape:quote")).not.toHaveProperty("mark");
  });
  it("gives a card's style", () => {
    expect(row("shape:quote").style).toBe("quote");
    expect(row("shape:picked").style).toBe("note");
    expect(row("shape:mine").style).toBe("handwriting");
  });
  it("gives settled, and only where it is", () => {
    expect(row("shape:mine").settled).toBe(true);
    expect(row("shape:quote")).not.toHaveProperty("settled");
  });
});

const card = (id: string, name: string) => ({ id, typeName: "shape", type: "card", meta: { name }, props: { richText: text(name) } });
const run: AgentRun = {
  runId: "r1", op: "scene", actor: "agent", at: "2026-11-27T00:00:00Z", undone: false, pages: ["page:p"],
  changes: {
    added: { "shape:a": card("shape:a", "Plan"), "binding:b": { id: "binding:b", typeName: "binding" } },
    updated: { "shape:u": [card("shape:u", "Old name"), card("shape:u", "Draft")] },
    removed: { "shape:r": card("shape:r", "Gone note") },
  },
};

describe("118 (a): runs say what each id is", () => {
  it("names each listed object as it was left by the run (removed ones as they were)", () => {
    expect(briefRun(run).names).toEqual({ "shape:a": "Plan", "shape:u": "Draft", "shape:r": "Gone note" });
  });
  it("leaves bindings unnamed and names only the listed ids", () => {
    const many: AgentRun = { ...run, changes: { added: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`shape:n${i}`, card(`shape:n${i}`, `Note ${i}`)])), updated: {}, removed: {} } };
    expect(Object.keys(briefRun(many).names ?? {})).toHaveLength(10);
    expect(Object.keys(summariseRun(run).names ?? {})).not.toContain("binding:b");
  });
  it("keeps each name short, however long the object's name or first line", () => {
    const long = "x".repeat(1000);
    const one: AgentRun = { ...run, changes: { added: { "shape:l": card("shape:l", long) }, updated: {}, removed: {} } };
    const name = briefRun(one).names!["shape:l"];
    expect(name.length).toBeLessThanOrEqual(48);
    expect(name.endsWith("…")).toBe(true);
  });
});

// Item 130, from #172's focused attempt on tasks 30 and 31.
import { reviewDate } from "../src/learning/recall";
describe("130 (b): a settled thought's review date, without a full read", () => {
  const due = Date.UTC(2026, 11, 2, 9, 30);
  it("is an ISO date when the thought is settled and has a schedule", () => {
    expect(reviewDate({ settled: true, recall: { step: 1, due } }, "Human")).toBe("2026-12-02T09:30:00.000Z");
  });
  it("is absent with no schedule (only Check me starts one) or once unsettled", () => {
    expect(reviewDate({ settled: true }, "Human")).toBeUndefined();
    expect(reviewDate({ recall: { step: 0, due } }, "Human")).toBeUndefined();
    expect(reviewDate({ settled: true, recall: { step: 0, due: "soon" } }, "Human")).toBeUndefined();
  });
  it("is in the overview row", () => {
    shapes.push(shape("shape:reviewed", "human", { settled: true, recall: { step: 0, due } }));
    expect(row("shape:reviewed").review).toBe("2026-12-02T09:30:00.000Z");
    expect(row("shape:mine")).not.toHaveProperty("review");
    shapes.pop();
  });
  // Review of #177: only what comes back on the board (the person's own thought) has a date.
  it("is absent on an agent's copy that kept the recall meta", () => {
    shapes.push(shape("shape:copy", "agent", { settled: true, recall: { step: 0, due }, createdBy: "Claude" }));
    expect(row("shape:copy")).not.toHaveProperty("review");
    expect(reviewDate({ settled: true, recall: { step: 0, due } }, "Claude")).toBeUndefined();
    shapes.pop();
  });
});
