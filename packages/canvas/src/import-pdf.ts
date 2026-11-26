import { ImportError } from "./import-parse";

// Reading the text of a PDF without a library, for import as section cards. A PDF places
// glyphs, not paragraphs, so the reader collects positioned runs of text (decoded through each
// font's ToUnicode map) and rebuilds lines, paragraphs and headings from position and size:
// a larger font, or a short line all in bold, is a heading; a wider gap starts a paragraph.
// It reads ordinary text PDFs (from a browser, word processor or exporter). It does not read
// scans (no text), protected files, or cross-reference streams' compressed object streams.

const NOT_A_PDF = "This is not a PDF that can be read. Copy its text and paste it here instead.";
const TOO_BIG = "This PDF is too large to lay out as cards. Copy the part you need and paste it here instead.";
const MAX_STREAM = 20_000_000;
// Across the whole file: bytes inflated plus content bytes read (a stream shared by many pages
// counts each time it is read), and glyph mappings kept. A small file cannot ask for more.
const MAX_TOTAL = 60_000_000, MAX_GLYPHS = 2_000_000;
type Budget = { bytes: number; glyphs: number };
const spend = (budget: Budget, kind: keyof Budget, n: number) => {
  if ((budget[kind] -= n) < 0) throw new ImportError(TOO_BIG);
};

type Dict = string;
type Obj = { dict: Dict; data?: { start: number; end: number; fallback: number; length?: number; lengthRef?: number; filter: "none" | "flate" | "other" }; stream?: Uint8Array };
type Run = { page: number; x: number; y: number; size: number; bold: boolean; text: string };

const latin1 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
};

async function inflate(data: Uint8Array, budget: Budget): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_STREAM || budget.bytes < value.length) await reader.cancel();
    if (total > MAX_STREAM) throw new ImportError(TOO_BIG);
    spend(budget, "bytes", value.length);
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) (out.set(c, at), (at += c.length));
  return out;
}

/** Every `n 0 obj … endobj` in the file. Streams are located here and decoded only when read (`streamOf`). */
function objects(bytes: Uint8Array, text: string): Map<number, Obj> {
  const found = new Map<number, Obj>();
  // Bounded digit runs: an unbounded `\d+` here backtracks quadratically over a long run of digits.
  const pattern = /(\d{1,10})\s+(\d{1,5})\s+obj\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const start = match.index + match[0].length;
    const end = text.indexOf("endobj", start);
    if (end < 0) break;
    const body = text.slice(start, end);
    const streamAt = body.search(/\bstream\r?\n/);
    const dict = streamAt >= 0 ? body.slice(0, streamAt) : body;
    const obj: Obj = { dict };
    if (streamAt >= 0) {
      const dataStart = start + streamAt + (body.slice(streamAt).match(/^stream\r?\n/)?.[0].length ?? 7);
      // /Length is a number here, or a reference to an object holding it (resolved when the stream is read).
      const direct = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(dict)?.[1];
      const lengthRef = /\/Length\s+(\d+)\s+\d+\s+R/.exec(dict)?.[1];
      // Without a usable length the data runs to `endstream`, less the line end the format puts before it.
      let fallback = Math.max(dataStart, start + body.lastIndexOf("endstream"));
      if (fallback > dataStart && bytes[fallback - 1] === 10) fallback--;
      if (fallback > dataStart && bytes[fallback - 1] === 13) fallback--;
      const filter = /\/Filter\s*\/FlateDecode|\/Filter\s*\[\s*\/FlateDecode\s*\]/.test(dict) ? "flate" : /\/Filter/.test(dict) ? "other" : "none";
      obj.data = { start: dataStart, end, fallback, length: direct ? Number(direct) : undefined, lengthRef: lengthRef ? Number(lengthRef) : undefined, filter };
    }
    found.set(Number(match[1]), obj);
    pattern.lastIndex = end;
  }
  return found;
}

/** A stream's bytes, inflated when it is Flate. Images and other encodings carry no text we read. */
async function streamOf(o: Obj | undefined, objs: Map<number, Obj>, bytes: Uint8Array, budget: Budget): Promise<Uint8Array | undefined> {
  if (!o?.data) return undefined;
  if (o.stream) return o.stream;
  const d = o.data;
  const length = d.length ?? Number(/^\s*(\d+)\s*$/.exec(objs.get(d.lengthRef ?? -1)?.dict ?? "")?.[1]);
  const stop = Number.isFinite(length) && length > 0 && d.start + length <= d.end ? d.start + length : d.fallback;
  const raw = bytes.subarray(d.start, Math.max(d.start, stop));
  return (o.stream = d.filter === "flate" ? await inflate(raw, budget) : d.filter === "none" ? raw : new Uint8Array(0));
}

