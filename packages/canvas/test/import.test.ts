import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ImportError,
  detectPaste,
  detectShape,
  formatOfFile,
  parseDelimited,
  parseHtmlTable,
  parseImport,
  parseJson,
  parseProse,
  planImport,
  summarise,
  toTable,
  type ImportPlan,
} from "../src/import-parse";
import { sourceAuthor, sourceText } from "../src/import-meta";
import { startersFor } from "../src/ask-rules";
import { buildPrompt } from "../tools/resident-prompt";
import { toolDefs } from "../tools/tool-defs";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const records = (plan: ImportPlan) => {
  if (plan.kind !== "records") throw new Error(`expected records, got ${plan.kind}`);
  return plan;
};
const fieldColumns = ["How a sceptical reader would attack this", "What the pack already says in defence", "Gap / exposure", "Suggested fix"];

describe("delimited text", () => {
  it("reads quoted fields, doubled quotes, embedded commas and line breaks", () => {
    expect(parseDelimited(fixture("quoted.csv"), ",")).toEqual([
      ["id", "comment", "owner"],
      ["1", 'Said "not yet", then agreed, reluctantly', "Mina"],
      ["2", "First line\nsecond line", "Tomas"],
      ["3", "plain", "Okafor, R."],
    ]);
  });
  it("reads TSV with CRLF line ends and keeps empty trailing cells", () => {
    expect(parseDelimited("a\tb\tc\r\n1\t\t\r\n", "\t")).toEqual([["a", "b", "c"], ["1", "", ""]]);
  });
  it("takes title lines above the header as the title and note", () => {
    const table = toTable(parseDelimited(fixture("review.tsv"), "\t"));
    expect(table.title).toBe("Adversarial review: Larkspur Ferries funding pack (draft 3)");
    expect(table.note).toMatch(/^Read as a sceptical assessor/);
    expect(table.columns).toEqual(["No.", "Q", "Topic", ...fieldColumns, "Severity", "Check"]);
    expect(table.rows).toHaveLength(10);
  });
  it("treats a first row of numbers as data, not a header", () => {
    expect(toTable([["1", "2"], ["3", "4"]])).toEqual({ columns: ["Column 1", "Column 2"], rows: [["1", "2"], ["3", "4"]] });
  });
});

describe("HTML table from a spreadsheet clipboard", () => {
  it("reads cells, entities, line breaks and merged title rows", () => {
    const rows = parseHtmlTable('<table><tr><td colspan="2">Title &amp; more</td></tr><tr><th>A</th><th>B</th></tr><tr><td style="x">one<br>two</td><td>&lt;3&#33;&nbsp;ok</td></tr></table>');
    expect(rows).toEqual([["Title & more", ""], ["A", "B"], ["one\ntwo", "<3! ok"]]);
  });
  it("gives the same table as the TSV of the same tab", () => {
    const fromHtml = parseImport(fixture("review.html"), "html"), fromTsv = parseImport(fixture("review.tsv"), "tsv");
    expect(fromHtml).toEqual(fromTsv);
  });
  it("returns null when there is no table", () => {
    expect(parseHtmlTable("<p>hello</p>")).toBeNull();
  });
});

describe("shape detection", () => {
  it("sees the review as records: identifiers, four fields, a severity tag and a verdict column", () => {
    const parsed = parseImport(fixture("review.tsv"), "tsv");
    if (parsed.kind !== "table") throw new Error("not a table");
    const shape = detectShape(parsed.table);
    expect(shape.kind).toBe("records");
    expect(shape.roles).toEqual(["title", "title", "title", "field", "field", "field", "field", "tag", "verdict"]);
    expect(shape.severity).toBe(7);
  });
  it("keeps a grid of numbers as a table", () => {
    const plan = planImport(parseImport(fixture("metrics.csv"), "csv"));
    expect(plan.kind).toBe("table");
    if (plan.kind === "table") {
      expect(plan.table.columns[0]).toBe("Route");
      expect(plan.table.rows).toHaveLength(6);
    }
    expect(summarise(plan, "metrics.csv")).toBe("6 rows from metrics.csv, as a table");
  });
  it("can be told to show a records table as a table, and a grid as cards", () => {
    expect(planImport(parseImport(fixture("review.csv"), "csv"), "table").kind).toBe("table");
    const cards = records(planImport(parseImport(fixture("metrics.csv"), "csv"), "cards"));
    expect(cards.records).toHaveLength(6);
    expect(cards.records[0].fields.length).toBeGreaterThan(0);
  });
});

