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

/** A touch screen with no mouse or trackpad: hints say tap, and key caps mean nothing. */
export function touchOnly(matches: (query: string) => boolean): boolean {
  return matches("(hover: none) and (pointer: coarse)") && !matches("(any-pointer: fine)");
}

export const TOUCH =
  typeof window !== "undefined" && typeof window.matchMedia === "function" ? touchOnly((q) => window.matchMedia(q).matches) : false;

/** The first board's two lines on how to write and how to ask, in this device's terms. */
export function firstBoardLines(touch: boolean, apple: boolean) {
  return touch
    ? {
        write: "Double-tap anywhere, or tap Write. Pink handwriting is you.",
        ask: "Then tap it and tap ✦ Ask. I answer beside it in a few lines; lavender is me. After that you pick, cross out or comment, and ask again.",
      }
    : {
        write: "Double-click anywhere, or press N. Pink handwriting is you.",
        ask: keyHint("Then select it and press ⌘↵ to ask. I answer beside it in a few lines; lavender is me. After that you pick (P), cross out (X) or comment (C), and ask again.", apple),
      };
}

/** The first board's lines for this browser. */
export const firstBoard = () => firstBoardLines(TOUCH, APPLE);
