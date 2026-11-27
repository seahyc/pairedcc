import { describe, expect, it } from "vitest";
import { toRichText, type Editor, type TLShape } from "tldraw";
import { readCanvas } from "../src/agent-operations";
import { createRunLedger, runsResult, summariseRun, type AgentRun } from "../src/agent-runs";

// Item 105 (e): tool results an agent pays for in every call.
const card = (id: string, text: string) =>
  ({ id: `shape:${id}`, type: "card", typeName: "shape", parentId: "page:page", x: 0, y: 0, rotation: 0, opacity: 1, isLocked: false, meta: {}, props: { w: 240, h: 80, richText: toRichText(text), tone: "note" } }) as unknown as TLShape;
const words = "We receive feedback every week, mostly about the onboarding emails and the pricing page.";
const shapes = Array.from({ length: 30 }, (_, i) => card(`c${i}`, `${words}\n${words}\n${words}`));
const known: Record<string, unknown> = {
  getCurrentPageShapesSorted: () => shapes,
  getCurrentPageShapes: () => shapes,
  getShape: (id: string) => shapes.find((s) => s.id === id),
  getShapePageBounds: () => undefined,
  getCurrentPage: () => ({ id: "page:page", name: "Page 1" }),
  getCurrentPageId: () => "page:page",
};
const editor = new Proxy({}, { get: (_, key: string) => known[key] ?? (() => []) }) as unknown as Editor;

describe("read gives text once", () => {
  it("leaves rich text out of props; text carries the words", () => {
    const [first] = readCanvas(editor).objects;
    expect(first.text).toContain("We receive feedback");
    expect(first.props).not.toHaveProperty("richText");
    expect(first.props).toMatchObject({ w: 240, tone: "note" });
  });
  it("keeps a partly bold word whole, since text is now the only form read gives", () => {
    const bold = card("bold", "x");
    (bold.props as { richText: unknown }).richText = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "pr", marks: [{ type: "bold" }] }, { type: "text", text: "icing page" }] },
        { type: "paragraph", content: [{ type: "text", text: "second" }, { type: "hardBreak" }, { type: "text", text: "line" }] },
      ],
    };
    shapes.push(bold);
    try {
      expect(readCanvas(editor, { ids: ["shape:bold"] }).objects[0].text).toBe("pricing page second line");
    } finally {
      shapes.pop();
    }
  });
  it("is at least 40% smaller than with rich text (30,563 → 16,193 bytes on this board)", () => {
    const now = JSON.stringify(readCanvas(editor)).length;
    const withRichText = now + shapes.reduce((n, s) => n + JSON.stringify((s.props as { richText: unknown }).richText).length, 0);
    expect(now).toBeLessThan(withRichText * 0.6);
  });
});

const rec = (id: string) => ({ id, typeName: "shape", type: "card", x: 0, props: { color: "black" } });
const bigRun = (runId: string, n: number): AgentRun => ({
  runId,
  op: "scene",
  actor: "agent",
  at: "2026-11-27T00:00:00Z",
  undone: false,
  pages: ["page:page"],
  changes: {
    added: Object.fromEntries(Array.from({ length: n }, (_, i) => [`shape:n${i}`, rec(`shape:n${i}`)])),
    updated: Object.fromEntries(Array.from({ length: n }, (_, i) => [`shape:u${i}`, [rec(`shape:u${i}`), { ...rec(`shape:u${i}`), x: 5 }]])),
    removed: {},
  },
});

describe("runs lists each run briefly", () => {
  const ledger = createRunLedger();
  ledger.add(bigRun("r1", 200));
  ledger.add(bigRun("r2", 3));

  it("shows at most ten ids per list, with the full count when there are more", () => {
    const { runs } = runsResult(ledger, {}, "agent", "page:page");
    const r1 = runs.find((r) => r.runId === "r1")!;
    expect(r1.created).toHaveLength(10);
    expect(r1.createdCount).toBe(200);
    expect(r1.updated).toHaveLength(10);
    expect(r1.updatedCount).toBe(200);
    expect(Object.keys(r1.fields)).toEqual(r1.updated);
    expect(r1).not.toHaveProperty("removedCount");
    const r2 = runs.find((r) => r.runId === "r2")!;
    expect(r2.created).toHaveLength(3);
    expect(r2).not.toHaveProperty("createdCount");
  });
  it("gives one run in full by runId", () => {
    const { runs } = runsResult(ledger, { runId: "r1" }, "agent", "page:page");
    expect(runs).toHaveLength(1);
    expect(runs[0].created).toHaveLength(200);
    expect(runs[0]).not.toHaveProperty("createdCount");
    expect(runs[0]).toEqual(summariseRun(ledger.get("r1")!));
  });
  it("an unknown runId lists nothing rather than everything", () => {
    expect(runsResult(ledger, { runId: "nope" }, "agent", "page:page").runs).toEqual([]);
  });
  it("a listing of twenty big runs stays small", () => {
    const many = createRunLedger();
    for (let i = 0; i < 20; i++) many.add(bigRun(`m${i}`, 200));
    expect(JSON.stringify(runsResult(many, {}, "agent", "page:page")).length).toBeLessThan(30_000);
  });
});
