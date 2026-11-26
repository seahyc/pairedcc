import { describe, it, expect } from "vitest";
import { IMAGE_PLACE_MAX, placedSize } from "../src/image-shape";

describe("where a dropped image first lands", () => {
  it("scales a large image to fit, keeping its shape", () => {
    expect(placedSize(3000, 2000)).toEqual({ w: IMAGE_PLACE_MAX, h: 400 });
    expect(placedSize(1000, 4000)).toEqual({ w: 150, h: IMAGE_PLACE_MAX });
    expect(placedSize(3000, 2001).h).toBeCloseTo(400.2);
  });
  it("leaves an image that already fits alone", () => {
    expect(placedSize(480, 320)).toEqual({ w: 480, h: 320 });
    expect(placedSize(600, 600)).toEqual({ w: 600, h: 600 });
  });
  it("keeps a very thin image thin but never zero", () => {
    const thin = placedSize(3000, 2);
    expect(thin.w).toBe(IMAGE_PLACE_MAX);
    expect(thin.h).toBeCloseTo(0.4);
    expect(thin.h).toBeGreaterThan(0);
  });
  it("passes through sizes it cannot scale", () => {
    expect(placedSize(0, 0)).toEqual({ w: 0, h: 0 });
  });
});
