import { describe, expect, it } from "vitest";
import { commitResponse, hiddenBy, learnInput, skipPrompt, type PromptProps } from "../src/learning/model";

const open: PromptProps = { w: 340, h: 240, mode: "predict", question: "Which region sells most cake?", response: "", status: "open" };

describe("learning prompt input", () => {
  it("accepts the two modes and defaults to hiding nothing", () => {
    expect(learnInput.parse({ mode: "predict", question: "Q", x: 0, y: 0 }).hideIds).toEqual([]);
    expect(learnInput.parse({ mode: "generate", question: "Q", x: 0, y: 0, hideIds: ["shape:a"] }).hideIds).toEqual(["shape:a"]);
    expect(learnInput.safeParse({ mode: "quiz", question: "Q", x: 0, y: 0 }).success).toBe(false);
    expect(learnInput.safeParse({ mode: "predict", question: "", x: 0, y: 0 }).success).toBe(false);
    expect(learnInput.safeParse({ mode: "predict", question: "Q", x: 0, y: 0, hideIds: ["a"] }).success).toBe(false);
  });
});

describe("answering", () => {
  it("commits a trimmed response once", () => {
    const done = commitResponse(open, "  West, because of the promo  ");
    expect(done).toMatchObject({ status: "committed", response: "West, because of the promo" });
    expect(() => commitResponse(done, "again")).toThrow(/already/);
  });
  it("refuses an empty commit but always allows a skip", () => {
    expect(() => commitResponse(open, "   ")).toThrow(/skip/);
    expect(skipPrompt(open).status).toBe("skipped");
    expect(() => skipPrompt(skipPrompt(open))).toThrow(/already/);
  });
});

describe("hiding until answered", () => {
  it("hides only while the prompt is open, and ignores unknown prompts", () => {
    const status = new Map([["shape:p", "open" as const], ["shape:q", "committed" as const]]);
    const of = (id: string) => status.get(id);
    expect(hiddenBy({ revealAfter: "shape:p" }, of)).toBe(true);
    expect(hiddenBy({ revealAfter: "shape:q" }, of)).toBe(false);
    expect(hiddenBy({ revealAfter: "shape:gone" }, of)).toBe(false);
    expect(hiddenBy({}, of)).toBe(false);
  });
});

import { learningPrototypeEnabled } from "../src/learning/prompt-shape";
describe("learning prototype flag", () => {
  it("is off unless ?prototype=learning is present", () => {
    expect(learningPrototypeEnabled("")).toBe(false);
    expect(learningPrototypeEnabled("?prototype=data")).toBe(false);
    expect(learningPrototypeEnabled("?prototype=data&prototype=learning")).toBe(true);
  });
});
