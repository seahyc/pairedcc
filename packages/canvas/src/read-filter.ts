// Finding objects by their words, for `read`'s `text` filter: an agent can ask for "the card
// about pricing" without reading the whole board.

/**
 * Lower case without accents, for matching. Only combining diacritics (U+0300 to U+036F)
 * are dropped, so "Café" matches "cafe" while vowel signs in scripts such as Devanagari are
 * kept (दिन and दीन stay different). Case is folded through upper case, so ß and ẞ become ss
 * ("STRASSE" finds "Straße"). Greek final sigma is folded to σ, so a query ending in Σ still
 * matches the same letter inside a word.
 */
const fold = (s: string) =>
  s.normalize("NFKD").replace(/[\u0300-\u036f\ufe0e\ufe0f]/g, "").toUpperCase().toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "σ").replace(/\s+/g, " ").trim();

const graphemes = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;

/** Whether `q` occurs in `text` starting and ending between whole characters (कल is not in कला). */
function containsWhole(text: string, q: string) {
  let at = text.indexOf(q);
  if (at < 0 || !graphemes) return at >= 0;
  const bounds = new Set<number>([text.length]);
  for (const { index } of graphemes.segment(text)) bounds.add(index);
  for (; at >= 0; at = text.indexOf(q, at + 1)) if (bounds.has(at) && bounds.has(at + q.length)) return true;
  return false;
}

/** Whether any of the fields contains the query, ignoring case, accents and spacing. */
export function matchesText(query: string, ...fields: (string | undefined | null)[]) {
  const q = fold(query);
  if (!q) return true;
  return fields.some((f) => typeof f === "string" && containsWhole(fold(f), q));
}

type Node = { type?: unknown; text?: unknown; content?: unknown };
const inline = (n: Node) => n.type === "text" || n.type === "hardBreak" || typeof n.text === "string";

/**
 * The words of a rich-text document as they read on the canvas: runs inside one paragraph
 * join with nothing between them (a partly bold word stays one word), blocks and line
 * breaks with a space. Used for searching and for the `text` that `read` gives for each object
 * and annotation, which is the only form of the words `read` returns.
 */
export function richTextSearch(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const node = value as Node;
  if (node.type === "hardBreak") return " ";
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  const children = node.content as Node[];
  // Blocks join with one space, and an empty block (a blank line) adds nothing.
  return children.every(inline) ? children.map(richTextSearch).join("") : children.map(richTextSearch).filter((t) => t.length > 0).join(" ");
}
