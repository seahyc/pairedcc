import { textLines } from "./text-lines";
import { cardStyle } from "./operations";

/**
 * What an agent's change returns (friction (i) of item 140): each object it describes gives its
 * words once, as plain `text` with its line breaks kept, as canvas_read gives it, instead of the
 * editor's structured rich text, which roughly doubled a result's size and which an agent never
 * sends back. A card says its `style` (note, heading, quote, code), so a create with
 * `style: "heading"` is seen to have taken (friction (e)).
 * canvas_get still returns the structured form. Pure, so it is unit tested.
 */
export function briefResult(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => briefResult(v, depth + 1));
  const object = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(object)) out[k] = k === "props" || k === "meta" ? v : briefResult(v, depth + 1);
  const props = object.props;
  if (props && typeof props === "object" && !Array.isArray(props) && "richText" in props) {
    const { richText, ...rest } = props as Record<string, unknown>;
    out.props = rest;
    if (out.text === undefined) out.text = textLines(richText);
    if (out.type === "card" && out.style === undefined && cardStyle(rest.tone)) out.style = cardStyle(rest.tone);
  }
  return out;
}
