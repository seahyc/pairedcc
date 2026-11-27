import { describe, expect, it } from "vitest";
import { wholly } from "../src/frame-edge";
import { followers } from "../src/follow";
import { isDerivedField } from "../src/revision";

describe("a card across a frame's edge (item 113)", () => {
  const frame = { x: 0, y: 0, maxX: 500, maxY: 400 };
  it("is lifted only when it is not wholly inside", () => {
    expect(wholly({ x: 10, y: 10, maxX: 300, maxY: 100 }, frame)).toBe(true);
    expect(wholly({ x: 10, y: 350, maxX: 300, maxY: 450 }, frame)).toBe(false);
    expect(wholly({ x: -5, y: 10, maxX: 300, maxY: 100 }, frame)).toBe(false);
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
  it("lifting is the canvas's doing: it does not move the card's revision", () => {
    expect(isDerivedField("card", "meta.within")).toBe(true);
  });
});
