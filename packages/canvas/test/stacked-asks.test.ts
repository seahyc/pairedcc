import { describe, expect, it } from "vitest";
import { readsAsAnswerTo, slideRight, statusRoom, STATUS_ROOM, statusWidth } from "../src/ask-rules";

// Item 132, from verify-answer-beside on the person's real cards (#129): three questions written
// 24 px apart under one card, each 300 × 73, answered out of order.
const q1 = { x: 276, y: 358, w: 300, h: 73 }, q2 = { x: 276, y: 455, w: 300, h: 73 }, q3 = { x: 276, y: 552, w: 300, h: 73 };
// The second question's options, already beside it: three cards in a row.
const row2 = [{ x: 616, y: 455, w: 250, h: 67 }, { x: 886, y: 455, w: 250, h: 95 }, { x: 1156, y: 455, w: 250, h: 67 }];

describe("an answer row read as another question's answer", () => {
  it("just beside a question, level with it", () => {
    expect(readsAsAnswerTo({ x: 616, y: 552 }, q3)).toBe(true);
    expect(readsAsAnswerTo({ x: 616, y: 358 }, q1)).toBe(true);
  });
  it("just under a question, left edges aligned", () => {
    expect(readsAsAnswerTo({ x: 276, y: 640 }, q3)).toBe(true);
  });
  it("not when it is further right or well away", () => {
    expect(readsAsAnswerTo({ x: 1430, y: 358 }, q2)).toBe(false);
    expect(readsAsAnswerTo({ x: 616, y: 358 }, q2)).toBe(false);
  });
});

describe("level with its own question, past the rows in the way", () => {
  const row = { x: 616, y: 358, w: 790, h: 95 };
  it("moves right past the second question's row, staying level", () => {
    const got = slideRight(row, [q1, q2, q3, ...row2])!;
    expect(got.y).toBe(358);
    expect(got.x).toBeGreaterThan(1406);
    expect([q1, q2, q3, ...row2].every((o) => got.x >= o.x + o.w || got.y + got.h + 14 <= o.y || got.x + got.w <= o.x)).toBe(true);
  });
  it("stays put when nothing is in the way", () => {
    expect(slideRight(row, [q1])).toEqual(row);
  });
  it("gives up beyond its reach", () => {
    expect(slideRight(row, [{ x: 0, y: 300, w: 5000, h: 300 }], 1600)).toBeUndefined();
  });
});

describe("room under a question for its state line", () => {
  it("is the gap to the card written under it", () => {
    expect(statusRoom(q1, [q2, q3], statusWidth(q1.w))).toBe(24);
    expect(statusRoom(q1, [q2], statusWidth(q1.w))).toBeLessThan(STATUS_ROOM);
  });
  it("ignores what is not under it, and is unlimited when nothing is", () => {
    expect(statusRoom(q3, [q1, q2, ...row2], statusWidth(q3.w))).toBe(Infinity);
  });
  it("an answer placed under its question leaves the full room", () => {
    expect(statusRoom(q3, [{ x: 276, y: q3.y + q3.h + STATUS_ROOM, w: 250, h: 67 }], statusWidth(q3.w))).toBe(STATUS_ROOM);
  });
});
