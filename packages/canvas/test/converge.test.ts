import { describe, expect, it } from "vitest";
import { convergeInput, placeBeside, sourceLabel, synthesisText } from "../src/converge/model";
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
  it("puts the synthesis to the right of a column of sources, top-aligned", () => {
    expect(placeBeside([{ x: 0, y: 100, w: 200, h: 80 }, { x: 100, y: 240, w: 100, h: 300 }])).toEqual({ x: 280, y: 100 });
  });
  it("puts the synthesis below a row of sources, so no arrow crosses a source", () => {
    expect(placeBeside([{ x: 0, y: 100, w: 200, h: 80 }, { x: 300, y: 40, w: 100, h: 300 }])).toEqual({ x: 0, y: 420 });
  });
});

describe("cited claims", () => {
  const sourceIds = ["shape:a", "shape:b", "shape:c"];
  it("cites each claim's sources by the letters on their arrows", () => {
    const { text, letters } = synthesisText({ sourceIds, text: "They agree on who pays, not on how recently.", points: [{ text: "Recency is the real choice", sourceIds: ["shape:a", "shape:c"] }] });
    expect(text).toBe("They agree on who pays, not on how recently.\n\n• Recency is the real choice (A, C)");
    expect([...letters.values()]).toEqual(["A", "B", "C"]);
  });
  it("refuses a claim that cites something outside the sources", () => {
    expect(() => synthesisText({ sourceIds, text: "x", points: [{ text: "y", sourceIds: ["shape:z"] }] })).toThrow(/not in sourceIds/);
  });
  it("labels sources A to Z, then AA", () => {
    expect([sourceLabel(0), sourceLabel(25), sourceLabel(26), sourceLabel(27)]).toEqual(["A", "Z", "AA", "AB"]);
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
