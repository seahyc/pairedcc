import { describe, expect, it } from "vitest";
import { isApple, keyHint } from "../src/keys";

describe("isApple: which keyboard the person has", () => {
  it("knows Apple platforms", () => {
    expect(isApple({ platform: "MacIntel", userAgent: "" })).toBe(true);
    expect(isApple({ platform: "iPhone", userAgent: "" })).toBe(true);
    expect(isApple({ platform: "", userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" })).toBe(true);
    expect(isApple({ platform: "", userAgent: "", userAgentData: { platform: "macOS" } })).toBe(true);
  });
  it("knows everything else is not", () => {
    expect(isApple({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe(false);
    expect(isApple({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe(false);
    expect(isApple({ platform: "", userAgent: "", userAgentData: { platform: "Windows" } })).toBe(false);
  });
});

describe("keyHint: hints name the person's own keys", () => {
  it("leaves hints alone on Apple keyboards", () => {
    expect(keyHint("⌘↵", true)).toBe("⌘↵");
    expect(keyHint("⇧ ⌘ Z", true)).toBe("⇧ ⌘ Z");
  });
  it("says Ctrl on other keyboards, in the order those keyboards use", () => {
    expect(keyHint("⌘↵", false)).toBe("Ctrl+↵");
    expect(keyHint("⌘ ↵", false)).toBe("Ctrl ↵");
    expect(keyHint("⌘ Z / ⇧ ⌘ Z", false)).toBe("Ctrl Z / Ctrl Shift Z");
    expect(keyHint("⌘D, then edit", false)).toBe("Ctrl+D, then edit");
    expect(keyHint("Pinch, or ⌘ scroll", false)).toBe("Pinch, or Ctrl scroll");
    expect(keyHint("⌫", false)).toBe("Backspace");
    expect(keyHint("Then select it and press ⌘↵ to ask.", false)).toBe("Then select it and press Ctrl+↵ to ask.");
  });
  it("leaves no Apple symbol behind", () => {
    for (const t of ["⌘↵", "⌘ ↵", "⇧ ⌘ Z", "⌘ V, or drop a file", "⌫", "⇧ C"]) expect(keyHint(t, false)).not.toMatch(/[⌘⇧⌫]/);
  });
});

import { firstBoardLines, touchOnly } from "../src/keys";

describe("touchOnly: a touch screen with no pointer that hovers", () => {
  const device = (queries: string[]) => (q: string) => queries.includes(q);
  it("is true for a phone", () => {
    expect(touchOnly(device(["(hover: none) and (pointer: coarse)"]))).toBe(true);
  });
  it("is false for a laptop, and for a touch laptop or a tablet with a trackpad", () => {
    expect(touchOnly(device(["(any-pointer: fine)"]))).toBe(false);
    expect(touchOnly(device(["(hover: none) and (pointer: coarse)", "(any-pointer: fine)"]))).toBe(false);
  });
});

describe("firstBoardLines: the first board speaks the device's language", () => {
  it("on a touch screen says tap and names no key", () => {
    const { write, ask } = firstBoardLines(true, false);
    expect(ask).toMatch(/tap ✦ Ask/);
    expect(write).toMatch(/tap/i);
    expect(write + ask).not.toMatch(/[⌘⇧⌫]|Ctrl|press|\([PXC]\)/);
  });
  it("on a keyboard keeps today's lines, in the keyboard's keys", () => {
    expect(firstBoardLines(false, true).ask).toMatch(/press ⌘↵ to ask/);
    expect(firstBoardLines(false, false).ask).toMatch(/press Ctrl\+↵ to ask/);
    expect(firstBoardLines(false, true).write).toBe("Double-click anywhere, or press N. Pink handwriting is you.");
  });
});
