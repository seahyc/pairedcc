import { describe, expect, it } from "vitest";
import { isCsvFile, parseCsv } from "../src/data/csv";
import { datasetSchema } from "../src/data/model";

const ok = (text: string, name = "readings.csv") => {
  const r = parseCsv(text, name);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.dataset;
};
const errors = (text: string) => {
  const r = parseCsv(text, "bad.csv");
  if (r.ok) throw new Error("expected errors");
  return r.errors;
};

describe("CSV import", () => {
  it("types columns: number when every value is numeric, text otherwise", () => {
    const d = ok("site,month,kwh\nNorth,Jan,100\nSouth,Feb,140.5\n");
    expect(d.columns).toEqual([
      { name: "site", type: "text" },
      { name: "month", type: "text" },
      { name: "kwh", type: "number" },
    ]);
    expect(d.rows).toEqual([
      { site: "North", month: "Jan", kwh: 100 },
      { site: "South", month: "Feb", kwh: 140.5 },
    ]);
    expect(d.title).toBe("readings");
    expect(d.source).toBe("Imported from readings.csv");
    expect(d.version).toBe(0);
    expect(datasetSchema.parse(d)).toEqual(d);
  });

  it("handles quotes, escaped quotes, commas and newlines in fields, CRLF and a BOM", () => {
    const d = ok('﻿name,note\r\n"Smith, J","said ""hi""\nthen left"\r\nLee,plain\r\n');
    expect(d.rows).toEqual([
      { name: "Smith, J", note: 'said "hi"\nthen left' },
      { name: "Lee", note: "plain" },
    ]);
  });

  it("keeps a column as text if any value is empty or not a number", () => {
    const d = ok("id,code,score\n1,007,3\n2,,4\n3,x9,-2e3\n");
    expect(d.columns.map((c) => c.type)).toEqual(["number", "text", "number"]);
    expect(d.rows[1]).toEqual({ id: 2, code: "", score: 4 });
    expect(d.rows[2].score).toBe(-2000);
  });

  it("trims header names and ignores blank lines", () => {
    expect(ok(" a , b \n\n1,2\n\n").columns.map((c) => c.name)).toEqual(["a", "b"]);
  });

  it("reports problems by row and column instead of importing part of the file", () => {
    expect(errors("")).toEqual(["The file is empty."]);
    expect(errors("a,b\n")).toEqual(["The file has a header row but no data rows."]);
    expect(errors("a,,a\n1,2,3\n")).toEqual(["Column 2 has no name.", 'Column name "a" is used twice.']);
    expect(errors("a,b\n1,2\n3\n4,5,6\n")).toEqual(["Row 3 has 1 value; the header has 2.", "Row 4 has 3 values; the header has 2."]);
    expect(errors('a,b\n"unclosed,2\n')).toEqual(["A quoted value starting on row 2 is never closed."]);
  });

  it("locates values the dataset rejects", () => {
    const [e] = errors(`a,b\n1,${"x".repeat(501)}\n`);
    expect(e).toMatch(/^Row 2, column b: /);
  });

  it("refuses files beyond the dataset limits", () => {
    expect(errors(`a\n${"1\n".repeat(5001)}`)).toEqual(["The file has 5001 data rows; the limit is 5000."]);
    const wide = Array.from({ length: 51 }, (_, i) => `c${i}`).join(",");
    expect(errors(`${wide}\n${wide}\n`)[0]).toBe("The file has 51 columns; the limit is 50.");
  });

  it("recognises CSV files by type or extension", () => {
    expect(isCsvFile({ name: "x.csv", type: "" })).toBe(true);
    expect(isCsvFile({ name: "X.CSV", type: "application/octet-stream" })).toBe(true);
    expect(isCsvFile({ name: "data", type: "text/csv" })).toBe(true);
    expect(isCsvFile({ name: "photo.png", type: "image/png" })).toBe(false);
  });

  it("keeps codes with leading zeros, and hex or binary looking values, as text", () => {
    const r = parseCsv("store,zip,code,hex,amount\nA,02139,007,0x1A,12\nB,10001,042,0b11,0.5\nC,94105,100,0x2B,-3\n", "codes.csv");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const type = (n: string) => r.dataset.columns.find((c) => c.name === n)?.type;
    expect([type("zip"), type("code"), type("hex"), type("amount")]).toEqual(["text", "text", "text", "number"]);
    expect(r.dataset.rows[0]).toMatchObject({ zip: "02139", code: "007", hex: "0x1A", amount: 12 });
  });
  it("still reads plain numbers as numbers: zero, decimals, signs and exponents", () => {
    const r = parseCsv("v\n0\n0.5\n-3\n1e3\n.25\n+7\n", "nums.csv");
    expect(r.ok && r.dataset.columns[0].type).toBe("number");
    expect(r.ok && r.dataset.rows.map((x) => x.v)).toEqual([0, 0.5, -3, 1000, 0.25, 7]);
  });
});

