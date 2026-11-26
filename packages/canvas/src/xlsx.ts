import { ImportError } from "./import-parse";

// Reading an Excel workbook (.xlsx) without a library: it is a zip of XML parts. Only what an
// import needs is read: the first sheet's cell values as text, through the shared string table.
// Formulas give their last computed value; dates stay Excel's serial numbers; styles are ignored.
// The rows then go through the same importer as a pasted spreadsheet range.

const NOT_A_WORKBOOK = "This is not an Excel workbook that can be read. Save it as .xlsx or CSV, or copy the cells and paste them here.";
/** Larger than any sheet worth laying out as cards; also stops a zip that inflates without end. */
const MAX_PART = 30_000_000;
const MAX_ROWS = 1_048_576, MAX_COLUMNS = 16_384;

type Entry = { name: string; method: number; size: number; packed: number; offset: number };

function entries(bytes: Uint8Array): Map<string, Entry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new ImportError(NOT_A_WORKBOOK);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const found = new Map<string, Entry>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new ImportError(NOT_A_WORKBOOK);
    const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    found.set(name, {
      name,
      method: view.getUint16(at + 10, true),
      packed: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extra + comment;
  }
  return found;
}

async function readPart(bytes: Uint8Array, entry: Entry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.size > MAX_PART || entry.offset + 30 > bytes.length || view.getUint32(entry.offset, true) !== 0x04034b50) throw new ImportError(NOT_A_WORKBOOK);
  const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
  const data = bytes.subarray(start, start + entry.packed);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new ImportError(NOT_A_WORKBOOK);
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_PART) {
      await reader.cancel();
      throw new ImportError(NOT_A_WORKBOOK);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return new TextDecoder().decode(out);
}

const decode = (s: string) =>
  s
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()],
    )
    // Excel escapes some control characters as _xHHHH_.
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]));
/** The text of every <t> in a string item or inline string, phonetic guides left out. */
const runText = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");
const column = (ref: string | undefined) => {
  const letters = /^([A-Z]+)/.exec(ref ?? "")?.[1];
  return letters ? [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1 : undefined;
};

/** The first sheet of an .xlsx file as rows of text. Throws an ImportError a person can act on. */
export async function readXlsx(bytes: Uint8Array): Promise<{ sheet: string; sheets: number; rows: string[][] }> {
  try {
    return await readWorkbook(bytes);
  } catch (error) {
    // Damaged data (a bad deflate stream, an offset past the end) reads as "cannot be read".
    throw error instanceof ImportError ? error : new ImportError(NOT_A_WORKBOOK);
  }
}

async function readWorkbook(bytes: Uint8Array): Promise<{ sheet: string; sheets: number; rows: string[][] }> {
  if (bytes.length < 22) throw new ImportError(NOT_A_WORKBOOK);
  const parts = entries(bytes);
  const part = (name: string) => {
    const entry = parts.get(name);
    return entry ? readPart(bytes, entry) : Promise.resolve(undefined);
  };
  const workbook = await part("xl/workbook.xml");
  if (!workbook) throw new ImportError(NOT_A_WORKBOOK);
  const first = /<sheet\b[^>]*>/.exec(workbook);
  if (!first) throw new ImportError("This workbook has no sheets.");
  const sheetAttrs = attrs(first[0]);
  const rels = (await part("xl/_rels/workbook.xml.rels")) ?? "";
  const relations = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => attrs(m[0]));
  const target = relations.find((r) => r.Id === sheetAttrs["r:id"])?.Target ?? "worksheets/sheet1.xml";
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const sheet = await part(sheetPath);
  if (!sheet) throw new ImportError(NOT_A_WORKBOOK);
  const sharedTarget = relations.find((r) => r.Type?.endsWith("/sharedStrings"))?.Target;
  const sharedXml = (await part(sharedTarget ? (sharedTarget.startsWith("/") ? sharedTarget.slice(1) : `xl/${sharedTarget}`) : "xl/sharedStrings.xml")) ?? "";
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => runText(m[1]));

  const rows: string[][] = [];
  let nextRow = 0;
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowIndex = Number(attrs(rowMatch[1]).r ?? nextRow + 1) - 1;
    // Excel's own limits; a damaged reference must not make a billion empty rows.
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= MAX_ROWS) throw new ImportError(NOT_A_WORKBOOK);
    nextRow = rowIndex + 1;
    const cells: string[] = [];
    let nextCol = 0;
    for (const cell of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(cell[1]), body = cell[2] ?? "";
      const col = column(a.r) ?? nextCol;
      if (col >= MAX_COLUMNS) throw new ImportError(NOT_A_WORKBOOK);
      nextCol = col + 1;
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (a.t === "s") value = shared[Number(raw)] ?? "";
      else if (a.t === "inlineStr") value = runText(body);
      else if (a.t === "b") value = raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : "";
      else if (raw !== undefined) value = decode(raw);
      while (cells.length < col) cells.push("");
      cells[col] = value;
    }
    while (cells.length && !cells[cells.length - 1].trim()) cells.pop();
    rows[rowIndex] = cells;
  }
  for (let i = 0; i < rows.length; i++) rows[i] ??= [];
  return { sheet: sheetAttrs.name ?? "Sheet1", sheets: [...workbook.matchAll(/<sheet\b/g)].length, rows };
}

/** Rows as tab-separated text, quoted the way a spreadsheet copies them. Trailing empty rows are dropped. */
export function rowsToTsv(rows: readonly string[][]): string {
  const kept = [...rows];
  while (kept.length && !kept[kept.length - 1].some((c) => c.trim())) kept.pop();
  return kept.map((r) => r.map((v) => (/[\t\n\r"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join("\t")).join("\n") + (kept.length ? "\n" : "");
}
