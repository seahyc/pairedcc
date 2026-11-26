import { describe, it, expect } from "vitest";
import { chartText, datasetText, type Dataset } from "../src/data/model";

const data: Dataset = {
  title: "Orders (synthetic)",
  source: "test fixture",
  columns: [
    { name: "region", type: "text" },
    { name: "orders", type: "number" },
  ],
  rows: [
    { region: "North", orders: 10 },
    { region: "South", orders: 4 },
    { region: "North", orders: 6 },
    { region: "East", orders: 7 },
  ],
  version: 3,
};

describe("an ask about a chart says what it shows", () => {
  it("gives the measure, grouping, filter, rows in view, each bar and the selection", () => {
    const text = chartText(data, { x: "region", y: "orders", aggregate: "sum", filter: { region: ["North", "South"] }, selected: ["North"] });
    expect(text).toBe(
      [
        "Bar chart of sum of orders by region, from the dataset “Orders (synthetic)”.",
        "Filter: region = North or South. 3 of 4 rows in view.",
        "Bars: North 16 (2 rows, selected), South 4 (1 row).",
        "Selected: North.",
      ].join("\n"),
    );
  });
  it("rounds averages and says when nothing is selected", () => {
    const text = chartText(data, { x: "region", y: "orders", aggregate: "mean", filter: {}, selected: [] });
    expect(text).toContain("mean of orders by region");
    expect(text).toContain("Filter: none. 4 of 4 rows in view.");
    expect(text).toContain("North 8 (2 rows)");
    expect(text).toContain("Selected: none.");
  });
  it("says when the chart is out of date, and gives the bars the person still sees", () => {
    const text = chartText(data, { x: "region", y: "orders", aggregate: "count", filter: {}, selected: [] }, { stale: "“Orders” changed", bars: [{ key: "North", value: 9, count: 9 }] });
    expect(text).toMatch(/^Out of date: “Orders” changed\. The bars below were drawn from an older version of the data\.\n/);
    expect(text).toContain("Bars: North 9 (9 rows).");
    expect(text).toContain("Filter: none.\n");
  });
  it("caps a chart with many bars", () => {
    const many: Dataset = { ...data, rows: Array.from({ length: 60 }, (_, i) => ({ region: `R${i}`, orders: i })) };
    const text = chartText(many, { x: "region", y: "orders", aggregate: "sum", filter: {}, selected: [] });
    expect(text).toContain("and 20 more bars");
  });
});

describe("an ask about a dataset says what it holds", () => {
  it("gives title, source, columns, row count and the first rows", () => {
    const text = datasetText(data, 2);
    expect(text).toBe(
      [
        "Dataset “Orders (synthetic)” (source: test fixture).",
        "Columns: region (text), orders (number). 4 rows.",
        "First 2 rows:",
        "region: North; orders: 10",
        "region: South; orders: 4",
      ].join("\n"),
    );
  });
});