/** The inside of `[ … ]` after a key. */
function arrayAfter(dict: Dict, key: string) {
  const open = new RegExp(`/${key}\\s*\\[`).exec(dict);
  const close = open ? dict.indexOf("]", open.index) : -1;
  return open && close >= 0 ? dict.slice(open.index + open[0].length, close) : undefined;
}
/** Each stretch between a `begin…` and its `end…` keyword. */
function blocks(text: string, begin: string, end: string) {
  const out: string[] = [];
  for (let at = text.indexOf(begin); at >= 0; ) {
    const stop = text.indexOf(end, at);
    if (stop < 0) break;
    out.push(text.slice(at + begin.length, stop));
    at = text.indexOf(begin, stop);
  }
  return out;
}

const ref = (dict: Dict, key: string) => Number(new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict)?.[1] ?? NaN);
/** The text of `<< … >>` after a key, balanced, or of the object it refers to. */
function subDict(dict: Dict, key: string, objs: Map<number, Obj>): Dict | undefined {
  const at = dict.search(new RegExp(`/${key}\\s*(<<|\\d+\\s+\\d+\\s+R)`));
  if (at < 0) return undefined;
  const rest = dict.slice(at + key.length + 1).trimStart();
  if (!rest.startsWith("<<")) return objs.get(Number(/^(\d+)/.exec(rest)?.[1]))?.dict;
  let depth = 0;
  for (let i = 0; i < rest.length - 1; i++) {
    if (rest.startsWith("<<", i)) (depth++, i++);
    else if (rest.startsWith(">>", i) && --depth === 0) return rest.slice(2, i);
    else if (rest.startsWith(">>", i)) i++;
  }
  return undefined;
}

/** Pages in reading order, following the page tree from the catalog. */
function pages(objs: Map<number, Obj>, trailer: string): number[] {
  const out: number[] = [];
  const root = objs.get(ref(trailer, "Root")) ?? [...objs.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict));
  // Each node is visited once: a damaged tree whose nodes list each other must not loop.
  const visited = new Set<number>();
  const visit = (id: number, depth: number) => {
    const node = objs.get(id);
    if (!node || depth > 50 || out.length > 2000 || visited.has(id)) return;
    visited.add(id);
    if (/\/Type\s*\/Page\b(?!s)/.test(node.dict)) return void out.push(id);
    const kids = arrayAfter(node.dict, "Kids") ?? "";
    for (const k of kids.matchAll(/(\d+)\s+\d+\s+R/g)) visit(Number(k[1]), depth + 1);
  };
  if (root) visit(ref(root.dict, "Pages"), 0);
  if (!out.length) for (const [id, o] of objs) if (/\/Type\s*\/Page\b(?!s)/.test(o.dict)) out.push(id);
  return out;
}

type Font = { bytes: number; map: Map<number, string>; bold: boolean };
const hexToCodes = (hex: string, width: number) => {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const out: number[] = [];
  for (let i = 0; i + width * 2 <= clean.length; i += width * 2) out.push(parseInt(clean.slice(i, i + width * 2), 16));
  return out;
};
const utf16 = (hex: string) => {
  const units = hexToCodes(hex, 2);
  return String.fromCharCode(...units);
};

function font(dict: Dict, objs: Map<number, Obj>, budget: Budget): Font {
  const map = new Map<number, string>();
  const put = (code: number, value: string) => (spend(budget, "glyphs", 1), map.set(code, value));
  let width = /\/Subtype\s*\/Type0/.test(dict) ? 2 : 1;
  const cmap = objs.get(ref(dict, "ToUnicode"))?.stream;
  if (cmap) {
    const text = latin1(cmap);
    const space = /begincodespacerange\s*<([0-9a-f]+)>/i.exec(text);
    if (space) width = Math.max(1, Math.min(4, space[1].length / 2));
    for (const block of blocks(text, "beginbfchar", "endbfchar"))
      for (const m of block.matchAll(/<([0-9a-f]{1,8})>\s*<([0-9a-f]+)>/gi)) put(parseInt(m[1], 16), utf16(m[2]));
    for (const block of blocks(text, "beginbfrange", "endbfrange"))
      // Codes are at most four bytes: a longer one would be a number too large to count up from.
      for (const m of block.matchAll(/<([0-9a-f]{1,8})>\s*<([0-9a-f]{1,8})>\s*(<[0-9a-f]+>|\[[^\][]*\])/gi)) {
        const lo = parseInt(m[1], 16), hi = Math.min(parseInt(m[2], 16), lo + 65535);
        if (m[3].startsWith("[")) [...m[3].matchAll(/<([0-9a-f]+)>/gi)].forEach((d, k) => lo + k <= hi && put(lo + k, utf16(d[1])));
        else {
          const base = utf16(m[3].slice(1, -1));
          for (let c = lo; c <= hi; c++) put(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + c - lo));
        }
      }
  }
  return { bytes: width, map, bold: /\/BaseFont\s*\/[^\s/]*(Bold|Black|Heavy|Semibold)/i.test(dict) };
}

