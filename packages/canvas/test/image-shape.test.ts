import { describe, it, expect } from "vitest";
import { IMAGE_PLACE_MAX, placedSize } from "../src/image-shape";

describe("where a dropped image first lands", () => {
  it("scales a large image to fit, keeping its shape", () => {
    expect(placedSize(3000, 2000)).toEqual({ w: IMAGE_PLACE_MAX, h: 400 });
    expect(placedSize(1000, 4000)).toEqual({ w: 150, h: IMAGE_PLACE_MAX });
  });
  it("leaves an image that already fits alone", () => {
    expect(placedSize(480, 320)).toEqual({ w: 480, h: 320 });
    expect(placedSize(600, 600)).toEqual({ w: 600, h: 600 });
  });
  it("passes through sizes it cannot scale", () => {
    expect(placedSize(0, 0)).toEqual({ w: 0, h: 0 });
  });
});
