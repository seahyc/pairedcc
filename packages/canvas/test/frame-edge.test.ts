import { describe, expect, it } from "vitest";
import { cutOff, insidePolygon, wholly } from "../src/frame-edge";
import { followers } from "../src/follow";
import { isDerivedField } from "../src/revision";

const square = [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }];
const corners = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

describe("a card a frame would cut off (item 113)", () => {
  it("is cut off only when a corner leaves the frame's clip", () => {
    expect(cutOff(corners(10, 10, 290, 90), square)).toBe(false);
    expect(cutOff(corners(10, 350, 290, 100), square)).toBe(true);
    expect(cutOff(corners(0, 0, 500, 400), square)).toBe(false); // on the edge is inside
    expect(cutOff(corners(10, 10, 100, 100), undefined)).toBe(false); // no frame, no clip
  });
  it("follows a rotated frame's slanted edge, not its bounding box", () => {
    // A square frame turned 45°: its bounding box holds points its edges cut off.
    const diamond = [{ x: 250, y: 0 }, { x: 500, y: 250 }, { x: 250, y: 500 }, { x: 0, y: 250 }];
    const card = corners(60, 60, 120, 60);
    expect(wholly({ x: 60, y: 60, maxX: 180, maxY: 120 }, { x: 0, y: 0, maxX: 500, maxY: 500 })).toBe(true);
    expect(cutOff(card, diamond)).toBe(true);
    expect(cutOff(corners(200, 200, 100, 60), diamond)).toBe(false);
  });
  it("uses the clip of every frame above it (an inner frame inside an outer one)", () => {
    // The mask is the intersection: a card inside the inner frame but past the outer edge is cut.
    const outerAndInner = [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 300 }, { x: 100, y: 300 }];
    expect(cutOff(corners(150, 250, 200, 80), outerAndInner)).toBe(true);
  });
  it("tests points with ray casting", () => {
    expect(insidePolygon({ x: 250, y: 200 }, square)).toBe(true);
    expect(insidePolygon({ x: 600, y: 200 }, square)).toBe(false);
  });
  it("still moves with the frame it was lifted from", () => {
    const shapes = [
      { id: "card", meta: { within: "frame" } },
      { id: "answer", meta: { targetId: "card", replyTo: "card" } },
      { id: "other", meta: {} },
    ];
    expect(followers(["frame", "child"], shapes, new Set())).toEqual(["card", "answer"]);
  });
  it("an ask about several cards lifted from a frame comes along when the frame carries them all", () => {
    const shapes = [{ id: "ask", meta: { within: "frame", targetIds: ["a", "b"] } }];
    expect(followers(["frame", "a", "b"], shapes, new Set())).toEqual(["ask"]);
    expect(followers(["a"], shapes, new Set())).toEqual([]);
  });
  it("a lifted card the person left out brings nothing along with the frame", () => {
    const shapes = [
      { id: "card", meta: { within: "frame" } },
      { id: "comment", meta: { targetId: "card" } },
    ];
    expect(followers(["frame"], shapes, new Set(["card"]))).toEqual([]);
  });
  it("lifting is the canvas's doing: it does not move the card's revision", () => {
    expect(isDerivedField("card", "meta.within")).toBe(true);
  });
});
