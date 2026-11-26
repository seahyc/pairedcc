import { describe, expect, it } from "vitest";
import { convergeInput, placeBeside } from "../src/converge/model";
import { PROTOTYPE_OPS, prototypeRefusal } from "../src/prototype-flags";
import { toolDefs } from "../tools/tool-defs";

describe("converge input", () => {
  const ok = { sourceIds: ["shape:a", "shape:b"], text: "Both definitions agree on repeat visits; they differ on the window." };
  it("needs two to twenty distinct sources and a synthesis", () => {
    expect(convergeInput.parse(ok).sourceIds).toHaveLength(2);
    expect(convergeInput.safeParse({ ...ok, sourceIds: ["shape:a"] }).success).toBe(false);
    expect(convergeInput.safeParse({ ...ok, sourceIds: ["shape:a", "shape:a"] }).success).toBe(false);
    expect(convergeInput.safeParse({ ...ok, sourceIds: Array.from({ length: 21 }, (_, i) => `shape:${i}`) }).success).toBe(false);
    expect(convergeInput.safeParse({ ...ok, text: "  " }).success).toBe(false);
    expect(convergeInput.safeParse({ ...ok, sourceIds: ["a", "b"] }).success).toBe(false);
  });
});

describe("placement", () => {
  it("puts the synthesis to the right of everything it came from, top-aligned", () => {
    expect(placeBeside([{ x: 0, y: 100, w: 200, h: 80 }, { x: 300, y: 40, w: 100, h: 300 }])).toEqual({ x: 480, y: 40 });
  });
});

describe("converge prototype", () => {
  it("is flagged as a prototype tool and refused unless ?prototype=converge", () => {
    const tool = toolDefs.find((t) => t.name === "canvas_converge");
    expect(tool?.prototype).toBe(true);
    expect(tool?.op).toBe("converge");
    expect(PROTOTYPE_OPS.converge).toBe("converge");
    expect(prototypeRefusal("converge", "")).toMatch(/\?prototype=converge/);
    expect(prototypeRefusal("converge", "?prototype=converge")).toBeNull();
  });
});
