import { describe, expect, it } from "vitest";
import { bendFor, chooseAnchors } from "../src/connector-follow";

const box = (x: number, y: number) => ({ x, y, w: 200, h: 100 });

describe("chooseAnchors", () => {
  it("joins bottom to top when the second object is below", () => {
    expect(chooseAnchors(box(0, 0), box(0, 300))).toMatchObject({ start: { x: 0.5, y: 1 }, end: { x: 0.5, y: 0 }, vertical: true });
  });
  it("joins right to left when the second object is to the right", () => {
    expect(chooseAnchors(box(0, 0), box(500, 0))).toMatchObject({ start: { x: 1, y: 0.5 }, end: { x: 0, y: 0.5 }, vertical: false });
  });
  it("re-picks the sides after a move: a note dragged from below to the left of its target", () => {
    const target = box(400, 0);
    expect(chooseAnchors(box(400, 300), target)).toMatchObject({ start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } });
    expect(chooseAnchors(box(0, 20), target)).toMatchObject({ start: { x: 1, y: 0.5 }, end: { x: 0, y: 0.5 } });
  });
  it("keeps the bend gentle and bounded", () => {
    expect(Math.abs(bendFor(chooseAnchors(box(0, 0), box(5000, 4000))))).toBeLessThanOrEqual(60);
    expect(bendFor(chooseAnchors(box(0, 0), box(0, 300)))).toBe(0);
  });
});
