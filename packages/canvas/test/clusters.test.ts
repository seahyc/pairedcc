import { describe, expect, it } from "vitest";
import { clusters } from "../src/clusters";

const box = (id: string, x: number, y: number, w = 200, h = 100) => ({ id, x, y, w, h });

describe("clusters of nearby objects", () => {
  it("finds the piles the person made and leaves loners out", () => {
    const result = clusters([
      box("a", 0, 0), box("b", 220, 0), box("c", 0, 120), // a pile: gaps of 20
      box("d", 1000, 0), box("e", 1000, 130), // another pile, gap 30
      box("lonely", 3000, 3000),
    ]);
    expect(result.map((c) => c.ids)).toEqual([["a", "b", "c"], ["d", "e"]]);
    expect(result[0].bounds).toEqual({ x: 0, y: 0, w: 420, h: 220 });
  });
  it("links a chain of near neighbours into one cluster", () => {
    expect(clusters([box("a", 0, 0), box("b", 250, 0), box("c", 500, 0)]).map((c) => c.ids)).toEqual([["a", "b", "c"]]);
  });
  it("uses the gap between edges, not centres", () => {
    expect(clusters([box("a", 0, 0), box("b", 260, 0)], 60).length).toBe(1);
    expect(clusters([box("a", 0, 0), box("b", 261, 0)], 60).length).toBe(0);
    // Diagonal neighbours: both gaps must be within reach.
    expect(clusters([box("a", 0, 0), box("b", 250, 150)], 60).length).toBe(1);
    expect(clusters([box("a", 0, 0), box("b", 250, 200)], 60).length).toBe(0);
  });
  it("stays fast on a large level", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => box(`s${i}`, (i % 100) * 140, Math.floor(i / 100) * 110, 120, 90));
    const t = performance.now();
    const result = clusters(many);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(result[0].ids).toHaveLength(10_000);
  });
});

describe("long chains", () => {
  it("handles a 10,000-object row where each touches only its neighbour", () => {
    const row = Array.from({ length: 10_000 }, (_, i) => box(`r${i}`, i * 210, 0, 200, 100));
    const result = clusters(row);
    expect(result).toHaveLength(1);
    expect(result[0].ids).toHaveLength(10_000);
  });
});
