import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseImport, planImport } from "../src/import-parse";
import { readXlsx, rowsToTsv } from "../src/xlsx";

const bytes = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const text = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("readXlsx", () => {
  it("reads the first sheet of a workbook: shared strings, formatted runs, inline strings and numbers", async () => {
    const book = await readXlsx(bytes("review.xlsx"));
    expect(book.sheet).toBe("Review");
    expect(book.rows[0]).toEqual(["Adversarial review: Larkspur Ferries funding pack (draft 3)"]);
    expect(book.rows[2].slice(0, 3)).toEqual(["No.", "Q", "Topic"]);
    expect(book.rows[3][0]).toBe("1");
    expect(book.rows[4][2]).toBe("Fleet cost inconsistency");
    expect(book.rows[4][3]).toContain("“Q56 says two vessels cost 9.2m");
    expect(book.rows.flat()).not.toContain("not this sheet");
  });

  it("brings in the same records as the review pasted from a spreadsheet", async () => {
    const book = await readXlsx(bytes("review.xlsx"));
    const fromWorkbook = planImport(parseImport(rowsToTsv(book.rows), "tsv"));
    const fromPaste = planImport(parseImport(text("review.tsv"), "tsv"));
    expect(fromWorkbook).toEqual(fromPaste);
    expect(fromWorkbook.kind).toBe("records");
  });

  it("says plainly when a file is not a workbook it can read", async () => {
    await expect(readXlsx(new TextEncoder().encode("id,name\n1,a\n"))).rejects.toThrow("not an Excel workbook");
    await expect(readXlsx(new Uint8Array(0))).rejects.toThrow("not an Excel workbook");
  });
});

describe("rowsToTsv", () => {
  it("quotes cells with tabs, quotes or line breaks, as a spreadsheet does", () => {
    expect(rowsToTsv([["a", 'say "hi"'], ["two\nlines", "x\ty"], []])).toBe('a\t"say ""hi"""\n"two\nlines"\t"x\ty"\n');
  });
});

describe("readXlsx on damaged files", () => {
  it("a truncated or corrupted workbook fails with the plain message, never a crash", async () => {
    const { ImportError } = await import("../src/import-parse");
    const good = bytes("review.xlsx");
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const damaged: Uint8Array[] = [];
    for (const cut of [10, 100, 1000, good.length - 30, good.length - 1]) damaged.push(good.slice(0, cut));
    for (let n = 0; n < 40; n++) {
      const copy = good.slice();
      for (let k = 0; k < 8; k++) copy[Math.floor(random() * copy.length)] = Math.floor(random() * 256);
      damaged.push(copy);
    }
    for (const file of damaged) {
      try {
        const book = await readXlsx(file);
        expect(Array.isArray(book.rows)).toBe(true);
      } catch (error) {
        expect(error, String(error)).toBeInstanceOf(ImportError);
      }
    }
  });
});