describe("the review as records", () => {
  const plan = records(planImport(parseImport(fixture("review.html"), "html")));
  it("makes ten records, most severe first, original order kept within a severity", () => {
    expect(plan.records).toHaveLength(10);
    expect(plan.records.map((r) => r.chips[0].label)).toEqual(["Critical", "Critical", "Critical", "High", "High", "High", "Medium", "Medium", "Medium", "Medium"]);
    expect(plan.records.map((r) => r.row)).toEqual([2, 3, 7, 1, 5, 9, 4, 6, 8, 10]);
    expect(plan.sorted).toBe(true);
  });
  it("puts the identifying fields on the title line and each long field on its own card", () => {
    const first = plan.records[0];
    expect(first.title).toBe("No. 2 · Q56 vs Q16/Q49 · Fleet cost inconsistency");
    expect(first.fields.map((f) => f.column)).toEqual(fieldColumns);
    expect(first.fields[0].text).toMatch(/^“Q56 says two vessels cost 9.2m/);
    expect(first.level).toBe(0);
    expect(first.values.Severity).toBe("Critical");
  });
  it("does not draw the empty verdict column, and says which it was", () => {
    expect(plan.verdictColumns).toEqual(["Check"]);
    expect(plan.records.every((r) => !r.fields.some((f) => f.column === "Check"))).toBe(true);
  });
  it("has a legend for severity and a summary line", () => {
    expect(plan.legend).toEqual({ column: "Severity", chips: [{ label: "Critical", level: 0 }, { label: "High", level: 1 }, { label: "Medium", level: 2 }] });
    expect(summarise(plan, "paste")).toBe("10 records from paste, as cards, most severe first");
  });
  it("reads the CSV export the same way", () => {
    expect(records(planImport(parseImport(fixture("review.csv"), "csv"))).records).toEqual(plan.records);
  });
});

