import { describe, expect, it } from "vitest";
import { RECALL_DAYS, ago, dueRecall, nextRecall, recallLine, recallOf, snoozeRecall } from "../src/learning/recall";
import { checkQuestion, checkTarget } from "../src/learning/check";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 27, 9);

describe("spaced return", () => {
  it("comes back after a day, then 3, 7 and 21 days, then is left alone", () => {
    let r = nextRecall(undefined, now);
    expect(r).toEqual({ step: 0, due: now + DAY });
    const seen: number[] = [];
    let t = now;
    while (r) {
      seen.push((r.due - t) / DAY);
      t = r.due;
      r = nextRecall(r, t);
    }
    expect(seen).toEqual([...RECALL_DAYS]);
  });
  it("Later brings it back tomorrow at the same step", () => {
    expect(snoozeRecall({ step: 2, due: now - DAY }, now)).toEqual({ step: 2, due: now + DAY });
  });
  it("reads only a well-formed schedule", () => {
    expect(recallOf({ recall: { step: 1, due: now } })).toEqual({ step: 1, due: now });
    expect(recallOf({ recall: { step: "1", due: now } })).toBeUndefined();
    expect(recallOf({})).toBeUndefined();
  });
  it("brings back one thought: due, still settled, with text, the most overdue first", () => {
    const item = (id: string, due: number, extra: Partial<{ settled: boolean; text: string }> = {}) => ({ id, settled: true, text: id, meta: { recall: { step: 0, due } }, ...extra });
    expect(dueRecall([item("later", now + 1000), item("old", now - 2 * DAY), item("new", now - DAY)], now)?.id).toBe("old");
    expect(dueRecall([item("reopened", now - DAY, { settled: false })], now)).toBeUndefined();
    expect(dueRecall([item("empty", now - DAY, { text: " " })], now)).toBeUndefined();
    expect(dueRecall([{ id: "never", settled: true, text: "x", meta: {} }], now)).toBeUndefined();
    expect(dueRecall([item("later", now + 1000)], now)).toBeUndefined();
  });
  it("says what to recall and when it was checked", () => {
    expect(recallLine("Charge per seat, with a floor of five", { step: 0, due: now }, now)).toBe("Recall “Charge per seat, with a floor of five” (checked yesterday): can you still say why?");
    expect(ago(now - 3 * DAY, now)).toBe("3 days ago");
    expect(ago(now - 21 * DAY, now)).toBe("3 weeks ago");
    expect(ago(now, now)).toBe("today");
  });
});

describe("Check me on a settled thought", () => {
  const settled = { type: "card", text: "Charge per seat", author: "Human", meta: { settled: true } };
  it("applies to the person's settled card, and says it is theirs", () => {
    expect(checkTarget(settled, () => undefined)).toEqual({ question: "", settled: true });
  });
  it("not to their writing that is still rough", () => {
    expect(checkTarget({ ...settled, meta: {} }, () => undefined)).toBeNull();
  });
  it("not while that card is already under an open check", () => {
    expect(checkTarget({ ...settled, meta: { settled: true, coveredBy: "shape:p" } }, () => undefined, () => true)).toBeNull();
  });
  it("asks why they settled on it", () => {
    expect(checkQuestion("", true)).toBe("Before you look again: what did you settle on here, and why? Say it in your own words.");
  });
});
