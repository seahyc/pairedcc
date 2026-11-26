import { describe, expect, it } from "vitest";
import { askAnnouncement } from "../src/ask-rules";

const ask = (state: string, extra: Record<string, unknown> = {}) => ({ state, question: "Charge per seat?", ...extra });

describe("askAnnouncement: each change of an ask's state is said once", () => {
  it("says nothing when the state has not changed (the clock ticking is not news)", () => {
    expect(askAnnouncement("waiting", ask("waiting"), 0)).toBeUndefined();
    expect(askAnnouncement("working", ask("working", { agent: "Claude" }), 0)).toBeUndefined();
  });
  it("says an ask was sent and is waiting", () => {
    expect(askAnnouncement(undefined, ask("waiting"), 0)).toBe("Asked “Charge per seat?”. Waiting for an agent.");
  });
  it("names the agent working on it, with its note", () => {
    expect(askAnnouncement("waiting", ask("working", { agent: "Claude", note: "reading 2 cards" }), 0)).toBe("Claude is working on your ask: reading 2 cards.");
    expect(askAnnouncement("waiting", ask("working"), 0)).toBe("An agent is working on your ask.");
  });
  it("says who answered and where the answer is", () => {
    expect(askAnnouncement("working", ask("answered", { agent: "Claude" }), 1)).toBe("Claude answered, under your ask.");
    expect(askAnnouncement("working", ask("answered", { agent: "Claude" }), 4)).toBe("Claude answered with 4 options, under your ask.");
  });
  it("says a failure, why, and that Retry is there", () => {
    expect(askAnnouncement("working", ask("failed", { error: "Took too long" }), 0)).toBe("Your ask failed: Took too long. Retry is under the ask.");
  });
  it("a retry that waits again is said again", () => {
    expect(askAnnouncement("failed", ask("waiting"), 0)).toBe("Asked “Charge per seat?”. Waiting for an agent.");
  });
});

import { announceState, liveText, optionsInLatestRound } from "../src/ask-rules";
describe("review of #101: announcements that were lost or wrong", () => {
  it("(a) the same words twice in a row still change the live region, so they are said again", () => {
    const first = liveText("", "Claude answered, under your ask.");
    const second = liveText(first, "Claude answered, under your ask.");
    expect(first.trim()).toBe("Claude answered, under your ask.");
    expect(second).not.toBe(first);
    expect(second.trim()).toBe("Claude answered, under your ask.");
    expect(liveText(second, "Claude answered, under your ask.")).toBe(first);
    expect(liveText(first, "Something else.")).toBe("Something else.");
  });
  it("(b) an ask that goes quiet past the timeout is said, once, with Retry", () => {
    const working = { state: "working", agent: "Claude", askedAt: 0, startedAt: 1000 };
    expect(announceState(working, 60_000)).toBe("working");
    expect(announceState(working, 1000 + 120_001)).toBe("quiet");
    expect(announceState({ state: "answered", askedAt: 0 }, 999_999)).toBe("answered");
    expect(askAnnouncement("working", { ...working, state: "quiet" }, 0)).toBe("Claude went quiet. Retry is under the ask.");
    expect(askAnnouncement("quiet", { ...working, state: "quiet" }, 0)).toBeUndefined();
  });
  it("(c) only the latest answer's options are counted, not an earlier clarifying question", () => {
    expect(optionsInLatestRound([{ at: 1000 }, { at: 9000, option: "A" }, { at: 9000, option: "B" }, { at: 9001, option: "C" }])).toBe(3);
    expect(optionsInLatestRound([{ at: 1000 }, { at: 9000 }])).toBe(1);
    expect(optionsInLatestRound([{ at: 1000, option: "A" }, { at: 1000, option: "B" }, { at: 9000 }])).toBe(1);
    expect(optionsInLatestRound([])).toBe(0);
    // Stamped with the answer's time: exact, however close together two answers come.
    expect(optionsInLatestRound([{ answeredAt: 5000 }, { answeredAt: 5800 }, { answeredAt: 5800 }, { answeredAt: 5800 }])).toBe(3);
  });
});
