import { describe, expect, it } from "vitest";
import {
  aggregate,
  chartStateSchema,
  datasetSchema,
  describeChart,
  setCell,
  staleInputs,
  syntheticOrders,
  toggleFilter,
  toggleSelection,
} from "../src/data/model";

const data = syntheticOrders();

describe("synthetic dataset", () => {
  it("is deterministic and valid", () => {
    expect(syntheticOrders()).toEqual(data);
    expect(datasetSchema.parse(data)).toEqual(data);
    expect(data.rows.length).toBe(48);
    expect(data.columns.map((c) => c.name)).toEqual(["month", "region", "product", "orders"]);
  });
  it("rejects rows that do not match the columns", () => {
    const bad = { ...data, rows: [...data.rows, { month: "Jan", region: "North", product: "Tea", orders: "many" }] };
    expect(datasetSchema.safeParse(bad).success).toBe(false);
    const missing = { ...data, rows: [{ month: "Jan" }] };
    expect(datasetSchema.safeParse(missing).success).toBe(false);
  });
});

describe("chart aggregation and direct filtering", () => {
  const state = chartStateSchema.parse({ x: "region", y: "orders" });
  it("sums the measure by category in first-seen order", () => {
    const bars = aggregate(data, state);
    expect(bars.map((b) => b.key)).toEqual(["North", "South", "East", "West"]);
    const total = data.rows.reduce((n, r) => n + Number(r.orders), 0);
    expect(bars.reduce((n, b) => n + b.value, 0)).toBe(total);
    expect(bars.every((b) => b.count === 12)).toBe(true);
  });
  it("filters rows by a column's values and toggles back", () => {
    const tea = toggleFilter(state, "product", "Tea");
    expect(tea.filter).toEqual({ product: ["Tea"] });
    const teaRows = data.rows.filter((r) => r.product === "Tea");
    expect(aggregate(data, tea).reduce((n, b) => n + b.count, 0)).toBe(teaRows.length);
    expect(toggleFilter(tea, "product", "Tea").filter).toEqual({});
  });
  it("supports mean and count aggregates", () => {
    const mean = aggregate(data, { ...state, aggregate: "mean" });
    const north = data.rows.filter((r) => r.region === "North").map((r) => Number(r.orders));
    expect(mean[0].value).toBeCloseTo(north.reduce((a, b) => a + b, 0) / north.length);
    expect(aggregate(data, { ...state, aggregate: "count" })[0].value).toBe(12);
  });
  it("selects and deselects bars", () => {
    const s = toggleSelection(toggleSelection(state, "North"), "East");
    expect(s.selected).toEqual(["North", "East"]);
    expect(toggleSelection(s, "North").selected).toEqual(["East"]);
  });
  it("rejects unknown columns", () => {
    expect(() => aggregate(data, { ...state, x: "colour" })).toThrow(/Unknown column/);
    expect(() => aggregate(data, { ...state, y: "region" })).toThrow(/numeric/);
  });
});

describe("exact widget state for agents", () => {
  it("reports state, visible bars, selected values and the rows behind them", () => {
    let s = chartStateSchema.parse({ x: "region", y: "orders" });
    s = toggleFilter(s, "product", "Coffee");
    s = toggleSelection(s, "South");
    const d = describeChart(data, s);
    expect(d.state).toEqual(s);
    expect(d.rowsInView).toBe(data.rows.filter((r) => r.product === "Coffee").length);
    expect(d.selected).toHaveLength(1);
    expect(d.selected[0].key).toBe("South");
    const south = data.rows.filter((r) => r.product === "Coffee" && r.region === "South");
    expect(d.selected[0].value).toBe(south.reduce((n, r) => n + Number(r.orders), 0));
    expect(d.selected[0].rows).toEqual(south);
    expect(d.summary).toMatch(/sum of orders by region/);
    expect(d.summary).toMatch(/product = Coffee/);
  });
});

describe("inputs and stale marking", () => {
  it("edits a cell and bumps the dataset version", () => {
    const edited = setCell(data, 0, "orders", 999);
    expect(edited.rows[0].orders).toBe(999);
    expect(edited.version).toBe(data.version + 1);
    expect(data.rows[0].orders).not.toBe(999);
    expect(() => setCell(data, 0, "orders", "x")).toThrow(/number/);
    expect(() => setCell(data, 500, "orders", 1)).toThrow(/Row/);
  });
  it("lists inputs whose content version moved on, or that are gone", () => {
    const versions = new Map([["shape:data", 3], ["shape:chart", 1]]);
    expect(staleInputs([{ id: "shape:data", version: 3 }], versions)).toEqual([]);
    expect(staleInputs([{ id: "shape:data", version: 2 }, { id: "shape:chart", version: 1 }], versions)).toEqual([
      { id: "shape:data", recorded: 2, current: 3 },
    ]);
    expect(staleInputs([{ id: "shape:gone", version: 0 }], versions)).toEqual([
      { id: "shape:gone", recorded: 0, current: null },
    ]);
  });
});
