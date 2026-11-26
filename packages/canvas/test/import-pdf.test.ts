import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ImportError, parseImport, planImport } from "../src/import-parse";
import { readPdf } from "../src/import-pdf";

const bytes = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe("readPdf on a PDF printed by Chromium", () => {
  it("reads the headings and paragraphs, in order, across pages", async () => {
    const plan = planImport(parseImport(await readPdf(bytes("notes.pdf")), "markdown"));
    if (plan.kind !== "prose") throw new Error(plan.kind);
    expect(plan.title).toBe("Larkspur Ferries: route review notes");
    expect(plan.sections.map((s) => s.heading)).toEqual(["What the route is for", "What worries the assessors", "What to do next", "What to do next (continued)", "Second page heading"]);
    expect(plan.sections[0].text).toContain("The harbour crossing saves a forty minute drive around the estuary. Most weekday passengers");
    expect(plan.sections[0].text).toContain("\n\nThe operator wants a second vessel");
    expect(plan.sections[1].text).toBe("• The winter passenger numbers rest on one summer survey.\n• Three answers in the pack give three different fleet costs.\n• The terminal lease ends before the loan does.");
    expect(plan.sections[1].text).toContain("The terminal lease ends before the loan does.");
    expect(plan.sections[4].text).toBe("This section starts after the page break and must come last.");
  });
});

describe("readPdf refusals", () => {
  it("says plainly when a file is not a PDF it can read", async () => {
    await expect(readPdf(new TextEncoder().encode("id,name\n1,a\n"))).rejects.toThrow("not a PDF that can be read");
  });
  it("says when a PDF is protected", async () => {
    const locked = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R /Encrypt 2 0 R >>\n%%EOF");
    await expect(readPdf(locked)).rejects.toThrow("protected");
  });
  it("a truncated or corrupted PDF fails with the plain message, never a crash", async () => {
    const good = bytes("notes.pdf");
    let seed = 11;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const damaged: Uint8Array[] = [10, 500, 5000, good.length - 100].map((cut) => good.slice(0, cut));
    for (let n = 0; n < 30; n++) {
      const copy = good.slice();
      for (let k = 0; k < 12; k++) copy[Math.floor(random() * copy.length)] = Math.floor(random() * 256);
      damaged.push(copy);
    }
    for (const file of damaged) {
      try {
        expect(typeof (await readPdf(file))).toBe("string");
      } catch (error) {
        expect(error, String(error)).toBeInstanceOf(ImportError);
      }
    }
  });
});

describe("readPdf on a damaged page tree", () => {
  it("refuses quickly when page-tree nodes list each other, instead of walking them for ever", async () => {
    // Two Pages nodes that each list both, and no page: without a visited set this is 2^50 visits.
    const pdf =
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
      "2 0 obj\n<< /Type /Pages /Kids [2 0 R 3 0 R] >>\nendobj\n" +
      "3 0 obj\n<< /Type /Pages /Kids [2 0 R 3 0 R] >>\nendobj\n" +
      "trailer\n<< /Root 1 0 R >>\n%%EOF\n";
    const started = Date.now();
    await expect(readPdf(new TextEncoder().encode(pdf))).rejects.toBeInstanceOf(ImportError);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("readPdf on a plain hand-written PDF", () => {
  // Standard fonts with no ToUnicode map, literal strings with escapes, word spaces made by TJ
  // kerning, lines advanced with T*, and a heading set in bold at body size.
  const content = [
    "BT /F2 11 Tf 14 TL 72 760 Td (Fleet costs) Tj ET",
    "BT /F1 11 Tf 14 TL 72 740 Td (The quote is 9.2m \\(two vessels\\) and) Tj T* [(the budget)-250(says)-250(8.1m.)] TJ ET",
    "BT /F1 11 Tf 14 TL 72 700 Td (A second paragraph follows a wider gap.) Tj ET",
  ].join("\n");
  const pdf = [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj",
    `6 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`,
    "trailer << /Root 1 0 R >>",
    "%%EOF",
  ].join("\n");
  it("reads a bold heading, escaped parentheses, kerned word spaces and paragraphs", async () => {
    const markdown = await readPdf(new TextEncoder().encode(pdf));
    const plan = planImport(parseImport(markdown, "markdown"));
    if (plan.kind !== "prose") throw new Error(plan.kind);
    expect(plan.sections).toEqual([
      { heading: "Fleet costs", text: "The quote is 9.2m (two vessels) and the budget says 8.1m.\n\nA second paragraph follows a wider gap." },
    ]);
  });
});
