import { describe, expect, it } from "vitest";
import type { Editor } from "tldraw";
import { overview } from "../src/overview";
import { groupLabel } from "../src/board-overview";

// P2, what was left: named regions beyond frames. The overview (O) labels each group; agents get
// the same label from the same function.
const text = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
const card = (id: string, x: number, y: number, t: string, tone = "human") => ({
  id, type: "card", parentId: "page:p", x, y, rotation: 0, isLocked: false, opacity: 1, index: "a1", typeName: "shape",
  meta: { revision: 0 }, props: { w: 200, h: 60, tone, richText: text(t) },
});
const shapes = [
  card("shape:title", 0, 0, "Pricing ideas"),
  card("shape:a", 0, 80, "Charge per seat"),
  card("shape:b", 220, 80, "Charge per job post"),
  card("shape:far1", 2000, 0, "Office move"),
  card("shape:far2", 2000, 80, "Lease ends in March", "heading"),
];
const fake = {
  getCurrentPage: () => ({ id: "page:p", name: "Board" }),
  getCurrentPageShapesSorted: () => shapes,
  getCurrentPageShapes: () => shapes,
  getPages: () => [{ id: "page:p", name: "Board" }],
  getSelectedShapeIds: () => [],
  getShape: (id: string) => shapes.find((s) => s.id === id),
  getShapePageBounds: (s: any) => {
    const shape = typeof s === "string" ? shapes.find((x) => x.id === s) : s;
    return shape ? { x: shape.x, y: shape.y, w: shape.props.w, h: shape.props.h, maxX: shape.x + shape.props.w, maxY: shape.y + shape.props.h } : undefined;
  },
  isShapeOrAncestorLocked: () => false,
};
const editor = new Proxy(fake, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => { throw new Error(`fake editor lacks ${String(k)}`); }) }) as unknown as Editor;

describe("canvas_overview clusters carry the group's name", () => {
  const { clusters } = overview(editor) as { clusters: { ids: string[]; label?: string }[] };
  it("names a pile by its first words in reading order, as the overview box does", () => {
    const pricing = clusters.find((c) => c.ids.includes("shape:a"))!;
    expect(pricing.label).toBe("Pricing ideas");
  });
  it("prefers a heading in the pile", () => {
    expect(clusters.find((c) => c.ids.includes("shape:far1"))!.label).toBe("Lease ends in March");
  });
  it("is the same function the overview (O) uses", () => {
    const members = shapes.slice(0, 3).map((s) => ({ id: s.id, x: s.x, y: s.y, w: 200, h: 60, text: s.props.richText.content[0].content[0].text, thought: true, settled: false }));
    expect(clusters.find((c) => c.ids.includes("shape:a"))!.label).toBe(groupLabel(members));
  });
});

import { buildPrompt } from "../tools/resident-prompt";

describe("the resident agent is told the group's name", () => {
  const target = { id: "shape:q", type: "card", author: "Human", text: "Which would you test first?" };
  it("with the group's members", () => {
    const prompt = buildPrompt({ question: target.text, targets: [target], group: "Pricing ideas", cluster: [{ id: "shape:a", type: "card", author: "Human", text: "Charge per seat", relation: "above" }] });
    expect(prompt).toContain('the group reads as "Pricing ideas"');
  });
  it("when everything in the group is already given", () => {
    expect(buildPrompt({ question: target.text, targets: [target], group: "Pricing ideas" })).toContain('sits in a group that reads as "Pricing ideas"');
  });
  it("and says nothing about a group when there is none", () => {
    expect(buildPrompt({ question: target.text, targets: [target] })).not.toMatch(/reads as/);
  });
});

describe("a group is not named after an ask about it", () => {
  const item = (id: string, y: number, text: string, ask = false) => ({ id, x: 0, y, w: 200, h: 60, text, thought: true, settled: false, ...(ask ? { ask: true } : {}) });
  it("passes over an ask card, even first in reading order", () => {
    expect(groupLabel([item("q", 0, "Which would you test first?", true), item("t", 80, "Pricing ideas")])).toBe("Pricing ideas");
  });
  it("uses the ask when nothing else in the group has words", () => {
    expect(groupLabel([item("q", 0, "Which would you test first?", true)])).toBe("Which would you test first?");
  });
});