/** Tokens of a content stream: numbers, names, strings (as byte codes), arrays and operators. */
type Token = { n: number } | { name: string } | { str: number[]; hex: boolean } | { op: string } | { open: true } | { close: true };
function* tokens(s: string): Generator<Token> {
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) i++;
    else if (c === "%") while (i < s.length && s[i] !== "\n" && s[i] !== "\r") i++;
    else if (c === "/") {
      const m = /^\/[^\s/<>[\]()%{}]*/.exec(s.slice(i, i + 128))![0];
      yield { name: m.slice(1) };
      i += m.length;
    } else if (c === "(") {
      const out: number[] = [];
      let depth = 1;
      i++;
      while (i < s.length && depth > 0) {
        const ch = s[i];
        if (ch === "\\") {
          const nx = s[i + 1];
          const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4));
          if (oct) (out.push(parseInt(oct[0], 8) & 255), (i += 1 + oct[0].length));
          else {
            const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12 };
            if (nx !== "\n" && nx !== "\r") out.push(esc[nx] ?? nx.charCodeAt(0));
            i += 2;
          }
          continue;
        }
        if (ch === "(") depth++;
        else if (ch === ")" && --depth === 0) break;
        out.push(ch.charCodeAt(0));
        i++;
      }
      i++;
      yield { str: out, hex: false };
    } else if (c === "<" && s[i + 1] === "<") {
      i += 2;
      yield { op: "<<" };
    } else if (c === ">" && s[i + 1] === ">") {
      i += 2;
      yield { op: ">>" };
    } else if (c === "<") {
      const end = s.indexOf(">", i);
      if (end < 0) return;
      const hex = s.slice(i + 1, end).replace(/[^0-9a-f]/gi, "");
      yield { str: hexToCodes(hex.length % 2 ? hex + "0" : hex, 1), hex: true };
      i = end + 1;
    } else if (c === "[") (i++, yield { open: true });
    else if (c === "]") (i++, yield { close: true });
    else if (/[-+.\d]/.test(c)) {
      const m = /^[-+]?\d*\.?\d*/.exec(s.slice(i, i + 40))![0] || c;
      yield { n: Number(m) || 0 };
      i += m.length;
    } else {
      const m = /^[^\s/<>[\]()%{}]+/.exec(s.slice(i, i + 64))?.[0] ?? c;
      if (m === "BI") {
        // Inline image: skip to its end.
        const end = s.indexOf("EI", i + 2);
        i = end < 0 ? s.length : end + 2;
        continue;
      }
      yield { op: m };
      i += m.length;
    }
  }
}

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];

