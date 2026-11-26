import { describe, expect, it } from "vitest";
import { layerTree } from "../src/layer-tree";

type S = { id: string; parentId: string };
const reference = (shapes: S[], parentId: string) => shapes.filter((s) => s.parentId === parentId).reverse();

describe("layer tree", () => {
  const shapes: S[] = [
    { id: "a", parentId: "page" },
    { id: "frame", parentId: "page" },
    { id: "b", parentId: "frame" },
    { id: "c", parentId: "page" },
    { id: "d", parentId: "frame" },
    { id: "e", parentId: "b" },
  ];

  it("lists each parent's children top-most first, exactly as filtering and reversing did", () => {
    const tree = layerTree(shapes);
    for (const parent of ["page", "frame", "b", "e", "missing"]) expect(tree.childrenOf(parent)).toEqual(reference(shapes, parent));
  });

  it("knows which shapes have children", () => {
    const tree = layerTree(shapes);
    expect(shapes.filter((s) => tree.hasChildren(s.id)).map((s) => s.id)).toEqual(["frame", "b"]);
  });

  it("builds a 20,000-object tree in linear time", () => {
    const many = Array.from({ length: 20_000 }, (_, i) => ({ id: `s${i}`, parentId: i % 10 === 0 ? "page" : `s${i - (i % 10)}` }));
    const t = performance.now();
    const tree = layerTree(many);
    for (const s of many) tree.hasChildren(s.id);
    expect(tree.childrenOf("page")).toHaveLength(2_000);
    expect(tree.childrenOf("s10")).toEqual(reference(many, "s10"));
    // The quadratic version took seconds at this size; linear takes a few milliseconds.
    expect(performance.now() - t).toBeLessThan(250);
  });
});
