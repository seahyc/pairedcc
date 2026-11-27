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
