/**
 * Key hints in the person's own keys. Hints are written with Apple's symbols (⌘ ⇧ ⌫); on any
 * other keyboard they read Ctrl, Shift and Backspace, the keys printed there. The keyboard
 * handlers already accept Ctrl wherever they accept ⌘.
 */
type NavigatorLike = { platform?: string; userAgent?: string; userAgentData?: { platform?: string } };

export function isApple(nav: NavigatorLike): boolean {
  const platform = nav.userAgentData?.platform || nav.platform || "";
  if (platform) return /mac|iphone|ipad|ipod/i.test(platform);
  return /Mac OS X|Macintosh|iPhone|iPad|iPod/.test(nav.userAgent ?? "");
}

export function keyHint(text: string, apple: boolean): string {
  if (apple) return text;
  return text
    .replace(/⇧ ⌘ /g, "Ctrl Shift ")
    .replace(/⌘( ?)/g, (_m, space: string) => (space ? "Ctrl " : "Ctrl+"))
    .replace(/⇧ ?/g, "Shift ")
    .replace(/⌫/g, "Backspace");
}

const APPLE = typeof navigator === "undefined" ? true : isApple(navigator as NavigatorLike);

/** A hint for this browser's keyboard. */
export const keys = (text: string) => keyHint(text, APPLE);
