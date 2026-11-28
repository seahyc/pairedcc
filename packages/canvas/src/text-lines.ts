/**
 * A card's text with its line breaks kept (paragraphs, list items, Shift+Enter), so a list or a
 * block of code reads as one. What canvas_read and a change's result give as an object's `text`;
 * search still matches on richTextSearch, which joins with spaces. Pure, so it is unit tested.
 */
export function textLines(node: unknown): string {
  if (typeof node !== "object" || node === null) return "";
  const { type, text, content } = node as { type?: string; text?: unknown; content?: unknown };
  if (type === "hardBreak") return "\n";
  if (typeof text === "string") return text;
  if (!Array.isArray(content)) return "";
  const inline = type === "paragraph" || type === "heading";
  return content.map(textLines).join(inline ? "" : "\n");
}
