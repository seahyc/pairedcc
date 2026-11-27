import { describe, expect, it } from "vitest";
import { answerInput } from "../src/protocol";
import { answerTexts } from "../src/ask-rules";

// Finding 6, comparing beats describing: options laid out on the dimensions they differ on.
const base = { id: "shape:ask", alternatives: ["Charge per seat", "Charge per job post"] };

describe("answer input with dimensions", () => {
  it("takes dimensions with one short value per option on each", () => {
    const v = answerInput.parse({ ...base, dimensions: ["Cost to us", "Risk"], values: [["Low", "Churn when teams shrink"], ["Medium", "Lumpy revenue"]] });
    expect(v.dimensions).toEqual(["Cost to us", "Risk"]);
  });
  it("refuses dimensions without alternatives", () => {
    expect(() => answerInput.parse({ id: "shape:ask", text: "Seats.", dimensions: ["Cost"], values: [["Low"]] })).toThrow(/alternatives/);
  });
  it("refuses values that do not match the options and dimensions", () => {
    expect(() => answerInput.parse({ ...base, dimensions: ["Cost"], values: [["Low"]] })).toThrow(/one row of values per alternative/);
    expect(() => answerInput.parse({ ...base, dimensions: ["Cost", "Risk"], values: [["Low"], ["High", "Low"]] })).toThrow(/one value per dimension/);
    expect(() => answerInput.parse({ ...base, dimensions: ["Cost"] })).toThrow(/values/);
  });
  it("keeps dimensions few and short", () => {
    expect(() => answerInput.parse({ ...base, dimensions: ["a", "b", "c", "d", "e"], values: [["1", "2", "3", "4", "5"], ["1", "2", "3", "4", "5"]] })).toThrow();
    expect(() => answerInput.parse({ ...base, dimensions: ["x".repeat(41)], values: [["1"], ["2"]] })).toThrow();
  });
});

describe("option card text", () => {
  it("is unchanged without dimensions", () => {
    expect(answerTexts(answerInput.parse(base))).toEqual(["A · Charge per seat", "B · Charge per job post"]);
  });
  it("lists the same dimensions in the same order under each headline", () => {
    const texts = answerTexts(answerInput.parse({ ...base, dimensions: ["Cost to us", "Risk"], values: [["Low", "Churn"], ["Medium", "Lumpy revenue"]] }));
    expect(texts).toEqual(["A · Charge per seat\nCost to us: Low\nRisk: Churn", "B · Charge per job post\nCost to us: Medium\nRisk: Lumpy revenue"]);
  });
  it("keeps each value short", () => {
    const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    const [a] = answerTexts(answerInput.parse({ ...base, dimensions: ["Cost"], values: [[long], ["Low"]] }));
    expect(a.split("\n")[1].split(" ").length).toBeLessThanOrEqual(13);
    expect(a).toMatch(/…$/);
  });
  it("a single answer is as before", () => {
    expect(answerTexts(answerInput.parse({ id: "shape:ask", text: "Try seats." }))).toEqual(["Try seats."]);
  });
});

import { parseReply, systemPrompt } from "../tools/resident-prompt";

describe("the resident agent states dimensions with options", () => {
  it("is asked to", () => {
    expect(systemPrompt).toMatch(/dimensions they differ on/);
    expect(systemPrompt).toMatch(/"dimensions"/);
  });
  it("passes dimensions and values on when they line up", () => {
    const r = parseReply('{"kind":"alternatives","alternatives":["Seats","Posts"],"dimensions":["Cost","Risk"],"values":[["Low","Churn"],["High","Lumpy"]]}');
    expect(r).toMatchObject({ kind: "alternatives", dimensions: ["Cost", "Risk"], values: [["Low", "Churn"], ["High", "Lumpy"]] });
    expect(() => answerInput.parse({ id: "shape:a", alternatives: r.alternatives, dimensions: r.dimensions, values: r.values })).not.toThrow();
  });
  it("drops dimensions that do not line up, and keeps the options", () => {
    const r = parseReply('{"kind":"alternatives","alternatives":["Seats","Posts"],"dimensions":["Cost","Risk"],"values":[["Low"],["High","Lumpy"]]}');
    expect(r.alternatives).toEqual(["Seats", "Posts"]);
    expect(r).not.toHaveProperty("dimensions");
  });
  it("an answer without dimensions is as before", () => {
    expect(parseReply('{"kind":"alternatives","alternatives":["Seats","Posts"]}')).toEqual({ read: undefined, kind: "alternatives", alternatives: ["Seats", "Posts"] });
  });
});

import { optionRichText } from "../src/ask-rules";
import { richTextSearch } from "../src/read-filter";

describe("dimension labels stand out", () => {
  it("bolds each dimension's name, one paragraph per line, and reads back as the same text", () => {
    const text = "A · Charge per seat\nCost to try: Low\nRisk: Churn";
    const doc = optionRichText(text, ["Cost to try", "Risk"]) as any;
    expect(doc.content).toHaveLength(3);
    expect(doc.content[0].content).toEqual([{ type: "text", text: "A · Charge per seat" }]);
    expect(doc.content[1].content).toEqual([{ type: "text", text: "Cost to try:", marks: [{ type: "bold" }] }, { type: "text", text: " Low" }]);
    expect(richTextSearch(doc)).toBe("A · Charge per seat Cost to try: Low Risk: Churn");
  });
});

describe("review of #165", () => {
  it("keeps each option's values with it when the model sends a blank option", () => {
    const r = parseReply('{"kind":"alternatives","alternatives":["Per seat","","Flat fee"],"dimensions":["Cost"],"values":[["Low"],["Medium"],["High"]]}');
    expect(r.alternatives).toEqual(["Per seat", "Flat fee"]);
    expect(r.values).toEqual([["Low"], ["High"]]);
  });
  it("drops dimensions when there are fewer rows than options were sent", () => {
    const r = parseReply('{"kind":"alternatives","alternatives":["Per seat","","Flat fee"],"dimensions":["Cost"],"values":[["Low"],["High"]]}');
    expect(r).not.toHaveProperty("dimensions");
  });
  it("puts a headline or value with line breaks on one line, so no paragraph is empty", () => {
    const input = answerInput.parse({ id: "shape:a", alternatives: ["Charge per seat\n\nBill monthly", "Flat"], dimensions: ["Risk"], values: [["Low\n\nish"], ["High"]] });
    const [a] = answerTexts(input);
    expect(a).toBe("A · Charge per seat Bill monthly\nRisk: Low ish");
    const doc = optionRichText(a, ["Risk"]) as any;
    expect(doc.content.every((p: any) => p.content.every((t: any) => t.text.length > 0))).toBe(true);
  });
  it("never makes an empty text node, even from an empty line", () => {
    const doc = optionRichText("A · Head\n\nRisk: Low", ["Risk"]) as any;
    expect(doc.content.every((p: any) => (p.content ?? []).every((t: any) => t.text.length > 0))).toBe(true);
  });
});