function runs(content: string, fonts: Map<string, Font>, page: number, out: Run[]) {
  let ctm: M = [1, 0, 0, 1, 0, 0], tm: M = [1, 0, 0, 1, 0, 0], tlm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  let current: Font | undefined, size = 0, leading = 0;
  let operands: (number | string | number[][] | { str: number[] })[] = [];
  let array: (number | number[])[] | null = null;
  const decode = (codes: number[]) => {
    if (!current) return "";
    const width = current.bytes;
    let s = "";
    for (let i = 0; i + width <= codes.length; i += width) {
      let code = 0;
      for (let k = 0; k < width; k++) code = code * 256 + codes[i + k];
      s += current.map.get(code) ?? (width === 1 && code >= 32 && code < 127 ? String.fromCharCode(code) : "");
    }
    return s;
  };
  const show = (text: string) => {
    if (!text) return;
    const trm = mul(tm, ctm);
    out.push({ page, x: trm[4], y: trm[5], size: Math.abs(size * Math.hypot(trm[2], trm[3])) || size, bold: current?.bold ?? false, text });
    // Advance roughly, so the next run on the line is not taken for a new line.
    tm = mul([1, 0, 0, 1, text.length * size * 0.5, 0], tm);
  };
  const newLine = (tx: number, ty: number) => {
    tlm = mul([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
  };
  for (const t of tokens(content)) {
    if ("open" in t) array = [];
    else if ("close" in t) {
      operands.push(array as never);
      array = null;
    } else if ("n" in t) (array ? array.push(t.n) : operands.push(t.n));
    else if ("str" in t) (array ? array.push(t.str) : operands.push({ str: t.str }));
    else if ("name" in t) operands.push(t.name);
    else {
      const n = (k: number) => Number(operands[operands.length - k]) || 0;
      switch (t.op) {
        case "q": stack.push(ctm); break;
        case "Q": ctm = stack.pop() ?? ctm; break;
        case "cm": ctm = mul([n(6), n(5), n(4), n(3), n(2), n(1)], ctm); break;
        case "BT": tm = tlm = [1, 0, 0, 1, 0, 0]; break;
        case "Tf": current = fonts.get(String(operands[operands.length - 2])); size = n(1); break;
        case "TL": leading = n(1); break;
        case "Tm": tm = tlm = [n(6), n(5), n(4), n(3), n(2), n(1)]; break;
        case "Td": newLine(n(2), n(1)); break;
        case "TD": leading = -n(1); newLine(n(2), n(1)); break;
        case "T*": newLine(0, -leading); break;
        case "Tj": show(decode((operands[operands.length - 1] as { str: number[] })?.str ?? [])); break;
        case "'": newLine(0, -leading); show(decode((operands[operands.length - 1] as { str: number[] })?.str ?? [])); break;
        case '"': newLine(0, -leading); show(decode((operands[operands.length - 1] as { str: number[] })?.str ?? [])); break;
        case "TJ": {
          const parts = operands[operands.length - 1];
          if (Array.isArray(parts)) {
            let text = "";
            // A large negative kern between strings is a word space in many producers.
            for (const p of parts as (number | number[])[]) text += typeof p === "number" ? (p < -200 && !text.endsWith(" ") ? " " : "") : decode(p);
            show(text);
          }
          break;
        }
      }
      operands = [];
    }
  }
}

/** Lines, paragraphs and headings from positioned runs, as markdown. */
function layout(all: Run[]): string {
  type Line = { page: number; x: number; y: number; size: number; bold: boolean; text: string };
  const lines: Line[] = [];
  for (const r of all) {
    const last = lines[lines.length - 1];
    if (last && last.page === r.page && Math.abs(last.y - r.y) < Math.max(1, r.size * 0.4)) {
      last.text += r.text;
      last.size = Math.max(last.size, r.size);
      last.bold &&= r.bold || !r.text.trim();
    } else lines.push({ page: r.page, x: r.x, y: r.y, size: r.size, bold: r.bold, text: r.text });
  }
  const kept = lines.map((l) => ({ ...l, text: l.text.replace(/[\s ]+/g, " ").trim() })).filter((l) => l.text);
  if (!kept.length) return "";
  // Body size: the size most text is set in.
  const weight = new Map<number, number>();
  for (const l of kept) weight.set(Math.round(l.size * 2) / 2, (weight.get(Math.round(l.size * 2) / 2) ?? 0) + l.text.length);
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const headingSizes = [...new Set(kept.filter((l) => l.size >= body * 1.15).map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a);
  const level = (l: Line) => {
    const rank = headingSizes.indexOf(Math.round(l.size * 2) / 2);
    if (rank >= 0) return Math.min(rank + 1, 3);
    return l.bold && l.text.length < 80 && !/[.:;,]$/.test(l.text) ? Math.min(headingSizes.length + 1, 3) : 0;
  };
  // The left edge most lines start at; a line set in from it is a list item (many producers draw
  // the bullet as a shape, not a character). An indented line that starts with a capital after
  // one that ended a sentence is a new item; otherwise it continues the item above.
  const starts = new Map<number, number>();
  for (const l of kept) starts.set(Math.round(l.x), (starts.get(Math.round(l.x)) ?? 0) + l.text.length);
  const left = [...starts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const indented = (l: Line) => l.x > left + l.size * 1.2;
  const blocks: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push(para.join("\n"));
    para = [];
  };
  let previous: Line | undefined;
  for (const l of kept) {
    const h = level(l);
    const gap = previous && previous.page === l.page ? Math.abs(l.y - previous.y) : Infinity;
    const listed = indented(l) && !level(l) && (!previous || !indented(previous) || level(previous) > 0 || (/[.!?:;”"]$/.test(previous.text) && /^[A-Z0-9“"(]/.test(l.text)));
    const bullet = /^[•·▪◦‣–-]\s/.test(l.text) || /^[•·▪◦‣]/.test(l.text) || listed;
    const continuesItem = indented(l) && !listed && para.length > 0 && para[para.length - 1].startsWith("- ");
    if (h) {
      flush();
      // A heading that wraps onto a second line continues the same heading.
      const prev = blocks[blocks.length - 1];
      if (previous && level(previous) === h && gap < l.size * 1.6 && prev?.startsWith("#")) blocks[blocks.length - 1] = `${prev} ${l.text}`;
      else blocks.push(`${"#".repeat(h)} ${l.text}`);
    } else {
      // A gap well beyond the line spacing (or a new page) starts a paragraph; a bullet starts an item.
      if (previous && (level(previous) || gap > l.size * 1.75 || previous.page !== l.page) && !(bullet && para.length && /^[•·▪◦‣–-]/.test(para[0]))) flush();
      if (continuesItem) para[para.length - 1] += ` ${l.text}`;
      else para.push(bullet ? `- ${l.text.replace(/^[•·▪◦‣–-]\s*/, "")}` : l.text);
    }
    previous = l;
  }
  flush();
  return blocks.join("\n\n") + "\n";
}

/** The text of a PDF as markdown (headings and paragraphs). Throws an ImportError a person can act on. */
export async function readPdf(bytes: Uint8Array): Promise<string> {
  try {
    const text = latin1(bytes);
    if (!text.startsWith("%PDF-") && !text.slice(0, 1024).includes("%PDF-")) throw new ImportError(NOT_A_PDF);
    const trailer = text.slice(text.lastIndexOf("trailer"));
    if (/\/Encrypt\b/.test(trailer) || /\/Encrypt\s+\d+\s+\d+\s+R/.test(text.slice(-4096)))
      throw new ImportError("This PDF is protected, so its text cannot be read. Open it, copy the text and paste it here instead.");
    const objs = objects(bytes, text);
    const budget: Budget = { bytes: MAX_TOTAL, glyphs: MAX_GLYPHS };
    const fontCache = new Map<number, Font>();
    const order = pages(objs, trailer.includes("/Root") ? trailer : text.slice(-4096));
    if (!order.length) throw new ImportError(NOT_A_PDF);
    const all: Run[] = [];
    for (const [index, id] of order.entries()) {
      const page = objs.get(id)!;
      const resources = subDict(page.dict, "Resources", objs) ?? "";
      const fontDict = subDict(resources, "Font", objs) ?? "";
      const fonts = new Map<string, Font>();
      for (const m of fontDict.matchAll(/\/([^\s/]+)\s+(\d+)\s+\d+\s+R/g)) {
        const f = objs.get(Number(m[2]));
        if (!f) continue;
        // A font is read once, however many pages use it.
        if (!fontCache.has(Number(m[2]))) {
          await streamOf(objs.get(ref(f.dict, "ToUnicode")), objs, bytes, budget);
          fontCache.set(Number(m[2]), font(f.dict, objs, budget));
        }
        fonts.set(m[1], fontCache.get(Number(m[2]))!);
      }
      const contents = arrayAfter(page.dict, "Contents") ?? /\/Contents\s+(\d+\s+\d+\s+R)/.exec(page.dict)?.[1] ?? "";
      const streams: Uint8Array[] = [];
      for (const m of contents.matchAll(/(\d+)\s+\d+\s+R/g)) {
        const stream = await streamOf(objs.get(Number(m[1])), objs, bytes, budget);
        if (!stream) continue;
        spend(budget, "bytes", stream.length);
        streams.push(stream);
      }
      runs(streams.map(latin1).join("\n"), fonts, index, all);
    }
    const markdown = layout(all);
    if (!markdown.trim()) throw new ImportError("This PDF has no text to read; it may be a scan. Copy its text from a reader that can recognise it, and paste it here.");
    return markdown;
  } catch (error) {
    throw error instanceof ImportError ? error : new ImportError(NOT_A_PDF);
  }
}
