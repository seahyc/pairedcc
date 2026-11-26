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
