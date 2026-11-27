import { describe, expect, it } from "vitest";
import { focusBox, focusMembers, focusRoot } from "../src/focus";

const board = [
  { id: "frame", type: "frame", ask: false },
  { id: "card", type: "card", ask: false },
  { id: "ask", type: "card", ask: true },
  { id: "a", type: "card", ask: false, replyTo: "ask" },
  { id: "b", type: "card", ask: false, replyTo: "ask" },
  { id: "ask2", type: "card", ask: true },
  { id: "c", type: "card", ask: false, replyTo: "ask2" },
  { id: "comment", type: "card", ask: false, replyTo: "card" },
];
const byId = (id: string) => board.find((s) => s.id === id);
const pick = (...ids: string[]) => ids.map((id) => byId(id)!);

describe("focus (F)", () => {
  it("focuses a selected frame", () => {
    expect(focusRoot(pick("frame"), byId)).toBe("frame");
  });
  it("focuses the thread of a selected ask or answer", () => {
    expect(focusRoot(pick("ask"), byId)).toBe("ask");
    expect(focusRoot(pick("b"), byId)).toBe("ask");
    expect(focusRoot(pick("ask", "a", "b"), byId)).toBe("ask");
  });
  it("leaves F to the Frame tool for anything else", () => {
    expect(focusRoot([], byId)).toBeUndefined();
    expect(focusRoot(pick("card"), byId)).toBeUndefined();
    // A reply to a plain card is not a thread.
    expect(focusRoot(pick("comment"), byId)).toBeUndefined();
    // Two threads at once, or a thread and something else, is not one thing to focus on.
    expect(focusRoot(pick("a", "c"), byId)).toBeUndefined();
    expect(focusRoot(pick("ask", "card"), byId)).toBeUndefined();
    expect(focusRoot(pick("frame", "card"), byId)).toBeUndefined();
  });
  it("keeps the ask and every answer in view, or the frame", () => {
    expect(focusMembers(byId("ask")!, board)).toEqual(["ask", "a", "b"]);
    expect(focusMembers(byId("frame")!, board)).toEqual(["frame"]);
  });
  it("draws one rectangle around them with a margin", () => {
    expect(focusBox([{ x: 0, y: 0, maxX: 100, maxY: 50 }, { x: 40, y: 80, maxX: 300, maxY: 120 }], 10)).toEqual({ x: -10, y: -10, w: 320, h: 140 });
    expect(focusBox([])).toBeUndefined();
  });
});
