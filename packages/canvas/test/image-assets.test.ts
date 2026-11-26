import { describe, it, expect } from "vitest";
import { fitWithin, keepAsIs, MAX_SIDE, SHRINK_ABOVE_BYTES, withoutUnusedImages } from "../src/image-assets";

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
  it("saves no image whose last object was deleted, and keeps every other record", () => {
    const shape = { typeName: "shape", type: "image", props: { assetId: "asset:used" } };
    const used = { typeName: "asset", props: { src: "data:image/png;base64,AAAA" } };
    const older = { typeName: "asset", props: { src: "asset:older" } };
    const board = { schema: { v: 1 }, store: { "shape:a": shape, "asset:used": used, "asset:gone": { typeName: "asset", props: { src: "data:image/png;base64,BBBB" } }, "asset:older": older } };
    expect(withoutUnusedImages(board)).toEqual({ schema: { v: 1 }, store: { "shape:a": shape, "asset:used": used, "asset:older": older } });
  });
});
