import { describe, expect, it } from "vitest";
import { isSettled, settleAll } from "../src/settled";
import { cardLook, cardType } from "../src/card-shape";

describe("settled", () => {
  it("is a flag the person sets, nothing else counts", () => {
    expect(isSettled({ settled: true })).toBe(true);
    expect(isSettled({ settled: "yes" })).toBe(false);
    expect(isSettled({})).toBe(false);
  });
  it("S settles a selection unless all of it is settled already", () => {
    expect(settleAll([{}, { settled: true }])).toBe(true);
    expect(settleAll([{}])).toBe(true);
    expect(settleAll([{ settled: true }, { settled: true }])).toBe(false);
  });
  it("a settled thought of the person's is print, not handwriting, and keeps their colour", () => {
    const rough = cardLook("human", false), done = cardLook("human", true);
    expect(rough).toBe(cardType.human);
    expect(done.font).not.toBe(rough.font);
    expect(done.color).toBe(rough.color);
    expect(done.size).toBeLessThan(rough.size);
  });
  it("other cards look the same settled or not", () => {
    for (const tone of ["agent", "quote", "code", "source"] as const) expect(cardLook(tone, true)).toBe(cardType[tone]);
  });
});
