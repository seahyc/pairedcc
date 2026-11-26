import { describe, expect, it } from "vitest";
import { isLeftOut, keepForAgent, leftOutLabel, nextLeftOut } from "../src/leave-out";
import { prototypeEnabled } from "../src/prototype-flags";
import { buildPrompt } from "../tools/resident-prompt";

const obj = (id: string, leftOut = false) => ({ id, meta: leftOut ? { leftOut: true } : {} });

describe("leaving objects out of asks", () => {
  it("reads only an explicit mark", () => {
    expect(isLeftOut({ leftOut: true })).toBe(true);
    for (const meta of [undefined, {}, { leftOut: false }, { leftOut: "yes" }, { leftOut: 1 }]) expect(isLeftOut(meta)).toBe(false);
  });

  it("withholds left-out objects around the selection and counts them", () => {
    const { kept, withheld } = keepForAgent([obj("a"), obj("b", true), obj("c"), obj("d", true)]);
    expect(kept.map((k) => k.id)).toEqual(["a", "c"]);
    expect([...withheld]).toEqual(["b", "d"]);
  });

  it("still gives an object the person selected for this ask", () => {
    const { kept, withheld } = keepForAgent([obj("a", true), obj("b", true)], ["a"]);
    expect(kept.map((k) => k.id)).toEqual(["a"]);
    expect([...withheld]).toEqual(["b"]);
  });

  it("changes nothing on a board with no marks", () => {
    const all = [obj("a"), obj("b"), { id: "c" }];
    expect(keepForAgent(all).kept).toEqual(all);
    expect(keepForAgent(all).withheld.size).toBe(0);
  });

  it("toggles a whole selection: leave all out unless every one is out already", () => {
    expect(nextLeftOut([{}, {}])).toBe(true);
    expect(nextLeftOut([{ leftOut: true }, {}])).toBe(true);
    expect(nextLeftOut([{ leftOut: true }, { leftOut: true }])).toBe(false);
  });

  it("says how many were left out, or nothing", () => {
    expect(leftOutLabel(0)).toBe("");
    expect(leftOutLabel(1)).toBe("1 left out");
    expect(leftOutLabel(3)).toBe("3 left out");
  });

  it("is a prototype: off unless the tab asks for it", () => {
    expect(prototypeEnabled("context", "")).toBe(false);
    expect(prototypeEnabled("context", "?prototype=data")).toBe(false);
    expect(prototypeEnabled("context", "?prototype=context")).toBe(true);
  });

  it("tells the resident agent something was kept back, without what", () => {
    const ask = { question: "What's missing?", targets: [{ id: "shape:t", type: "card", author: "Human", text: "Charge per seat" }] };
    expect(buildPrompt(ask)).not.toContain("kept");
    const prompt = buildPrompt({ ...ask, leftOut: 2 });
    expect(prompt).toContain("The person kept 2 other objects on the board out of what you were given, on purpose.");
    expect(buildPrompt({ ...ask, leftOut: 1 })).toContain("kept 1 other object");
  });
});
