import { describe, expect, it } from "vitest";
import { answerInput } from "../src/protocol";
import { compareTable } from "../src/ask-rules";

const base = { id: "shape:ask1", alternatives: ["Per seat", "Flat price", "Usage based"] };

describe("122: options compared on stated dimensions", () => {
  it("accepts 2 to 3 dimensions with one value per option per dimension", () => {
    const ok = answerInput.safeParse({ ...base, dimensions: ["cost to us", "fairness"], values: [["low", "high"], ["lowest", "low"], ["high", "highest"]] });
    expect(ok.success).toBe(true);
  });
  it("refuses dimensions without alternatives, values without dimensions, and counts that do not match", () => {
    expect(answerInput.safeParse({ id: "shape:a", text: "x", dimensions: ["a", "b"], values: [["1", "2"]] }).success).toBe(false);
    expect(answerInput.safeParse({ ...base, values: [["1"], ["2"], ["3"]] }).success).toBe(false);
    expect(answerInput.safeParse({ ...base, dimensions: ["a", "b"] }).success).toBe(false);
    expect(answerInput.safeParse({ ...base, dimensions: ["a", "b"], values: [["1", "2"], ["3", "4"]] }).success).toBe(false);
    expect(answerInput.safeParse({ ...base, dimensions: ["a", "b"], values: [["1", "2"], ["3"], ["5", "6"]] }).success).toBe(false);
    expect(answerInput.safeParse({ ...base, dimensions: ["only one"], values: [["1"], ["2"], ["3"]] }).success).toBe(false);
    expect(answerInput.safeParse({ ...base, dimensions: ["a", "b", "c", "d"], values: [["1", "2", "3", "4"], ["1", "2", "3", "4"], ["1", "2", "3", "4"]] }).success).toBe(false);
  });
  it("keeps labels and values short", () => {
    expect(answerInput.safeParse({ ...base, dimensions: ["a".repeat(41), "b"], values: [["1", "2"], ["3", "4"], ["5", "6"]] }).success).toBe(false);
    expect(answerInput.safeParse({ ...base, dimensions: ["a", "b"], values: [["1".repeat(61), "2"], ["3", "4"], ["5", "6"]] }).success).toBe(false);
  });
  it("still answers plainly without dimensions", () => {
    expect(answerInput.safeParse(base).success).toBe(true);
    expect(answerInput.safeParse({ id: "shape:a", text: "One step." }).success).toBe(true);
  });
  it("lays a row per dimension and a column per option, lettered like the cards", () => {
    expect(compareTable(["cost", "fairness"], [["low", "high"], ["lowest", "low"], ["high", "highest"]])).toEqual({
      columns: ["", "A", "B", "C"],
      rows: [
        ["cost", "low", "lowest", "high"],
        ["fairness", "high", "low", "highest"],
      ],
    });
  });
});

import { parseReply, systemPrompt } from "../tools/resident-prompt";
describe("122: the resident agent can compare on dimensions", () => {
  it("is told to name 2 or 3 dimensions only when asked to compare", () => {
    expect(systemPrompt).toMatch(/asks to compare/);
    expect(systemPrompt).toMatch(/"dimensions"/);
  });
  it("passes dimensions and values through when they line up", () => {
    const r = parseReply(JSON.stringify({ kind: "alternatives", alternatives: ["Per seat", "Flat"], dimensions: ["cost", "fairness"], values: [["low", "high"], ["high", "low"]] }));
    expect(r).toMatchObject({ kind: "alternatives", dimensions: ["cost", "fairness"], values: [["low", "high"], ["high", "low"]] });
  });
  it("drops a table that does not line up, keeping the alternatives", () => {
    for (const bad of [
      { dimensions: ["cost"], values: [["low"], ["high"]] },
      { dimensions: ["cost", "fairness"], values: [["low", "high"]] },
      { dimensions: ["cost", "fairness"], values: [["low"], ["high", "low"]] },
      { dimensions: ["cost", "fairness"], values: [["low", ""], ["high", "low"]] },
    ]) {
      const r = parseReply(JSON.stringify({ kind: "alternatives", alternatives: ["Per seat", "Flat"], ...bad }));
      expect(r.kind).toBe("alternatives");
      expect(r.alternatives).toEqual(["Per seat", "Flat"]);
      expect(r.dimensions).toBeUndefined();
    }
  });
  it("cuts long labels and values to what the board takes", () => {
    const r = parseReply(JSON.stringify({ kind: "alternatives", alternatives: ["a", "b"], dimensions: ["x".repeat(80), "y"], values: [["v".repeat(90), "1"], ["2", "3"]] }));
    expect(r.dimensions![0].length).toBe(40);
    expect(r.values![0][0].length).toBe(60);
    expect(answerInput.safeParse({ id: "shape:a", alternatives: r.alternatives, dimensions: r.dimensions, values: r.values }).success).toBe(true);
  });
});
