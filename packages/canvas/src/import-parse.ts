// Reading imported material and deciding what it is. No editor and no DOM here, so every
// rule can be tested directly: the parsers, the shape detection and the import plan.

import { htmlToMarkdown } from "./import-html";

export type Table = { title?: string; note?: string; columns: string[]; rows: string[][] };
export type Section = { heading?: string; text: string };
export type Parsed = { kind: "table"; table: Table } | { kind: "prose"; title?: string; sections: Section[] };
export type ImportFormat = "tsv" | "csv" | "html" | "markdown" | "json" | "text";
export type ColumnRole = "title" | "tag" | "field" | "verdict";

export class ImportError extends Error {}

/** A table object keeps at most this many rows; an import says when it kept fewer than the source had. */
export const MAX_TABLE_ROWS = 2000;

// ---------- delimited text ----------

/** RFC 4180 style parsing: quoted fields, doubled quotes and line breaks inside quotes. */
export function parseDelimited(text: string, delimiter: "\t" | "," | ";"): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, i = 0;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endCell();
      rows.push(row);
      row = [];
    } else cell += ch;
    i++;
  }
  if (cell !== "" || row.length) {
    endCell();
    rows.push(row);
  }
  return rows;
}

/** Which delimiter a text uses: the one that splits its first lines most evenly. */
export function sniffDelimiter(text: string): "\t" | "," | ";" {
  // Each candidate is tried with quotes respected (punctuation inside a quoted note is content,
  // not a separator). The one that splits the most rows into the same number of cells (two or
  // more) wins; a single-cell title row above the table does not count against it.
  const head = text.slice(0, 20_000);
  const score = (d: "\t" | "," | ";") => {
    // Blank lines (some exports lead with many) carry no evidence, so they are dropped first.
    const rows = parseDelimited(head, d).filter((r) => r.some((c) => c.trim())).slice(0, 30);
    const counts = rows.map((r) => r.length).filter((n) => n > 1);
    if (!counts.length) return 0;
    const tally = new Map<number, number>();
    for (const n of counts) tally.set(n, (tally.get(n) ?? 0) + 1);
    const [width, agree] = [...tally.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    // A quote left inside a cell means this delimiter cut through a quoted field.
    const stray = rows.filter((r) => r.some((c) => c.includes('"'))).length;
    return (Math.max(0, agree - stray) / rows.length) * 1000 + Math.min(width, 50);
  };
  const scores = (["\t", ",", ";"] as const).map((d) => [d, score(d)] as const);
  const best = scores.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ",";
}

// ---------- HTML tables (what a spreadsheet puts on the clipboard) ----------

const entities: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", mdash: "—", ndash: "–", hellip: "…", middot: "·", copy: "©", reg: "®", trade: "™", bull: "•", times: "×", euro: "€", pound: "£",
};
export function decodeEntities(text: string) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return entities[code.toLowerCase()] ?? whole;
  });
}

