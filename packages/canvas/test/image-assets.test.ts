import { describe, it, expect } from "vitest";
import { fitWithin, keepAsIs, MAX_SIDE, SHRINK_ABOVE_BYTES } from "../src/image-assets";

describe("images kept in the board", () => {
  it("keeps small images, animations and vectors exactly as they are", () => {
    expect(keepAsIs("image/png", 200_000)).toBe(true);
    expect(keepAsIs("image/gif", 9_000_000)).toBe(true);
    expect(keepAsIs("image/svg+xml", 9_000_000)).toBe(true);
    expect(keepAsIs("video/mp4", 9_000_000)).toBe(true);
    expect(keepAsIs("image/jpeg", SHRINK_ABOVE_BYTES + 1)).toBe(false);
  });
  it("scales a large photo to fit the longest side, keeping its shape, never enlarging", () => {
    expect(fitWithin(6000, 4000)).toEqual({ w: MAX_SIDE, h: 1365 });
    expect(fitWithin(3000, 9000)).toEqual({ w: 683, h: MAX_SIDE });
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 });
  });
});
