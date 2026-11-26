import { describe, expect, it } from "vitest";
import { canvasOptions, defaultMaxShapesPerPage, MAX_SHAPES_PER_PAGE } from "../src/canvas-options";

describe("editor limits", () => {
  it("lets one page hold a 10k-object board, above tldraw's default", () => {
    expect(defaultMaxShapesPerPage).toBe(4000);
    expect(MAX_SHAPES_PER_PAGE).toBeGreaterThanOrEqual(10_000);
    expect(canvasOptions.maxShapesPerPage).toBe(MAX_SHAPES_PER_PAGE);
  });
});
