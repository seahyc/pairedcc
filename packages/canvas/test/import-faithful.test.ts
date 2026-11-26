import { describe, expect, it } from "vitest";
import { MAX_TABLE_ROWS, parseImport, planImport, sniffDelimiter, summarise } from "../src/import-parse";
import { isDerivedField } from "../src/revision";

// Item 62: the import keeps what the source said (review of #46).
describe("delimiter guess reads quotes", () => {
  it("(a) quoted notes full of semicolons do not make a comma file semicolon-separated", () => {
    const csv = 'id,notes\n1,"Ready; reviewed; approved"\n2,"Packed; labeled; shipped"\n';
    expect(sniffDelimiter(csv)).toBe(",");
    const plan = planImport(parseImport(csv, "csv"), "table");
    expect(plan.kind === "table" && plan.table.columns).toEqual(["id", "notes"]);
  });
  it("(a) nor do quoted tabs or many semicolons in one note", () => {
    expect(sniffDelimiter('id,notes,owner\n1,"Call; check; revise; approve; send; file; close",Mina\n')).toBe(",");
    expect(sniffDelimiter('id,notes\n1,"a\tb\tc"\n2,"d\te"\n')).toBe(",");
  });
  it("(a) still finds real semicolon and tab files, title rows included", () => {
    expect(sniffDelimiter("name;amount\nTea;3,50\nCake;4,00\n")).toBe(";");
    expect(sniffDelimiter("Title\nNote\nA\tB\tC\n1\t2\t3\n")).toBe("\t");
  });
});

describe("a large table says what it kept", () => {
  it("(c) keeps the first rows and says how many of how many", () => {
    const rows = Array.from({ length: MAX_TABLE_ROWS + 500 }, (_, i) => `${i},${i * 2}`);
    const plan = planImport(parseImport(`a,b\n${rows.join("\n")}\n`, "csv"), "table");
    expect(summarise(plan, "big.csv")).toBe(`2,000 of 2,500 rows from big.csv, as a table (the first 2,000 are kept)`);
  });
});

describe("a table's measured height is derived", () => {
  it("does not count as someone's edit", () => {
    expect(isDerivedField("datatable", "props.h")).toBe(true);
    expect(isDerivedField("datatable", "props.rows")).toBe(false);
  });
});
