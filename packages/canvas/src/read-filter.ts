// Finding objects by their words, for `read`'s `text` filter: an agent can ask for "the card
// about pricing" without reading the whole board.

/**
 * Lower case without accents, for matching. Only combining diacritics (U+0300 to U+036F)
 * are dropped, so "Café" matches "cafe" while vowel signs in scripts such as Devanagari are
 * kept (दिन and दीन stay different). Greek final sigma is folded to σ, so a query ending in
 * Σ still matches the same letter inside a word.
 */
const fold = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ς/g, "σ").replace(/\s+/g, " ").trim();

/** Whether any of the fields contains the query, ignoring case, accents and spacing. */
export function matchesText(query: string, ...fields: (string | undefined | null)[]) {
  const q = fold(query);
  if (!q) return true;
  return fields.some((f) => typeof f === "string" && fold(f).includes(q));
}

type Node = { type?: unknown; text?: unknown; content?: unknown };
const inline = (n: Node) => n.type === "text" || n.type === "hardBreak" || typeof n.text === "string";

/**
 * The words of a rich-text document as they read on the canvas: runs inside one paragraph
 * join with nothing between them (a partly bold word stays one word), blocks and line
 * breaks with a space. Used for searching only; `read` still reports richTextPlain.
 */
export function richTextSearch(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const node = value as Node;
  if (node.type === "hardBreak") return " ";
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  const children = node.content as Node[];
  return children.map(richTextSearch).join(children.every(inline) ? "" : " ");
}