describe("review of #169", () => {
  const item = (id: string, y: number, text: string, extra: Record<string, unknown> = {}) => ({ id, x: 0, y, w: 200, h: 60, text, thought: true, settled: false, ...extra });
  it("an ask that is also a heading does not name the group", () => {
    expect(groupLabel([item("q", 0, "Which idea would you test?", { ask: true, heading: true }), item("c", 80, "Double-click anywhere")])).toBe("Double-click anywhere");
  });
});

describe("a frame beside a loose pile", () => {
  const frame = { id: "shape:frame", type: "frame", parentId: "page:p", x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, index: "a1", typeName: "shape", meta: { revision: 0 }, props: { w: 400, h: 300, name: "Research" } };
  const near = [card("shape:p1", 420, 0, "Pricing ideas"), card("shape:p2", 420, 80, "Charge per seat")];
  const all = [frame, ...near];
  const fake2 = { ...fake, getCurrentPageShapesSorted: () => all, getCurrentPageShapes: () => all, getShape: (id: string) => all.find((s) => s.id === id),
    getShapePageBounds: (s: any) => { const x = typeof s === "string" ? all.find((y) => y.id === s) : s; return x ? { x: x.x, y: x.y, w: x.props.w, h: x.props.h, maxX: x.x + x.props.w, maxY: x.y + x.props.h } : undefined; } };
  const ed2 = new Proxy(fake2, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => { throw new Error(`fake editor lacks ${String(k)}`); }) }) as unknown as Editor;
  it("names the cluster after the pile, as the overview names that pile, not after the frame", () => {
    const { clusters } = overview(ed2) as { clusters: { ids: string[]; label?: string }[] };
    const c = clusters.find((x) => x.ids.includes("shape:p1"))!;
    expect(c.label).toBe("Pricing ideas");
  });
  // Item 142 (c), review of #169: O draws the frame and the pile as two boxes, so the cluster an
  // agent is given holds the pile alone; the name then points at the same objects as the person's map.
  it("keeps the frame out of the pile's cluster, as O does", () => {
    const { clusters } = overview(ed2) as { clusters: { ids: string[]; label?: string }[] };
    expect(clusters.find((x) => x.ids.includes("shape:p1"))!.ids).toEqual(["shape:p1", "shape:p2"]);
    expect(clusters.some((x) => x.ids.includes("shape:frame"))).toBe(false);
  });
});

describe("a question lifted out of its frame (item 132)", () => {
  // #155 lifts a question written across a frame's edge onto the page; there it overlaps the frame
  // and nothing else. The cluster holds the frame and the question, and is named after the frame.
  const frame = { id: "shape:frame", type: "frame", parentId: "page:p", x: 0, y: 0, rotation: 0, isLocked: false, opacity: 1, index: "a1", typeName: "shape", meta: { revision: 0 }, props: { w: 620, h: 360, name: "Kitchen quotes" } };
  const question = { ...card("shape:q", 400, 300, "Which of these quotes is cheapest?"), meta: { revision: 0, within: "shape:frame", ask: { state: "waiting" } } };
  const all = [frame, question];
  const fake3 = { ...fake, getAncestorPageId: () => "page:p", getCurrentPageId: () => "page:p", getSortedChildIdsForParent: (id: string) => all.filter((s) => s.parentId === id).map((s) => s.id), getCurrentPageShapesSorted: () => all, getCurrentPageShapes: () => all, getShape: (id: string) => all.find((s) => s.id === id),
    getShapePageBounds: (s: any) => { const x = typeof s === "string" ? all.find((y) => y.id === s) : s; return x ? { x: x.x, y: x.y, w: x.props.w, h: x.props.h, maxX: x.x + x.props.w, maxY: x.y + x.props.h } : undefined; } };
  const ed3 = new Proxy(fake3, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => { throw new Error(`fake editor lacks ${String(k)}`); }) }) as unknown as Editor;
  const { clusters } = overview(ed3) as { clusters: { ids: string[]; label?: string }[] };
  it("names the cluster after the frame, not the question beside it", () => {
    const c = clusters.find((x) => x.ids.includes("shape:q"))!;
    expect(c.ids).toContain("shape:frame");
    expect(c.label).toBe("Kitchen quotes");
  });
});
