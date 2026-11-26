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
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [], cell = "", quoted = false, line = 1, start = 1, quoteLine = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else { if (c === "\n") line++; cell += c; }
    } else if (c === '"' && cell === "") { quoted = true; quoteLine = line; }
    else if (c === ",") { cells.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cells.push(cell);
      rows.push({ cells, line: start });
      cells = []; cell = ""; line++; start = line;
    } else cell += c;
  }
  if (quoted) return { rows, unclosedAt: quoteLine };
  if (cell !== "" || cells.length) { cells.push(cell); rows.push({ cells, line: start }); }
  return { rows: rows.filter((r) => !(r.cells.length === 1 && r.cells[0].trim() === "")) };
}

/** Locate a schema problem in the file's terms: rows count from the header as row 1. */
function where(issue: { path: PropertyKey[]; message: string }) {
  const [area, index, column] = issue.path;
  if (area === "rows" && typeof index === "number") return `Row ${index + 2}${column ? `, column ${String(column)}` : ""}: ${issue.message}`;
  if (area === "columns" && typeof index === "number") return `Column ${index + 1}: ${issue.message}`;
  return issue.message;
}

const numeric = (v: string) => v.trim() !== "" && Number.isFinite(Number(v));

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
  const results = await Promise.all(files.map(async (f) => ({ file: f, result: parseCsv(await f.text(), f.name) })));
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
