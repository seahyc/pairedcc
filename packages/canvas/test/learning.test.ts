import { describe, expect, it } from "vitest";
import { commitResponse, hiddenBy, hideRefusal, learnInput, skipPrompt, type PromptProps } from "../src/learning/model";

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

describe("what a prompt may hide", () => {
  const obj = (meta: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ id: "shape:r", type: "card", isLocked: false, meta, ...over });
  it("hides an object an agent made", () => {
    expect(hideRefusal(obj({ createdBy: "My agent" }))).toBeNull();
  });
  it("treats the person's comments and their arrows as the person's work", () => {
    // A comment left with C is an annotation by "Human"; its arrow is createdBy "Human".
    expect(hideRefusal(obj({ role: "annotation", author: "Human", targetId: "shape:x" }))).toMatch(/person made/);
    expect(hideRefusal(obj({ createdBy: "Human" }, { type: "arrow" }))).toMatch(/person made/);
    expect(hideRefusal(obj({ role: "annotation", author: "My agent" }))).toBeNull();
  });
  it("refuses an agent frame that holds something the person made", () => {
    const children = [obj({ createdBy: "My agent" }, { id: "shape:a" }), obj({}, { id: "shape:mine" })];
    expect(hideRefusal(obj({ createdBy: "My agent" }, { type: "frame" }), children)).toMatch(/shape:mine/);
    expect(hideRefusal(obj({ createdBy: "My agent" }, { type: "frame" }), [children[0]])).toBeNull();
  });
  it("never hides the person's own work, a locked object or another prompt", () => {
    expect(hideRefusal(obj({}))).toMatch(/person made/);
    expect(hideRefusal(obj({ createdBy: "My agent" }, { isLocked: true }))).toMatch(/Unlock/);
    expect(hideRefusal(obj({ createdBy: "My agent" }, { type: "prompt" }))).toMatch(/another prompt/);
  });
});
