import { describe, expect, it } from "vitest";
import { clip, hasLoneSurrogate, wellFormed } from "../src/text";

describe("well-formed text", () => {
  it("clips without leaving half an emoji", () => {
    expect(clip("ab\u{1F600}cd", 3)).toBe("ab");
    expect(clip("ab\u{1F600}cd", 4)).toBe("ab\u{1F600}");
    expect(clip("plain", 3)).toBe("pla");
  });
  it("repairs only unpaired halves, in values and keys, like the server", () => {
    expect(wellFormed({ a: "x\uD83D", "k\uDC00": ["ok \u{1F600}", 1, null] })).toEqual({ a: "x�", "k�": ["ok \u{1F600}", 1, null] });
  });
  it("finds a half character in JSON text, and not a whole one", () => {
    expect(hasLoneSurrogate(JSON.stringify({ a: "x\uD83D" }))).toBe(true);
    expect(hasLoneSurrogate(JSON.stringify({ a: "x\u{1F600}" }))).toBe(false);
  });
});
