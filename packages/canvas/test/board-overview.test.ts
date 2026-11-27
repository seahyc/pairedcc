import { describe, expect, it } from "vitest";
import { boardGroups, countsLabel, groupLabel, mapLayout, type OverviewItem } from "../src/board-overview";

const card = (id: string, x: number, y: number, text: string, extra: Partial<OverviewItem> = {}): OverviewItem => ({
  id, x, y, w: 200, h: 80, text, thought: Boolean(text), settled: false, ...extra,
});

describe("board overview", () => {
  it("groups piles the person made, frames, and lone objects", () => {
    const items = [
      card("a", 0, 0, "Charge per seat"),
      card("b", 220, 0, "Flat fee", { settled: true }),
      card("c", 3000, 0, "A lone thought"),
      { ...card("f", 0, 1000, ""), w: 600, h: 400, frame: "Pricing", thought: false, inside: { open: 2, settled: 3 } },
    ];
    const { groups, more } = boardGroups(items);
    expect(more).toBe(0);
    expect(groups.map((g) => [g.label, g.count, g.open, g.settled])).toEqual([
      ["Pricing", 1, 2, 3],
      ["Charge per seat", 2, 1, 1],
      ["A lone thought", 1, 1, 0],
    ]);
    expect(groups[1].bounds).toEqual({ x: 0, y: 0, w: 420, h: 80 });
  });
  it("labels a pile by its heading, else its first words in reading order", () => {
    expect(groupLabel([card("a", 300, 0, "Second"), card("b", 0, 0, "First")])).toBe("First");
    expect(groupLabel([card("a", 0, 0, "Body"), card("h", 0, 200, "Pricing", { heading: true })])).toBe("Pricing");
    expect(groupLabel([card("a", 0, 0, ""), card("b", 0, 100, "")])).toBe("2 things");
    expect(groupLabel([card("a", 0, 0, "x".repeat(80))])).toHaveLength(48);
  });
  it("draws at most the limit and counts the rest", () => {
    const items = Array.from({ length: 30 }, (_, i) => card(`c${i}`, i * 1000, 0, `T${i}`));
    const { groups, more } = boardGroups(items, 10);
    expect(groups).toHaveLength(10);
    expect(more).toBe(20);
  });
  it("totals the whole page, including groups past the limit", () => {
    const items = Array.from({ length: 41 }, (_, i) => card(`c${i}`, i * 1000, 0, `T${i}`, { settled: i === 40 }));
    const { groups, more, open, settled } = boardGroups(items, 40);
    expect([groups.length, more, open, settled]).toEqual([40, 1, 40, 1]);
  });
  it("says the counts in words", () => {
    expect(countsLabel(3, 2)).toBe("3 open · 2 settled");
    expect(countsLabel(0, 2)).toBe("2 settled");
    expect(countsLabel(4, 0)).toBe("4 open");
    expect(countsLabel(0, 0)).toBe("nothing written");
  });
  it("maps the groups onto the overview keeping the board's shape", () => {
    const { groups } = boardGroups([card("a", 0, 0, "A"), card("b", 1800, 900, "B")]);
    const map = mapLayout(groups, 420, 220, 10);
    const a = map.find((m) => m.id === "a")!, b = map.find((m) => m.id === "b")!;
    expect(a.left).toBe(10);
    expect(a.top).toBe(10);
    expect(b.left + b.width).toBeLessThanOrEqual(410);
    expect(b.top + b.height).toBeLessThanOrEqual(210);
    expect(a.width).toBe(b.width);
  });
  it("keeps labels from covering each other when boxes grow to fit them", () => {
    const items = Array.from({ length: 12 }, (_, i) => card(`c${i}`, (i % 4) * 230 + Math.floor(i / 4) * 60, Math.floor(i / 4) * 90, `T${i}`)).map((c, i) => ({ ...c, x: c.x + i * 3000 * (i % 2) }));
    const { groups } = boardGroups(items);
    const map = mapLayout(groups, 760, 420, 12, 120, 44);
    for (const [i, a] of map.entries())
      for (const b of map.slice(i + 1))
        expect(a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height).toBe(false);
    for (const m of map) expect(m.left + m.width).toBeLessThanOrEqual(760);
  });
  it("is quick on a 1k-object board", () => {
    const items = Array.from({ length: 1000 }, (_, i) => card(`c${i}`, (i % 40) * 260 + Math.floor(i / 200) * 4000, Math.floor(i / 40) * 120, `Thought ${i}`));
    const t = performance.now();
    const { groups } = boardGroups(items);
    expect(performance.now() - t).toBeLessThan(200);
    expect(groups.length).toBeGreaterThan(0);
  });
});

describe("a card lifted out of its frame stays in the frame's box (item 134)", () => {
  // #155 lifts a card written across a frame's edge onto the page with `within` naming the frame;
  // it moves with the frame, and O counts it there, never as a box of its own.
  const frame = { ...card("f", 0, 0, ""), w: 620, h: 360, frame: "Kitchen quotes", thought: false, inside: { open: 2, settled: 1 } };
  const lifted = card("q", 400, 300, "Which of these quotes is cheapest?", { ask: true, within: "f" });
  it("counts it in the frame's box, which grows to take it in", () => {
    const { groups } = boardGroups([frame, lifted]);
    expect(groups.map((g) => [g.label, g.count, g.open, g.settled])).toEqual([["Kitchen quotes", 2, 3, 1]]);
    expect(groups[0].bounds).toEqual({ x: 0, y: 0, w: 620, h: 380 });
  });
  it("keeps it with its frame even beside a loose pile", () => {
    const pile = [card("p1", 610, 300, "Ask the landlord"), card("p2", 830, 300, "Measure the wall")];
    const { groups } = boardGroups([frame, lifted, ...pile]);
    const frameBox = groups.find((g) => g.label === "Kitchen quotes")!;
    const pileBox = groups.find((g) => g.label === "Ask the landlord")!;
    expect([frameBox.count, pileBox.count]).toEqual([2, 2]);
    expect(groups).toHaveLength(2);
  });
  it("a card whose frame is gone is a loose card again", () => {
    const { groups } = boardGroups([card("x", 0, 0, "Orphan", { within: "gone" })]);
    expect(groups.map((g) => [g.label, g.count])).toEqual([["Orphan", 1]]);
  });
});
