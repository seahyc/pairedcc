import { describe, expect, it } from "vitest";
import { sceneInput, orderedScene, layoutPositions } from "../src/composition";

describe("scene composition", () => {
  it("orders nested frames before children regardless of input order", () => {
    const scene = sceneInput.parse({ nodes: [
      { key: "child", parentKey: "frame", shape: { kind: "text", x: 20, y: 30 } },
      { key: "frame", shape: { kind: "frame", x: 100, y: 100 } },
    ] });
    expect(orderedScene(scene).map(node => node.key)).toEqual(["frame", "child"]);
  });
  it("rejects duplicate keys, missing endpoints and circular nesting before mutation", () => {
    const node = { key: "a", shape: { kind: "frame", x: 0, y: 0 } };
    expect(() => orderedScene(sceneInput.parse({ nodes: [node, node] }))).toThrow("unique");
    expect(() => orderedScene(sceneInput.parse({ nodes: [node], connections: [{ fromKey: "a", toKey: "missing" }] }))).toThrow("reference");
    expect(() => orderedScene(sceneInput.parse({ nodes: [{ ...node, parentKey: "a" }] }))).toThrow("cycle");
  });
  it("lays out variable-sized objects without overlapping their grid cells", () => {
    expect(layoutPositions([{ w: 100, h: 50 }, { w: 200, h: 80 }, { w: 70, h: 40 }],
      { layout: "grid", columns: 2, gap: 20, x: 10, y: 30 })).toEqual([
      { x: 10, y: 30 }, { x: 130, y: 30 }, { x: 10, y: 130 },
    ]);
  });
});
