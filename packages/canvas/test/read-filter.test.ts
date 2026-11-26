import { describe, expect, it } from "vitest";
import { matchesText } from "../src/read-filter";
import { readInput } from "../src/agent-operations";
import { toolDefs } from "../tools/tool-defs";

describe("finding objects by their text", () => {
  it("matches text or name, ignoring case, accents and spacing", () => {
    expect(matchesText("pricing", "Per-seat PRICING for teams")).toBe(true);
    expect(matchesText("cafe", undefined, "Café regulars")).toBe(true);
    expect(matchesText("per  seat", "per seat")).toBe(true);
    expect(matchesText("pricing", "Hiring plan", "Roadmap")).toBe(false);
    expect(matchesText("x", undefined, null)).toBe(false);
    expect(matchesText("   ", "anything")).toBe(true);
  });
  it("is part of read's input and its tool", () => {
    expect(readInput.parse({ text: "pricing", ids: ["shape:a"] })).toEqual({ text: "pricing", ids: ["shape:a"] });
    expect(readInput.safeParse({ text: "x".repeat(201) }).success).toBe(false);
    const read = toolDefs.find((t) => t.name === "canvas_read")!;
    expect(Object.keys(read.input)).toContain("text");
  });
});
