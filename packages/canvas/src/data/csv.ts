import { createShapeId, type Editor, type TLShapeId } from "tldraw";
import { datasetSchema, type Dataset, type Row } from "./model";
import type { DatasetShape } from "./shapes";
import { clip } from "../text";

// PROTOTYPE: a person drops a CSV file on the canvas to create a dataset object
// (working spec, first acceptance scenario: "Import a non-confidential dataset").
// All or nothing: a file with any problem creates nothing and every problem is reported.

const MAX_ROWS = 5000, MAX_COLUMNS = 50;

export type CsvResult = { ok: true; dataset: Dataset } | { ok: false; errors: string[] };

export const isCsvFile = (file: { name: string; type: string }) => file.type === "text/csv" || /\.csv$/i.test(file.name);

/** RFC 4180 records: quoted fields may hold commas, newlines and doubled quotes. */
function records(text: string): { rows: { cells: string[]; line: number }[]; unclosedAt?: number } {
  // `wasQuoted` tells a row holding one quoted empty value ("") from a blank line.
  const rows: { cells: string[]; line: number; wasQuoted?: boolean }[] = [];
  let cells: string[] = [], cell = "", quoted = false, line = 1, start = 1, quoteLine = 0, wasQuoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else { if (c === "\n") line++; cell += c; }
    } else if (c === '"' && cell === "") { quoted = true; quoteLine = line; wasQuoted = true; }
    else if (c === ",") { cells.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cells.push(cell);
      rows.push({ cells, line: start, wasQuoted });
      cells = []; cell = ""; line++; start = line; wasQuoted = false;
    } else cell += c;
  }
  if (quoted) return { rows, unclosedAt: quoteLine };
  if (cell !== "" || cells.length || wasQuoted) { cells.push(cell); rows.push({ cells, line: start, wasQuoted }); }
  return { rows: rows.filter((r) => r.wasQuoted || !(r.cells.length === 1 && r.cells[0].trim() === "")) };
}

/** Locate a schema problem in the file's terms: rows count from the header as row 1. */
function where(issue: { path: PropertyKey[]; message: string }) {
  const [area, index, column] = issue.path;
  if (area === "rows" && typeof index === "number") return `Row ${index + 2}${column ? `, column ${String(column)}` : ""}: ${issue.message}`;
  if (area === "columns" && typeof index === "number") return `Column ${index + 1}: ${issue.message}`;
  return issue.message;
}

/**
 * A value counts as a number only if it is a plain decimal and a number can hold it exactly
 * enough. Codes stay text: a zero-padded value (`007`, the ZIP `02139`) would lose its zeros,
 * and `Number()` would read `0x1A` or `0b11` as numbers. The size must be within the
 * safe-integer range (in any spelling, including 1e18), an integer must be a safe integer
 * (long IDs beyond 2^53 would round and merge), and a decimal at most 15 significant digits.
 * Anything else stays text, as the file wrote it. The plain-decimal check runs first and has
 * no overlapping quantifiers, so a long malformed cell is rejected at once.
 */
const numeric = (v: string) => {
  const t = v.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(t) || /^[+-]?0\d/.test(t)) return false;
  if (!Number.isFinite(Number(t))) return false;
  // Beyond 2^53 a number no longer holds every integer, however the value is spelled (1e18 too).
  if (Math.abs(Number(t)) > Number.MAX_SAFE_INTEGER) return false;
  if (/^[-+]?\d+$/.test(t)) return Number.isSafeInteger(Number(t));
  const mantissa = /^[-+]?(\d*)\.?(\d*)(?:e[-+]?\d+)?$/i.exec(t);
  return !!mantissa && (mantissa[1] + mantissa[2]).replace(/^0+/, "").length <= 15;
};

/** Line (from 1) of the first byte that is not valid UTF-8, or 0 when all of it is. */
function firstBadLine(bytes: Uint8Array) {
  let line = 1;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x0a) line++;
    if (b < 0x80) continue;
    const extra = b >= 0xf0 && b <= 0xf4 ? 3 : b >= 0xe0 ? 2 : b >= 0xc2 && b < 0xe0 ? 1 : -1;
    if (extra < 0 || i + extra >= bytes.length) return line;
    for (let k = 1; k <= extra; k++) if ((bytes[i + k] & 0xc0) !== 0x80) return line;
    i += extra;
  }
  return 0;
}