function cellText(html: string) {
  return decodeEntities(
    html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** True when the first row of the first table is all header cells (<th>). */
export function htmlTableHasHeader(html: string): boolean {
  const table = /<table[\s\S]*?<\/table>/i.exec(html)?.[0];
  const first = table && /<tr[^>]*>([\s\S]*?)<\/tr>/i.exec(table)?.[1];
  return Boolean(first && /<th\b/i.test(first) && !/<td\b/i.test(first));
}

/** The first table in an HTML fragment as rows of cell text, or null when there is none. */
export function parseHtmlTable(html: string): string[][] | null {
  const table = /<table[\s\S]*?<\/table>/i.exec(html)?.[0];
  if (!table) return null;
  const rows: string[][] = [];
  for (const tr of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = [];
    for (const td of tr[1].matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      cells.push(cellText(td[2]));
      const span = Number(/colspan\s*=\s*["']?(\d+)/i.exec(td[1])?.[1] ?? 1);
      for (let i = 1; i < Math.min(span, 50); i++) cells.push("");
    }
    if (cells.length) rows.push(cells);
  }
  return rows.length ? rows : null;
}

// ---------- rows to a table ----------

const filled = (row: string[]) => row.filter((c) => c.trim()).length;
const numberLike = /^[-+(]?[$€£¥]?\s?\d[\d,.\s]*\s?(%|[kKmMbB]|bn|x)?\)?$/;
export const isNumeric = (value: string) => numberLike.test(value.trim());

/**
 * Title lines above the header (a spreadsheet tab often starts with a title and a note),
 * then the header row, then the data. Empty rows and wholly empty columns are dropped.
 */
/** `explicitHeader`: the source marked its first row as the header (an HTML <th> row, a markdown rule). */
export function toTable(raw: string[][], explicitHeader = false): Table {
  const rows = raw.map((r) => r.map((c) => c.replace(/\r/g, "").trim())).filter((r) => filled(r) > 0);
  if (!rows.length) throw new ImportError("There is nothing in that table");
  const widest = Math.max(...rows.map(filled));
  // A header the source marked is the first row, however sparse; otherwise rows above the first
  // well-filled row are a title and notes.
  const headerAt = explicitHeader ? 0 : Math.max(0, rows.findIndex((r) => filled(r) >= Math.max(2, Math.ceil(widest / 2))));
  const preamble = rows.slice(0, headerAt).map((r) => r.filter((c) => c).join(" "));
  const body = rows.slice(headerAt);
  const width = Math.max(...body.map((r) => r.length));
  const square = body.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  const keep = Array.from({ length: width }, (_, i) => square.some((r) => r[i]));
  const trimmed = square.map((r) => r.filter((_, i) => keep[i]));
  // A first row made only of numbers is data, not a header.
  const hasHeader = trimmed.length > 1 && ((explicitHeader && headerAt === 0) || !trimmed[0].every((c) => !c || isNumeric(c)));
  const columns = hasHeader ? trimmed[0].map((c, i) => c.replace(/\s+/g, " ") || `Column ${i + 1}`) : trimmed[0].map((_, i) => `Column ${i + 1}`);
  return {
    ...(preamble[0] ? { title: preamble[0] } : {}),
    ...(preamble.length > 1 ? { note: preamble.slice(1).join(" ") } : {}),
    columns,
    rows: hasHeader ? trimmed.slice(1) : trimmed,
  };
}

// ---------- markdown and plain prose ----------

const plainInline = (text: string) =>
  text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1");

const pipeRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const pipeRule = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes("-");

/** A markdown pipe table as rows, when the text is mostly one table. */
export function parseMarkdownTable(text: string): { rows: string[][]; title?: string } | null {
  // The table is the line above the first rule row (--- | ---) and the lines with pipes straight
  // after it; a heading or a note elsewhere is never a row, even if it holds a pipe. Outer pipes
  // are optional in markdown.
  const all = text.split(/\r?\n/);
  const ruleAt = all.findIndex((l) => pipeRule(l) && l.includes("|"));
  if (ruleAt < 1 || !/(?<!\\)\|/.test(all[ruleAt - 1]) || /^\s*#/.test(all[ruleAt - 1])) return null;
  const body: string[] = [];
  for (let i = ruleAt + 1; i < all.length && all[i].trim() && /(?<!\\)\|/.test(all[i]); i++) body.push(all[i]);
  const tableLines = [all[ruleAt - 1], ...body];
  const lines = all.filter((l) => l.trim());
  if (tableLines.length < 2 || tableLines.length + 1 < lines.length * 0.6) return null;
  const heading = lines.find((l) => /^#{1,6}\s+/.test(l));
  const rows = tableLines.map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => plainInline(c.replace(/\\\|/g, "|").trim())));
  return { rows, ...(heading ? { title: plainInline(heading.replace(/^#+\s+/, "")) } : {}) };
}

/** Marks a paragraph that is fenced code inside parseProse; never reaches a card. */
const CODE = "\u0000code\u0000";

/** Longest stretch of prose that still reads as one card. */
const SECTION_MAX = 900;

/**
 * Markdown or plain prose as sections in reading order: one per heading, or one per
 * paragraph when there are no headings. A long section is split at paragraph breaks.
 */
export function parseProse(text: string): { title?: string; sections: Section[] } {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  type Draft = { heading?: string; level: number; paragraphs: string[] };
  const drafts: Draft[] = [];
  let current: Draft = { level: 0, paragraphs: [] }, para: string[] = [], fenced = false;
  const endPara = () => {
    const joined = para.join("\n").trim();
    if (joined) current.paragraphs.push(joined);
    para = [];
  };
  const endSection = () => {
    endPara();
    if (current.heading || current.paragraphs.length) drafts.push(current);
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      if (fenced) endPara();
      else {
        // Code keeps its own lines: marked so the paragraph pass below does not re-wrap it.
        const code = para.join("\n").replace(/^\n+|\s+$/g, "");
        if (code.trim()) current.paragraphs.push(CODE + code);
        para = [];
      }
      continue;
    }
    if (fenced) {
      para.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      endSection();
      current = { heading: plainInline(heading[2]), level: heading[1].length, paragraphs: [] };
    } else if (!line.trim()) endPara();
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) endPara();
    else {
      const item = /^\s*([-*+]|\d+[.)])\s+/.test(line);
      // A list stays together; its items keep their own lines.
      if (!item && para.length && /^\s*([-*+]|\d+[.)])\s+/.test(para[para.length - 1]) && !/^\s+/.test(line)) endPara();
      para.push(plainInline(line.replace(/^\s*[-*+]\s+/, "• ").replace(/^\s*>\s?/, "")));
    }
  }
  endSection();
  // A lone top heading with nothing under it is the document's title.
  let title: string | undefined;
  if (drafts.length > 1 && drafts[0].heading && drafts[0].level === 1 && !drafts[0].paragraphs.length) title = drafts.shift()!.heading;
  const headed = drafts.some((d) => d.heading);
  const sections: Section[] = [];
  for (const d of drafts) {
    const unwrap = (p: string) => (p.startsWith(CODE) ? p.slice(CODE.length) : /^(• |\d+[.)] )/m.test(p) || p.includes("  ") ? p : p.replace(/\n/g, " "));
    const paragraphs = d.paragraphs.map(unwrap);
    if (!headed) {
      for (const p of paragraphs) sections.push({ text: p });
      continue;
    }
    if (!paragraphs.length) {
      sections.push({ heading: d.heading, text: "" });
      continue;
    }
    let chunk: string[] = [], first = true;
    const flush = () => {
      if (!chunk.length) return;
      sections.push({ ...(d.heading ? { heading: first ? d.heading : `${d.heading} (continued)` } : {}), text: chunk.join("\n\n") });
      first = false;
      chunk = [];
    };
    for (const p of paragraphs) {
      if (chunk.length && chunk.join("\n\n").length + p.length > SECTION_MAX) flush();
      chunk.push(p);
    }
    flush();
  }
  return { ...(title ? { title } : {}), sections };
}

// ---------- JSON ----------

function jsonCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An array of objects (or an object holding one) as a table: keys are the columns. */
export function parseJson(text: string): Table {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ImportError("That JSON could not be read");
  }
  let title: string | undefined;
  if (isRecord(value)) {
    if ("tldrawFileFormatVersion" in value) throw new ImportError("That is a saved board. Use Menu → Open board file.");
    const lists = Object.entries(value).filter(([, v]) => Array.isArray(v) && v.length > 0 && v.every(isRecord));
    if (lists.length !== 1) throw new ImportError("JSON import needs a list of objects");
    [title, value] = lists[0];
  }
  if (!Array.isArray(value) || !value.length || !value.every(isRecord)) throw new ImportError("JSON import needs a list of objects");
  const columns: string[] = [];
  for (const item of value as Record<string, unknown>[]) for (const key of Object.keys(item)) if (!columns.includes(key)) columns.push(key);
  return { ...(title ? { title } : {}), columns, rows: (value as Record<string, unknown>[]).map((item) => columns.map((c) => jsonCell(item[c]).trim())) };
}

// ---------- one entry point ----------

export function formatOfFile(name: string): ImportFormat | "image" | "xlsx" | "pdf" | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (!ext) return null;
  if (ext === "csv") return "csv";
  if (ext === "tsv" || ext === "tab") return "tsv";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "txt" || ext === "text") return "text";
  if (ext === "json") return "json";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "xlsx" || ext === "xls" || ext === "numbers" || ext === "ods") return "xlsx";
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].includes(ext)) return "image";
  return null;
}

