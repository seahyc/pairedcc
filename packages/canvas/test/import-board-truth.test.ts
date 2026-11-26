import { describe, expect, it } from "vitest";
import type { TLShape } from "tldraw";
import { sourceText } from "../src/import-meta";
import { parseImport, planImport } from "../src/import-parse";

// Item 65 (rest of the automated review of #46).
describe("tables keep the headers their source marked", () => {
  it("(c) numeric <th> headers in an HTML table stay headers", () => {
    const html = "<table><tr><th>2024</th><th>2025</th></tr><tr><td>120</td><td>131</td></tr></table>";
    const parsed = parseImport(html, "html");
    expect(parsed.kind === "table" && parsed.table.columns).toEqual(["2024", "2025"]);
    expect(parsed.kind === "table" && parsed.table.rows).toEqual([["120", "131"]]);
  });
  it("(c) numeric headers above a markdown rule stay headers", () => {
    const parsed = parseImport("| 2024 | 2025 |\n| --- | --- |\n| 120 | 131 |\n", "markdown");
    expect(parsed.kind === "table" && parsed.table.columns).toEqual(["2024", "2025"]);
  });
  it("(c) a headerless grid of numbers still gets generic column names", () => {
    const parsed = parseImport("<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>", "html");
    expect(parsed.kind === "table" && parsed.table.columns).toEqual(["Column 1", "Column 2"]);
  });
});

describe("markdown tables without outer pipes", () => {
  it("(d) are read as tables", () => {
    const parsed = parseImport("Item | Cost\n--- | ---\nFuel | 120\nCrew | 300\n", "markdown");
    expect(parsed.kind).toBe("table");
    expect(parsed.kind === "table" && parsed.table.columns).toEqual(["Item", "Cost"]);
    expect(parsed.kind === "table" && parsed.table.rows).toEqual([["Fuel", "120"], ["Crew", "300"]]);
  });
  it("(d) prose that happens to hold a pipe is still prose", () => {
    const parsed = parseImport("# Notes\n\nThe route runs A | B on weekdays.\n\nAnother paragraph here.\n", "markdown");
    expect(parsed.kind).toBe("prose");
  });
});

describe("fenced code keeps its lines", () => {
  it("(e) is not flattened into one line", () => {
    const plan = planImport(parseImport("## Sum\n\nWorked out as:\n\n```\nprint(1)\nprint(2)\n```\n", "markdown"));
    expect(plan.kind === "prose" && plan.sections[0].text).toBe("Worked out as:\n\nprint(1)\nprint(2)");
  });
});

describe("an edited title is what the agent gets", () => {
  const shape = (plain: string) => [{
    id: "shape:t", type: "card",
    meta: { name: "No. 2 · Fleet cost inconsistency", source: { importId: "import:x", from: "pasted", at: "2026-11-26T00:00:00Z", kind: "title", values: { "No.": "2", Topic: "Fleet cost inconsistency", Severity: "Critical", Objection: "x".repeat(80) }, chips: [{ label: "Critical", level: 0 }] } },
  } as unknown as TLShape, plain] as const;
  it("(a) as imported, the title is given with its column names", () => {
    expect(sourceText(...shape("No. 2 · Fleet cost inconsistency"))).toBe("No.: 2 · Topic: Fleet cost inconsistency · Severity: Critical");
  });
  it("(a) once the person edits it, the edited text is given", () => {
    expect(sourceText(...shape("No. 2 · Fleet quote reconciled"))).toBe("No. 2 · Fleet quote reconciled");
  });
});
