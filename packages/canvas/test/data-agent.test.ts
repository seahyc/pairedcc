import { describe, expect, it } from "vitest";
import { cellInput, chartInput, chartStateInput, datasetInput, mergeChartState, summaryProps, writeRefusal } from "../src/data/agent";
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

describe("data prototype write rules", () => {
  const chart = { id: "shape:c", type: "chart", meta: { revision: 3 } } as const;
  it("accepts a write only at the revision the agent read", () => {
    expect(writeRefusal(chart, chart.id, "chart", 3, false)).toBeUndefined();
    expect(writeRefusal(chart, chart.id, "chart", 2, false)).toMatch(/changed/i);
    expect(writeRefusal(chart, chart.id, "chart", 4, false)).toMatch(/changed/i);
  });
  it("refuses locked objects even at the right revision", () => {
    expect(writeRefusal(chart, chart.id, "chart", 3, true)).toMatch(/unlock/i);
  });
  it("refuses missing objects and the wrong type", () => {
    expect(writeRefusal(undefined, "shape:x", "chart", 0, false)).toMatch(/not found/);
    expect(writeRefusal(chart, chart.id, "dataset", 3, false)).toMatch(/not a dataset/);
  });
  it("keeps omitted chart state fields and replaces filter and selection whole", () => {
    const current = { x: "region", y: "orders", aggregate: "sum" as const, filter: { product: ["Cake"] }, selected: ["West"] };
    expect(mergeChartState(current, { aggregate: "mean" })).toEqual({ ...current, aggregate: "mean" });
    expect(mergeChartState(current, { filter: { month: ["Feb"] } })).toEqual({ ...current, filter: { month: ["Feb"] } });
    expect(mergeChartState(current, { selected: [] }).selected).toEqual([]);
  });
  it("leaves rows and bars out of a summary read of data objects only", () => {
    const props = { w: 1, h: 2, data: { rows: [{ a: 1 }] }, bars: [{ key: "k", value: 1 }], datasetId: "shape:d" };
    expect(summaryProps("dataset", props)).toEqual({ w: 1, h: 2, datasetId: "shape:d" });
    expect(summaryProps("chart", props)).toEqual({ w: 1, h: 2, datasetId: "shape:d" });
    expect(summaryProps("note", props)).toBe(props);
  });
});
