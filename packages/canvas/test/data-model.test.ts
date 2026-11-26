import { describe, expect, it } from "vitest";
import {
  aggregate,
  chartStateSchema,
  datasetSchema,
  describeChart,
  setCell,
  staleChain,
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

describe("transitive staleness", () => {
  // A note derived from a chart, which is derived from a dataset.
  type Node = { version: number; inputs: { id: string; version: number }[] };
  const graph = (nodes: Record<string, Node>) => (id: string) => nodes[id];
  const fresh = {
    "shape:data": { version: 1, inputs: [] },
    "shape:chart": { version: 4, inputs: [{ id: "shape:data", version: 1 }] },
  };
  const note = [{ id: "shape:chart", version: 4 }];

  it("is not stale while every input up the chain is current", () => {
    expect(staleChain(note, graph(fresh))).toEqual([]);
  });

  it("marks a result stale when its input's own input changed, naming the upstream cause", () => {
    const changed = { ...fresh, "shape:data": { version: 2, inputs: [] } };
    expect(staleChain(note, graph(changed))).toEqual([
      { id: "shape:chart", recorded: 4, current: 4, upstream: [{ id: "shape:data", recorded: 1, current: 2 }] },
    ]);
  });

  it("reports a direct change without upstream detail once the input itself moved on", () => {
    const recomputed = { "shape:data": { version: 2, inputs: [] }, "shape:chart": { version: 5, inputs: [{ id: "shape:data", version: 2 }] } };
    expect(staleChain(note, graph(recomputed))).toEqual([{ id: "shape:chart", recorded: 4, current: 5 }]);
  });

  it("follows chains longer than two and reports a deleted upstream input", () => {
    const nodes = {
      a: { version: 0, inputs: [{ id: "gone", version: 0 }] },
      b: { version: 0, inputs: [{ id: "a", version: 0 }] },
    };
    expect(staleChain([{ id: "b", version: 0 }], graph(nodes))).toEqual([
      { id: "b", recorded: 0, current: 0, upstream: [{ id: "a", recorded: 0, current: 0, upstream: [{ id: "gone", recorded: 0, current: null }] }] },
    ]);
  });

  it("terminates on a cycle and does not call it stale", () => {
    const nodes = { a: { version: 0, inputs: [{ id: "b", version: 0 }] }, b: { version: 0, inputs: [{ id: "a", version: 0 }] } };
    expect(staleChain([{ id: "a", version: 0 }], graph(nodes))).toEqual([]);
  });
});

import { staleReason } from "../src/data/model";
describe("why something is stale, in words", () => {
  const names: Record<string, string> = { "shape:data": "Café orders", "shape:chart": "sum of orders by region", "shape:note": "My summary" };
  const nameOf = (id: string) => names[id];
  it("names a changed or deleted input", () => {
    expect(staleReason([{ id: "shape:data", recorded: 1, current: 2 }], nameOf)).toBe("“Café orders” changed");
    expect(staleReason([{ id: "shape:gone", recorded: 1, current: null }], nameOf)).toBe("an input was deleted");
    expect(staleReason([{ id: "shape:chart", recorded: 1, current: null }], nameOf)).toBe("“sum of orders by region” was deleted");
  });
  it("names the root cause first for transitive staleness, then the path", () => {
    const stale = [{ id: "shape:chart", recorded: 4, current: 4, upstream: [{ id: "shape:data", recorded: 0, current: 1 }] }];
    expect(staleReason(stale, nameOf)).toBe("“Café orders” changed (via “sum of orders by region”)");
  });
  it("counts the rest when several inputs changed", () => {
    const stale = [
      { id: "shape:data", recorded: 1, current: 2 },
      { id: "shape:note", recorded: 0, current: 3 },
      { id: "shape:chart", recorded: 0, current: 1 },
    ];
    expect(staleReason(stale, nameOf)).toBe("“Café orders” changed, and 2 more inputs");
  });
});

describe("why stale, when one input has several upstream causes", () => {
  it("counts every root cause, not just the first input", () => {
    const nameOf = (id: string) => ({ "shape:a": "Orders", "shape:b": "Prices", "shape:chart": "Revenue" })[id];
    const stale = [{ id: "shape:chart", recorded: 1, current: 1, upstream: [{ id: "shape:a", recorded: 0, current: 1 }, { id: "shape:b", recorded: 2, current: 3 }] }];
    expect(staleReason(stale, nameOf)).toBe("“Orders” changed (via “Revenue”), and 1 more input");
  });
});

describe("why stale, when an input is hidden behind a learning prompt", () => {
  // The board passes a nameOf that returns nothing for hidden objects (DataLayer in data/shapes.tsx).
  const visible: Record<string, string> = { "shape:chart": "Revenue" };
  const nameOf = (id: string) => visible[id];
  it("never names a hidden root cause, changed or deleted", () => {
    expect(staleReason([{ id: "shape:secret", recorded: 1, current: 2 }], nameOf)).toBe("an input changed");
    expect(staleReason([{ id: "shape:secret", recorded: 1, current: null }], nameOf)).toBe("an input was deleted");
  });
  it("leaves a hidden object out of the path and still names what is visible", () => {
    const stale = [{ id: "shape:secret", recorded: 1, current: 1, upstream: [{ id: "shape:chart", recorded: 0, current: 1 }] }];
    expect(staleReason(stale, nameOf)).toBe("“Revenue” changed");
  });
});
