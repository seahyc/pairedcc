import { describe, it, expect } from "vitest";
import { menuStep, trapStep } from "../src/focus-keys";

describe("menu keys", () => {
  it("moves down and up, wrapping at the ends", () => {
    expect(menuStep(0, 4, "ArrowDown")).toBe(1);
    expect(menuStep(3, 4, "ArrowDown")).toBe(0);
    expect(menuStep(0, 4, "ArrowUp")).toBe(3);
    expect(menuStep(2, 4, "ArrowUp")).toBe(1);
  });
  it("goes to the first and last with Home and End", () => {
    expect(menuStep(2, 4, "Home")).toBe(0);
    expect(menuStep(1, 4, "End")).toBe(3);
  });
  it("starts from the edge when nothing in the menu has focus", () => {
    expect(menuStep(-1, 4, "ArrowDown")).toBe(0);
    expect(menuStep(-1, 4, "ArrowUp")).toBe(3);
  });
  it("ignores other keys and empty menus", () => {
    expect(menuStep(1, 4, "a")).toBeUndefined();
    expect(menuStep(0, 0, "ArrowDown")).toBeUndefined();
  });
});

describe("dialog keeps Tab inside", () => {
  it("wraps from the last control to the first, and back with Shift", () => {
    expect(trapStep(2, 3, false)).toBe(0);
    expect(trapStep(0, 3, true)).toBe(2);
  });
  it("leaves the browser's own Tab alone in the middle", () => {
    expect(trapStep(0, 3, false)).toBeUndefined();
    expect(trapStep(2, 3, true)).toBeUndefined();
  });
  it("brings focus back in from outside", () => {
    expect(trapStep(-1, 3, false)).toBe(0);
    expect(trapStep(-1, 3, true)).toBe(2);
  });
  it("has nowhere to go with no controls", () => {
    expect(trapStep(-1, 0, false)).toBeUndefined();
  });
});
