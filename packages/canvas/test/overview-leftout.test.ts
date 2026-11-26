import { describe, expect, it } from "vitest";
import type { Editor } from "tldraw";
import { overview } from "../src/overview";

// Item 86: agents start with canvas_overview, so it must show what the person left out of asks.
const shape = (id: string, meta: Record<string, unknown> = {}) => ({
  id, type: "card", parentId: "page:p", x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, index: "a1", typeName: "shape",
  meta: { name: id, revision: 0, ...meta }, props: { w: 200, h: 60, tone: "human", richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: id }] }] } },
});
const shapes = [shape("shape:aside", { leftOut: true }), shape("shape:plain")];
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

describe("canvas_overview and left-out objects", () => {
  it("marks a left-out object, and only that one", () => {
    const rows = overview(editor).objects as { id: string; leftOut?: boolean }[];
    expect(rows.find((r) => r.id === "shape:aside")?.leftOut).toBe(true);
    expect(rows.find((r) => r.id === "shape:plain")).not.toHaveProperty("leftOut");
  });
});
