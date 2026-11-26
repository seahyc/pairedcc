import { describe, expect, it } from "vitest";
import { contextMarkUpdate, isLeftOut, isPinned, nextPinned, PIN_LIMIT, pinnedFor, pinnedLabel } from "../src/leave-out";
import { buildPrompt } from "../tools/resident-prompt";

const at = (id: string, x: number, y: number, meta: Record<string, unknown> = { pinned: true }) => ({ id, x, y, meta });

describe("pinning objects into every ask", () => {
  it("reads only an explicit mark", () => {
    expect(isPinned({ pinned: true })).toBe(true);
    for (const meta of [undefined, {}, { pinned: false }, { pinned: "yes" }, { pinned: 1 }]) expect(isPinned(meta)).toBe(false);
  });

  it("gives pinned objects in reading order, skipping what the ask already gives", () => {
    const shapes = [at("c", 0, 300), at("a", 0, 0), at("plain", 0, 50, {}), at("b", 400, 0), at("t", 0, 500)];
    const { pinned, more } = pinnedFor(shapes, ["t"]);
    expect(pinned.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(more).toBe(0);
  });

  it("never gives a hidden object, and a left-out mark wins; a card once asked with still counts", () => {
    const shapes = [{ ...at("hidden", 0, 0), hidden: true }, at("both", 0, 20, { pinned: true, leftOut: true }), at("asked", 0, 25, { pinned: true, ask: { state: "answered" } }), at("ok", 0, 30)];
    expect(pinnedFor(shapes).pinned.map((s) => s.id)).toEqual(["asked", "ok"]);
  });

  it("caps how many are given and counts the rest", () => {
    const shapes = Array.from({ length: PIN_LIMIT + 2 }, (_, i) => at(`p${i}`, 0, i * 10));
    const { pinned, more } = pinnedFor(shapes);
    expect(pinned).toHaveLength(PIN_LIMIT);
    expect(more).toBe(2);
  });

  it("toggles a whole selection: pin all unless every one is pinned already", () => {
    expect(nextPinned([{}, {}])).toBe(true);
    expect(nextPinned([{ pinned: true }, {}])).toBe(true);
    expect(nextPinned([{ pinned: true }, { pinned: true }])).toBe(false);
  });

  it("pinning clears leave out and leaving out clears a pin", () => {
    const pinned = contextMarkUpdate({ leftOut: true, mark: "picked" }, "pinned", true);
    expect(isPinned(pinned)).toBe(true);
    expect(isLeftOut(pinned)).toBe(false);
    expect(pinned.mark).toBe("picked");
    const out = contextMarkUpdate({ pinned: true }, "leftOut", true);
    expect(isLeftOut(out)).toBe(true);
    expect("pinned" in out).toBe(false);
    expect(contextMarkUpdate({ pinned: true, other: 1 }, "pinned", false)).toEqual({ other: 1 });
  });

  it("says how many were pinned, or nothing", () => {
    expect(pinnedLabel(0)).toBe("");
    expect(pinnedLabel(1)).toBe("1 pinned");
    expect(pinnedLabel(4)).toBe("4 pinned");
  });

  it("tells the resident agent what the person pinned for every ask", () => {
    const ask = { question: "Which first?", targets: [{ id: "shape:t", type: "card", author: "Human", text: "Charge per seat" }] };
    expect(buildPrompt(ask)).not.toContain("pinned");
    const prompt = buildPrompt({ ...ask, pinned: [{ id: "shape:g", type: "card", author: "Human", text: "Goal: keep churn under 3%" }], pinnedMore: 1 });
    expect(prompt).toContain('The person pinned these for every ask, as standing context:\n- card written by the person: """Goal: keep churn under 3%"""\n- and 1 more not shown');
    expect(prompt.indexOf("pinned")).toBeLessThan(prompt.indexOf("The person wrote this"));
  });
});
