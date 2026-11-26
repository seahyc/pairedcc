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