/** The file's text, read strictly as UTF-8: a file in another encoding is refused with a fix, not mangled. */
export function decodeCsv(bytes: Uint8Array): { ok: true; text: string } | { ok: false; errors: string[] } {
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes) };
  } catch {
    const line = firstBadLine(bytes);
    return { ok: false, errors: [`It is not UTF-8 text (an accented letter or symbol${line ? ` near line ${line}` : ""} cannot be read). Save it again as “CSV UTF-8” and drop it again.`] };
  }
}

export function parseCsv(text: string, fileName: string): CsvResult {
  const parsed = records(text.replace(/^﻿/, ""));
  if (parsed.unclosedAt) return { ok: false, errors: [`A quoted value starting on row ${parsed.unclosedAt} is never closed.`] };
  const [header, ...body] = parsed.rows;
  if (!header) return { ok: false, errors: ["The file is empty."] };
  const names = header.cells.map((n) => n.trim());
  const errors: string[] = [];
  if (names.length > MAX_COLUMNS) errors.push(`The file has ${names.length} columns; the limit is ${MAX_COLUMNS}.`);
  names.forEach((n, i) => {
    if (!n) errors.push(`Column ${i + 1} has no name.`);
    else if (names.indexOf(n) !== i) errors.push(`Column name "${n}" is used twice.`);
  });
  if (!body.length) errors.push("The file has a header row but no data rows.");
  if (body.length > MAX_ROWS) errors.push(`The file has ${body.length} data rows; the limit is ${MAX_ROWS}.`);
  for (const [i, r] of body.entries())
    if (r.cells.length !== names.length && errors.length < 20)
      errors.push(`Row ${i + 2} has ${r.cells.length} value${r.cells.length === 1 ? "" : "s"}; the header has ${names.length}.`);
  if (errors.length) return { ok: false, errors };

  const types = names.map((_, c) => (body.every((r) => numeric(r.cells[c])) ? "number" : "text") as "number" | "text");
  const rows: Row[] = body.map((r) => Object.fromEntries(names.map((n, c) => [n, types[c] === "number" ? Number(r.cells[c]) : r.cells[c]])));
  const result = datasetSchema.safeParse({
    title: clip(fileName.replace(/\.csv$/i, ""), 200) || "Dataset",
    source: clip(`Imported from ${fileName}`, 500),
    columns: names.map((name, c) => ({ name, type: types[c] })),
    rows,
    version: 0,
  });
  return result.success ? { ok: true, dataset: result.data } : { ok: false, errors: result.error.issues.slice(0, 20).map(where) };
}

/**
 * Create a dataset object for each CSV file, side by side from `point`, as the person's own
 * work (no createdBy). Returns a one-line message for the person: what was imported, and why
 * any file was not.
 */
export async function importCsvFiles(editor: Editor, files: readonly File[], point: { x: number; y: number }) {
  const results = await Promise.all(
    files.map(async (f) => {
      const decoded = decodeCsv(new Uint8Array(await f.arrayBuffer()));
      return { file: f, result: decoded.ok ? parseCsv(decoded.text, f.name) : ({ ok: false, errors: decoded.errors } as CsvResult) };
    }),
  );
  const created: TLShapeId[] = [];
  const messages: string[] = [];
  editor.markHistoryStoppingPoint("import csv");
  editor.run(() => {
    for (const { file, result } of results) {
      if (!result.ok) {
        const more = result.errors.length > 1 ? ` (and ${result.errors.length - 1} more problem${result.errors.length > 2 ? "s" : ""})` : "";
        messages.push(`${file.name} was not imported: ${result.errors[0]}${more}`);
        continue;
      }
      const id = createShapeId();
      const data = result.dataset;
      editor.createShape<DatasetShape>({
        id,
        type: "dataset",
        x: point.x + created.length * 460,
        y: point.y,
        meta: { name: data.title, revision: 0 },
        props: { w: 420, h: 460, data },
      });
      created.push(id);
      messages.push(`Imported ${data.title}: ${data.rows.length} rows, ${data.columns.length} columns`);
    }
    if (created.length) editor.select(...created);
  });
  return messages.join(". ");
}