/** Text in a table shape even though it arrived as plain text: every row has the same few columns. */
function looksDelimited(text: string, delimiter: "\t" | ","): boolean {
  if (!text.includes(delimiter)) return false;
  const rows = parseDelimited(text, delimiter).filter((r) => filled(r) > 0);
  const min = delimiter === "\t" ? 2 : 3;
  if (rows.length < min) return false;
  const widths = rows.map((r) => r.length), width = Math.max(...widths);
  if (width < min) return false;
  // Commas are ordinary in prose, so comma text must be strictly rectangular.
  const regular = widths.filter((w) => w === width).length;
  return delimiter === "\t" ? regular >= rows.length * 0.6 : regular === rows.length;
}

export function parseImport(content: string, format: ImportFormat): Parsed {
  if (!content.trim()) throw new ImportError("There is nothing to import");
  if (format === "json") return { kind: "table", table: parseJson(content) };
  if (format === "html") {
    const rows = parseHtmlTable(content);
    if (rows) return { kind: "table", table: toTable(rows, htmlTableHasHeader(content)) };
    const markdown = htmlToMarkdown(content), doc = parseProse(markdown);
    // A page's one top heading is its title, even with a lead paragraph straight under it.
    const top = doc.sections[0];
    if (!doc.title && top?.heading && markdown.startsWith(`# ${top.heading}\n`) && (markdown.match(/^# /gm) ?? []).length === 1)
      return { kind: "prose", title: top.heading, sections: top.text ? [{ text: top.text }, ...doc.sections.slice(1)] : doc.sections.slice(1) };
    return { kind: "prose", ...doc };
  }
  if (format === "tsv") return { kind: "table", table: toTable(parseDelimited(content, "\t")) };
  if (format === "csv") return { kind: "table", table: toTable(parseDelimited(content, sniffDelimiter(content))) };
  const pipes = parseMarkdownTable(content);
  if (pipes) return { kind: "table", table: { ...toTable(pipes.rows, true), ...(pipes.title ? { title: pipes.title } : {}) } };
  if (format === "text" && looksDelimited(content, "\t")) return { kind: "table", table: toTable(parseDelimited(content, "\t")) };
  if (format === "text" && looksDelimited(content, ",")) return { kind: "table", table: toTable(parseDelimited(content, ",")) };
  return { kind: "prose", ...parseProse(content) };
}

/**
 * What a paste on the board should become. Null means "ordinary text": the canvas keeps
 * its usual behaviour (one object). A spreadsheet's HTML table is preferred to its text.
 */
export function detectPaste(data: { html?: string; text?: string }): { format: ImportFormat; content: string } | null {
  const html = data.html ?? "", text = data.text ?? "";
  if (/data-tldraw|<tldraw/i.test(html)) return null;
  if (/<table/i.test(html)) {
    const rows = parseHtmlTable(html)?.filter((r) => filled(r) > 0) ?? [];
    if (rows.length >= 2 && Math.max(...rows.map(filled)) >= 2) return { format: "html", content: html };
  }
  // Copied from a web page: its headings are in the HTML only, so the HTML is read when it has them.
  if (html && !/<table/i.test(html) && /<h[1-6]\b/i.test(html)) {
    const markdown = htmlToMarkdown(html);
    if (markdown.length >= 400 && (markdown.match(/^#{1,6}\s+\S/gm) ?? []).length >= 2) return { format: "html", content: html };
  }
  if (looksDelimited(text, "\t")) return { format: "tsv", content: text };
  if (looksDelimited(text, ",")) return { format: "csv", content: text };
  if (parseMarkdownTable(text)) return { format: "markdown", content: text };
  // Several paragraphs or headings: a document, laid out as cards. One paragraph stays one object.
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim()).length;
  const headings = (text.match(/^#{1,6}\s+\S/gm) ?? []).length;
  if (text.length >= 400 && (paragraphs >= 3 || headings >= 2)) return { format: "markdown", content: text };
  return null;
}

// ---------- shape detection ----------

/** Ordered words for how much something matters, most severe first. */
const severityTiers = [
  ["critical", "blocker", "showstopper", "severe", "urgent", "p0", "sev0", "sev1", "s1"],
  ["high", "major", "p1", "sev2", "s2", "must"],
  ["medium", "moderate", "med", "p2", "sev3", "s3", "should"],
  ["low", "minor", "p3", "sev4", "s4", "could"],
  ["info", "informational", "trivial", "none", "p4", "note"],
];
export const severityLevel = (value: string) => severityTiers.findIndex((tier) => tier.includes(value.trim().toLowerCase()));

export type ColumnStats = { fill: number; avgLen: number; maxLen: number; avgWords: number; numeric: number; distinct: number; count: number };
export function columnStats(table: Table, index: number): ColumnStats {
  const cells = table.rows.map((r) => r[index] ?? "").filter((c) => c);
  const n = cells.length || 1;
  return {
    count: cells.length,
    fill: table.rows.length ? cells.length / table.rows.length : 0,
    avgLen: cells.reduce((s, c) => s + c.length, 0) / n,
    maxLen: Math.max(0, ...cells.map((c) => c.length)),
    avgWords: cells.reduce((s, c) => s + c.split(/\s+/).length, 0) / n,
    numeric: cells.filter(isNumeric).length / n,
    distinct: new Set(cells.map((c) => c.toLowerCase())).size,
  };
}

export type TableShape = {
  /** Records: rows of prose, one argument each. Table: a grid, mostly numbers or short labels. */
  kind: "records" | "table";
  roles: ColumnRole[];
  /** Index of the column that says how much each row matters, when there is one. */
  severity: number | null;
};

/**
 * Rows of prose are records; grids of numbers are tables. Per column: sentence-length text
 * is a field (its own card), a few repeated short values are a tag, a column left empty
 * under a header is the person's verdict column, and the rest identify the row.
 */
export function detectShape(table: Table): TableShape {
  const stats = table.columns.map((_, i) => columnStats(table, i));
  const roles: ColumnRole[] = stats.map((s, index) => {
    if (s.count === 0) return "verdict";
    if (s.numeric < 0.5 && (s.avgLen >= 50 || (s.maxLen >= 90 && s.avgWords >= 6))) return "field";
    const cells = table.rows.map((r) => r[index] ?? "").filter((c) => c);
    if (cells.every((c) => severityLevel(c) >= 0)) return "tag";
    if (s.numeric < 0.5 && s.count >= 4 && s.avgLen <= 24 && s.distinct < s.count && s.distinct <= Math.max(2, Math.min(6, Math.floor(s.count / 2)))) return "tag";
    return "title";
  });
  const tags = roles.flatMap((r, i) => (r === "tag" ? [i] : []));
  const ordinal = tags.filter((i) => table.rows.every((r) => !r[i] || severityLevel(r[i]) >= 0));
  const severity = ordinal.find((i) => /sever|priorit|risk|impact|level|rating|urgen/i.test(table.columns[i])) ?? ordinal[0] ?? null;
  return { kind: roles.includes("field") ? "records" : "table", roles, severity };
}

// ---------- the plan ----------

export type Chip = { label: string; level: number | null };
export type RecordPlan = {
  /** 1-based row in the source, counting data rows only. */
  row: number;
  title: string;
  /** Short fields that did not fit the title line. */
  details: string;
  chips: Chip[];
  level: number | null;
  /** Long text, one card each, in column order. */
  fields: { column: string; text: string }[];
  /** Every non-empty cell by column name, for agents. */
  values: Record<string, string>;
};
export type ImportPlan =
  | { kind: "records"; title?: string; note?: string; records: RecordPlan[]; legend: { column: string; chips: Chip[] } | null; verdictColumns: string[]; sorted: boolean; table: Table }
  | { kind: "table"; table: Table }
  | { kind: "prose"; title?: string; sections: Section[] };

const TITLE_PARTS = 3;

function titleCell(column: string, value: string) {
  // "No. 3" reads better than a bare "3".
  return isNumeric(value) && column.length <= 5 ? `${column} ${value}` : value;
}

/** Turn a table into records, most severe first when a column says how severe each is. */
export function planRecords(table: Table, shape: TableShape): Extract<ImportPlan, { kind: "records" }> {
  let roles = shape.roles;
  if (!roles.includes("field")) {
    // Asked for cards on a table with no prose: the longest text columns become the cards.
    const ranked = table.columns
      .map((_, i) => ({ i, s: columnStats(table, i) }))
      .filter(({ i, s }) => roles[i] === "title" && s.numeric < 0.5)
      .sort((a, b) => b.s.avgLen - a.s.avgLen);
    const pick = new Set(ranked.slice(0, Math.max(1, Math.min(4, ranked.length - 1))).map((r) => r.i));
    roles = roles.map((r, i) => (pick.has(i) ? "field" : r));
  }
  const records: RecordPlan[] = table.rows.map((cells, index) => {
    const at = (role: ColumnRole) => roles.flatMap((r, i) => (r === role && cells[i] ? [i] : []));
    const short = at("title");
    const level = shape.severity !== null && cells[shape.severity] ? severityLevel(cells[shape.severity]) : null;
    return {
      row: index + 1,
      title: short.slice(0, TITLE_PARTS).map((i) => titleCell(table.columns[i], cells[i])).join(" · ") || `Row ${index + 1}`,
      details: short.slice(TITLE_PARTS).map((i) => `${table.columns[i]}: ${cells[i]}`).join(" · "),
      chips: at("tag").map((i) => ({ label: cells[i], level: i === shape.severity ? severityLevel(cells[i]) : null })),
      level,
      fields: at("field").map((i) => ({ column: table.columns[i], text: cells[i] })),
      values: Object.fromEntries(table.columns.flatMap((c, i) => (cells[i] ? [[c, cells[i]]] : []))),
    };
  });
  const sorted = shape.severity !== null && records.some((r, i) => i > 0 && (r.level ?? 99) < (records[i - 1].level ?? 99));
  if (shape.severity !== null) records.sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.row - b.row);
  let legend: { column: string; chips: Chip[] } | null = null;
  if (shape.severity !== null) {
    const seen = new Map<number, string>();
    for (const r of records) for (const chip of r.chips) if (chip.level !== null && !seen.has(chip.level)) seen.set(chip.level, chip.label);
    legend = { column: table.columns[shape.severity], chips: [...seen].sort((a, b) => a[0] - b[0]).map(([level, label]) => ({ label, level })) };
  }
  return {
    kind: "records",
    ...(table.title ? { title: table.title } : {}),
    ...(table.note ? { note: table.note } : {}),
    records,
    legend,
    verdictColumns: table.columns.filter((_, i) => roles[i] === "verdict"),
    sorted,
    table,
  };
}

export type ImportAs = "auto" | "cards" | "table";

export function planImport(parsed: Parsed, as: ImportAs = "auto"): ImportPlan {
  if (parsed.kind === "prose") {
    if (!parsed.sections.length) throw new ImportError("There is nothing to import");
    return { kind: "prose", ...(parsed.title ? { title: parsed.title } : {}), sections: parsed.sections };
  }
  const shape = detectShape(parsed.table);
  if (!parsed.table.rows.length) throw new ImportError("That table has a header and no rows");
  if (as === "table" || (as === "auto" && shape.kind === "table")) return { kind: "table", table: parsed.table };
  return planRecords(parsed.table, shape);
}

/** "10 records from paste, as cards": what the person is told after an import. */
export function summarise(plan: ImportPlan, from: string) {
  const many = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  if (plan.kind === "records") return `${many(plan.records.length, "record")} from ${from}, as cards${plan.sorted ? ", most severe first" : ""}`;
  if (plan.kind === "table") {
    const n = plan.table.rows.length;
    return n > MAX_TABLE_ROWS
      ? `${MAX_TABLE_ROWS.toLocaleString("en")} of ${n.toLocaleString("en")} rows from ${from}, as a table (the first ${MAX_TABLE_ROWS.toLocaleString("en")} are kept)`
      : `${many(n, "row")} from ${from}, as a table`;
  }
  return `${many(plan.sections.length, "section")} from ${from}, as cards`;
}

/** A table as tab-separated text, for agents and for the table object's plain-text form. */
export function tableText(table: Pick<Table, "columns" | "rows">, maxRows = 60) {
  const line = (cells: string[]) => cells.map((c) => c.replace(/\s+/g, " ")).join("\t");
  const more = table.rows.length - maxRows;
  return [line(table.columns), ...table.rows.slice(0, maxRows).map(line), ...(more > 0 ? [`… ${more} more rows`] : [])].join("\n");
}
