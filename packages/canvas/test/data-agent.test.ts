import { describe, expect, it } from "vitest";
import { cellInput, chartInput, chartStateInput, datasetInput } from "../src/data/agent";
import { commandSchema } from "../src/protocol";
import { createInput } from "../src/operations";
import { toolDefs } from "../tools/tool-defs";

describe("data prototype agent operations", () => {
  it("are accepted by the command protocol and exposed as tools", () => {
    for (const op of ["dataset", "chart", "chart_state", "cell"]) {
      expect(commandSchema.parse({ op }).op).toBe(op);
      expect(toolDefs.find((t) => t.op === op)?.description).toMatch(/^PROTOTYPE/);
    }
  });
  it("validates dataset input", () => {
    expect(datasetInput.parse({ x: 0, y: 0, synthetic: "orders" }).synthetic).toBe("orders");
    expect(datasetInput.safeParse({ x: 0, y: 0, synthetic: "payroll" }).success).toBe(false);
    expect(datasetInput.safeParse({ x: 0, y: 0, columns: [{ name: "a", type: "date" }] }).success).toBe(false);
  });
  it("fills chart defaults and requires a dataset id", () => {
    const c = chartInput.parse({ x: 0, y: 0, datasetId: "shape:d", state: { x: "region", y: "orders" } });
    expect(c.state).toEqual({ x: "region", y: "orders", aggregate: "sum", filter: {}, selected: [] });
    expect(chartInput.safeParse({ x: 0, y: 0, datasetId: "d", state: { x: "a", y: "b" } }).success).toBe(false);
  });
  it("requires revisions for chart state and cell changes, and keeps state partial", () => {
    expect(chartStateInput.safeParse({ id: "shape:c", state: {} }).success).toBe(false);
    const s = chartStateInput.parse({ id: "shape:c", expectedRevision: 2, state: { selected: ["North"] } });
    expect(s.state).toEqual({ selected: ["North"] });
    expect(cellInput.safeParse({ id: "shape:d", expectedRevision: 0, row: -1, column: "orders", value: 1 }).success).toBe(false);
    expect(cellInput.safeParse({ id: "shape:d", expectedRevision: 0, row: 0, column: "orders", value: Infinity }).success).toBe(false);
  });
  it("lets created objects record the inputs they were derived from", () => {
    expect(createInput.parse({ kind: "note", x: 0, y: 0, inputs: ["shape:c"] }).inputs).toEqual(["shape:c"]);
    expect(createInput.safeParse({ kind: "note", x: 0, y: 0, inputs: ["c"] }).success).toBe(false);
  });
});
