import { describe, expect, it } from "vitest";
import { citationsOf, planCited, sectionKey } from "../src/import-cite";

describe("citationsOf", () => {
  it("reads question codes from a record's short columns, in order, once each", () => {
    expect(citationsOf({ "No.": "2", Q: "Q56 vs Q16/Q49", Topic: "Fleet cost inconsistency" })).toEqual(["Q56", "Q16", "Q49"]);
    expect(citationsOf({ Q: "q40/Q41", Topic: "Environmental benefit", Again: "Q40" })).toEqual(["Q40", "Q41"]);
  });
  it("ignores long prose columns and plain numbers", () => {
    expect(citationsOf({ "No.": "7", Topic: "Match funding status", Attack: "Q18 lists the funders and amounts in a table, and Q99 is mentioned in passing here." })).toEqual([]);
  });
});

describe("sectionKey", () => {
  it("takes the code a heading starts with", () => {
    expect(sectionKey("Q56. Fleet costs")).toBe("Q56");
    expect(sectionKey("q7 — Safety certification")).toBe("Q7");
    expect(sectionKey("§ A3: Governance")).toBe("A3");
    expect(sectionKey("Q12")).toBe("Q12");
  });
  it("is undefined for a heading that does not start with a code", () => {
    expect(sectionKey("What the route is for")).toBeUndefined();
    expect(sectionKey("Questions 12 to 20")).toBeUndefined();
    expect(sectionKey(undefined)).toBeUndefined();
  });
});

describe("planCited", () => {
  const record = { id: "rec", x: 100, y: 1000, w: 1248, h: 230 };
  const sections = [
    { id: "s16", key: "Q16", x: 100, y: 5000, w: 520, h: 120 },
    { id: "s49", key: "Q49", x: 100, y: 5200, w: 520, h: 90 },
    { id: "s56", key: "Q56", x: 100, y: 5400, w: 520, h: 150 },
    { id: "s3", key: "Q3", x: 100, y: 5600, w: 520, h: 100 },
  ];
  it("stacks the cited sections beside the record in citation order and reports what is missing", () => {
    const plan = planCited(record, ["Q56", "Q16", "Q99", "Q49"], sections, []);
    expect(plan.missing).toEqual(["Q99"]);
    expect(plan.moves.map((m) => m.id)).toEqual(["s56", "s16", "s49"]);
    expect(plan.moves[0]).toEqual({ id: "s56", x: 100 + 1248 + 48, y: 1000 });
    expect(plan.moves[1].y).toBe(1000 + 150 + 16);
    expect(plan.moves[2].y).toBe(1000 + 150 + 16 + 120 + 16);
    expect(plan.moves.every((m) => m.x === plan.moves[0].x)).toBe(true);
  });
  it("steps right past anything already in that column", () => {
    const obstacles = [{ id: "note", x: 1380, y: 1100, w: 300, h: 80 }];
    const plan = planCited(record, ["Q56"], sections, obstacles);
    expect(plan.moves[0].x).toBe(1380 + 300 + 48);
  });
  it("does not treat the sections being moved as obstacles", () => {
    const already = sections.map((s, i) => ({ ...s, x: 1396, y: 1000 + i * 200 }));
    const plan = planCited(record, ["Q16"], already, already);
    expect(plan.moves[0].x).toBe(1396);
  });
  it("picks the first section for a code that heads two", () => {
    const plan = planCited(record, ["Q16"], [...sections, { id: "s16b", key: "Q16", x: 100, y: 6000, w: 520, h: 50 }], []);
    expect(plan.moves.map((m) => m.id)).toEqual(["s16"]);
  });
});

describe("the synthetic fixtures cite each other", () => {
  it("every code the review cites heads a section of the pack, except the ones the extract leaves out", async () => {
    const { readFileSync } = await import("node:fs");
    const { parseImport, planImport } = await import("../src/import-parse");
    const read = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
    const pack = planImport(parseImport(read("pack.md"), "markdown"));
    const review = planImport(parseImport(read("review.csv"), "csv"));
    if (pack.kind !== "prose" || review.kind !== "records") throw new Error(`unexpected plans ${pack.kind} ${review.kind}`);
    const keys = pack.sections.map((s) => sectionKey(s.heading));
    expect(keys).toEqual(["Q3", "Q7", "Q9", "Q12", "Q16", "Q18", "Q23", "Q31", "Q40", "Q49", "Q56", "Q62"]);
    const cited = review.records.map((r) => citationsOf(r.values));
    expect(cited.find((c) => c.includes("Q56"))).toEqual(["Q56", "Q16", "Q49"]);
    expect(cited.flat().filter((code) => !keys.includes(code))).toEqual(["Q41"]);
  });
});
