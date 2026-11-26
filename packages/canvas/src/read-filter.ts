// Finding objects by their words, for `read`'s `text` filter: an agent can ask for "the card
// about pricing" without reading the whole board.

const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Whether any of the fields contains the query, ignoring case, accents and spacing. */
export function matchesText(query: string, ...fields: (string | undefined | null)[]) {
  const q = fold(query);
  if (!q) return true;
  return fields.some((f) => typeof f === "string" && fold(f).includes(q));
}
