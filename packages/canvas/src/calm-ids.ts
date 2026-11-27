/**
 * Names for the calm first board that are the same on every device (item 100 (d)). Two devices
 * that open the same older board before either has saved each lay out the calm board; with the
 * same page and card ids, the merge by record (board-sync.ts) keeps one of each instead of two
 * "Thinking" pages. Pure, tested in test/calm-ids.test.ts.
 */
export const CALM_PAGE_ID = "page:calm-thinking";

/** The three cards of the calm board laid out on `pageId`. */
export function calmSeedIds(pageId: string) {
  const base = `shape:${pageId.replace(/^page:/, "")}-calm`;
  return { title: `${base}-title`, hint: `${base}-hint`, ask: `${base}-ask` } as const;
}

/**
 * Whether a page's name was chosen by someone (the person, or an agent's `page`), so the calm
 * layout keeps it rather than renaming the page "Board 1" (item 100 (e)). tldraw's "Page 1" and
 * the canvas's own "Board 1" are defaults.
 */
export function chosenPageName(name: string) {
  const n = name.trim();
  return n !== "" && !/^(Page|Board) \d+$/.test(n);
}
