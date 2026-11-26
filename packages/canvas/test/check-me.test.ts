import { describe, expect, it } from "vitest";
import { CHECK_SIZE, checkPlacement, checkQuestion, checkTarget } from "../src/learning/check";

const answer = { type: "card", text: "Charge per seat, with a floor of five seats.", author: "Paired", meta: { replyTo: "shape:ask", role: "annotation" } };
const askText = (id: string) => (id === "shape:ask" ? "How should we price the team plan?" : undefined);

describe("what Check me applies to", () => {
  it("is an agent's answer to an ask, with the ask's question", () => {
    expect(checkTarget(answer, askText)).toEqual({ question: "How should we price the team plan?" });
  });
  it("is not the person's own writing, an agent card that answers nothing, or an empty card", () => {
    expect(checkTarget({ ...answer, author: "Human" }, askText)).toBeNull();
    expect(checkTarget({ ...answer, meta: {} }, askText)).toBeNull();
    expect(checkTarget({ ...answer, text: "   " }, askText)).toBeNull();
    expect(checkTarget({ ...answer, type: "prompt" }, askText)).toBeNull();
  });
  it("is not an answer already waiting behind a check", () => {
    expect(checkTarget({ ...answer, meta: { ...answer.meta, revealAfter: "shape:p" } }, askText, () => true)).toBeNull();
    // Once that check is answered the answer can be checked again.
    expect(checkTarget({ ...answer, meta: { ...answer.meta, revealAfter: "shape:p" } }, askText, () => false)).not.toBeNull();
  });
  it("still applies when the ask is gone, without a question to quote", () => {
    expect(checkTarget(answer, () => undefined)).toEqual({ question: "" });
  });
});

describe("the question the person is asked", () => {
  it("asks them to explain the answer from memory, quoting the ask", () => {
    expect(checkQuestion("How should we price the team plan?")).toBe(
      "Before you look again: what was the answer to “How should we price the team plan?”, and why? Say it in your own words.",
    );
  });
  it("shortens a long ask and has a wording for none", () => {
    const long = checkQuestion("x".repeat(400));
    expect(long.length).toBeLessThan(180);
    expect(long).toContain("…");
    expect(checkQuestion("")).toBe("Before you look again: what did this answer say, and why? Say it in your own words.");
  });
});

describe("where the check goes", () => {
  const box = { x: 100, y: 100, w: 300, h: 120 };
  it("beside the answer, top aligned, so the two can be compared once it is shown", () => {
    expect(checkPlacement(box, [])).toEqual({ x: 100 + 300 + 24, y: 100 });
  });
  it("never on top of anything: left of the answer, then under it, then further right", () => {
    const right = { x: 430, y: 80, w: 200, h: 140 };
    expect(checkPlacement(box, [right])).toEqual({ x: 100 - 24 - CHECK_SIZE.w, y: 100 });
    const left = { x: -300, y: 60, w: 320, h: 300 };
    expect(checkPlacement(box, [right, left])).toEqual({ x: 100, y: 100 + 120 + 24 });
    const below = { x: 0, y: 230, w: 800, h: 400 };
    const spot = checkPlacement(box, [right, left, below]);
    const placed = { ...spot, ...CHECK_SIZE };
    const overlaps = (a: typeof placed, b: typeof box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const o of [right, left, below, box]) expect(overlaps(placed, o)).toBe(false);
  });
});
