// Text that is always well-formed UTF-16. JavaScript strings can hold half of a surrogate
// pair (half an emoji), for example after slicing; PostgreSQL rejects such text in JSONB.

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** At most `max` UTF-16 units of `text`, never ending in half a character. */
export function clip(text: string, max: number) {
  const cut = text.slice(0, max);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/**
 * The same value with every unpaired surrogate replaced by U+FFFD, as the server stores it
 * (packages/server/src/canvas/boards/store.ts, wellFormed). Everything else is untouched.
 */
export function wellFormed<T>(value: T): T {
  if (typeof value === "string") return value.replace(LONE_SURROGATE, "�") as T;
  if (Array.isArray(value)) return value.map(wellFormed) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [wellFormed(k), wellFormed(v)])) as T;
  return value;
}

/** Whether JSON text holds an escaped unpaired surrogate (JSON.stringify escapes only those). */
export const hasLoneSurrogate = (json: string) => /\\u[dD][89abcdefABCDEF][0-9a-fA-F]{2}/.test(json);
