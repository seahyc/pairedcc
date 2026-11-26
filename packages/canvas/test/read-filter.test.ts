import { describe, expect, it } from "vitest";
import { matchesText, richTextSearch } from "../src/read-filter";
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
  it("matches a Greek query ending in sigma inside a word, either case", () => {
    expect(matchesText("ΟΣ", "ΟΣΑ")).toBe(true);
    expect(matchesText("ος", "οσα")).toBe(true);
    expect(matchesText("οσα", "ΟΣΑ")).toBe(true);
  });
  it("keeps vowel signs that change a word, while still ignoring accents", () => {
    expect(matchesText("दिन", "दीन")).toBe(false);
    expect(matchesText("दिन", "आज का दिन")).toBe(true);
    expect(matchesText("cafe", "Café")).toBe(true);
  });
  it("reads a partly formatted word as one word, and blocks and line breaks as spaces", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "pr", marks: [{ type: "bold" }] }, { type: "text", text: "icing for teams" }] },
        { type: "paragraph", content: [{ type: "text", text: "line one" }, { type: "hardBreak" }, { type: "text", text: "line two" }] },
      ],
    };
    expect(richTextSearch(doc)).toBe("pricing for teams line one line two");
    expect(matchesText("pricing", richTextSearch(doc), "Notes")).toBe(true);
  });
  it("is part of read's input and its tool", () => {
    expect(readInput.parse({ text: "pricing", ids: ["shape:a"] })).toEqual({ text: "pricing", ids: ["shape:a"] });
    expect(readInput.safeParse({ text: "x".repeat(201) }).success).toBe(false);
    const read = toolDefs.find((t) => t.name === "canvas_read")!;
    expect(Object.keys(read.input)).toContain("text");
  });
});