describe("markdown and prose", () => {
  it("makes one section per heading in reading order, with the title taken from the top heading", () => {
    const doc = parseProse(fixture("notes.md"));
    expect(doc.title).toBe("Larkspur Ferries: route review notes");
    expect(doc.sections.map((s) => s.heading)).toEqual(["What the route is for", "What worries the assessors", "What to do next"]);
    expect(doc.sections[0].text).toContain("saves a forty minute drive");
    expect(doc.sections[0].text.split("\n\n")).toHaveLength(2);
    expect(doc.sections[1].text.split("\n")).toHaveLength(3);
    expect(doc.sections[1].text).toMatch(/^• The winter passenger numbers/);
    expect(doc.sections[2].text).toContain("port authority for a written option");
    expect(doc.sections[2].text).toContain("total = vessels + fit-out + contingency");
  });
  it("makes one section per paragraph when there are no headings", () => {
    expect(parseProse("First thought,\nwrapped.\n\nSecond thought.").sections).toEqual([{ text: "First thought, wrapped." }, { text: "Second thought." }]);
  });
  it("splits a very long section at paragraph breaks", () => {
    const long = `## Long\n\n${Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${"word ".repeat(60)}`).join("\n\n")}`;
    const sections = parseProse(long).sections;
    expect(sections.length).toBeGreaterThan(1);
    expect(sections[1].heading).toBe("Long (continued)");
    expect(Math.max(...sections.map((s) => s.text.length))).toBeLessThan(1000);
  });
  it("reads a markdown pipe table as a table", () => {
    const parsed = parseImport("## Costs\n\n| Item | 2024 | 2025 |\n|---|---:|---:|\n| Fuel | 120 | 131 |\n| Crew | 300 | 322 |\n", "markdown");
    expect(parsed).toEqual({ kind: "table", table: { title: "Costs", columns: ["Item", "2024", "2025"], rows: [["Fuel", "120", "131"], ["Crew", "300", "322"]] } });
  });
});

describe("JSON", () => {
  it("reads an array of objects as records, keys as columns", () => {
    const table = parseJson(fixture("findings.json"));
    expect(table.columns).toEqual(["id", "section", "topic", "objection", "severity", "checked"]);
    const plan = records(planImport({ kind: "table", table }));
    expect(plan.records).toHaveLength(4);
    expect(plan.records[0].fields.map((f) => f.column)).toEqual(["objection"]);
    expect(plan.verdictColumns).toEqual(["checked"]);
    expect(plan.records[0].chips[0]).toEqual({ label: "Critical", level: 0 });
  });
  it("unwraps an object holding one list, and refuses other JSON with a plain message", () => {
    expect(parseJson('{"items":[{"a":1,"b":"x"}]}')).toEqual({ title: "items", columns: ["a", "b"], rows: [["1", "x"]] });
    expect(() => parseJson('{"a":1}')).toThrow(ImportError);
    expect(() => parseJson('{"tldrawFileFormatVersion":1}')).toThrow(/saved board/);
    expect(() => parseJson("{nope")).toThrow(/could not be read/);
  });
});

describe("what a paste becomes", () => {
  it("prefers the HTML table, falls back to TSV", () => {
    expect(detectPaste({ html: fixture("review.html"), text: fixture("review.tsv") })?.format).toBe("html");
    expect(detectPaste({ text: fixture("review.tsv") })?.format).toBe("tsv");
    expect(detectPaste({ html: "<b>bold</b>", text: fixture("review.tsv") })?.format).toBe("tsv");
  });
  it("leaves ordinary text, one cell and the canvas's own copies alone", () => {
    expect(detectPaste({ text: "Charge per seat, not per company" })).toBeNull();
    expect(detectPaste({ text: "A sentence, with commas, in it.\nAnother, also, with some." })).toBeNull();
    expect(detectPaste({ text: "word ".repeat(300) })).toBeNull();
    expect(detectPaste({ html: "<table><tr><td>one cell</td></tr></table>", text: "one cell" })).toBeNull();
    expect(detectPaste({ html: '<div data-tldraw="1"><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table></div>', text: "" })).toBeNull();
  });
  it("lays out a pasted document of several paragraphs as cards", () => {
    expect(detectPaste({ text: fixture("notes.md") })?.format).toBe("markdown");
  });
  it("knows file types by name", () => {
    expect(["a.CSV", "b.tsv", "c.md", "d.txt", "e.json", "f.png", "g.xlsx", "h.zip"].map(formatOfFile)).toEqual(["csv", "tsv", "markdown", "text", "json", "image", "xlsx", null]);
  });
});

describe("what an agent is given", () => {
  const source = { importId: "import:x", from: "review.tsv", at: "2026-11-26T00:00:00.000Z" };
  const shape = (meta: object, props: object = {}, type = "card") => ({ id: "shape:a", type, props, meta: { source: { ...source, ...meta } } }) as never;
  it("gives a field with its column name and a title with its short fields", () => {
    expect(sourceText(shape({ kind: "field", column: "Gap / exposure", row: 3 }), "Gap / exposure The pack is silent on timing.")).toBe("Gap / exposure: The pack is silent on timing.");
    expect(sourceText(shape({ kind: "title", row: 3, values: { "No.": "3", Q: "Q7", Severity: "Critical", Fix: "x".repeat(80) } }), "No. 3 · Q7")).toBe("No.: 3 · Q: Q7 · Severity: Critical");
    expect(sourceAuthor({ ...source, kind: "field", row: 3 })).toBe("Imported source (review.tsv, row 3)");
  });
  it("gives a table object as tab-separated text", () => {
    expect(sourceText(shape({ kind: "table" }, { title: "Costs", columns: ["Item", "2024"], rows: [["Fuel", "120"]] }, "datatable"), "")).toBe("Costs\nItem\t2024\nFuel\t120");
  });
  it("tells the resident agent the material is imported, not the person's or an agent's", () => {
    const prompt = buildPrompt({ question: "Is this point valid?", targets: [{ id: "shape:a", type: "card", author: "Imported source (review.tsv, row 3)", text: "Gap / exposure: silent on timing" }] });
    expect(prompt).toContain('card written by the imported source material (review.tsv, row 3): """Gap / exposure: silent on timing"""');
  });
  it("offers a record its own first question, and has an import tool", () => {
    expect(startersFor([], true)[0]).toBe("Is this point valid?");
    expect(startersFor([], false)[0]).toBe("What's missing?");
    expect(toolDefs.find((t) => t.name === "canvas_import")?.op).toBe("import");
  });
});
