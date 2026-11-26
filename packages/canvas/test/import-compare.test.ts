import { describe, expect, it } from "vitest";
import { fieldSlots, planSideBySide, type RecordBox } from "../src/import-compare";

// Five records of one import, stacked as the importer lays them out: same x, 40 px apart.
const stack = (heights: number[], importId = "import:a", x = 100): RecordBox[] => {
  let y = 200;
  return heights.map((h, i) => {
    const box = { id: `r${i}`, importId, x, y, w: 1200, h };
    y += h + 40;
    return box;
  });
};
const apply = (records: RecordBox[], plan: ReturnType<typeof planSideBySide>) => {
  if (!plan.ok) throw new Error(plan.reason);
  return records.map((r) => {
    const m = plan.moves.find((move) => move.id === r.id);
    return m ? { ...r, x: r.x + m.dx, y: r.y + m.dy } : r;
  });
};
const overlaps = (a: RecordBox, b: RecordBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("planSideBySide", () => {
  it("moves the lower record directly under the upper one and slides the ones between down", () => {
    const records = stack([200, 150, 260, 180, 220]);
    const plan = planSideBySide(records, "r3", "r0");
    expect(plan.ok && [plan.upper, plan.lower]).toEqual(["r0", "r3"]);
    const after = apply(records, plan);
    const byId = Object.fromEntries(after.map((r) => [r.id, r]));
    // r3 now sits where r1 was: right under r0, with the usual gap.
    expect(byId.r3.y).toBe(records[1].y);
    expect(byId.r3.x).toBe(byId.r0.x);
    // Order down the page is now r0, r3, r1, r2, r4.
    expect([...after].sort((a, b) => a.y - b.y).map((r) => r.id)).toEqual(["r0", "r3", "r1", "r2", "r4"]);
    // Nothing overlaps, and the record after the pair did not move.
    for (const a of after) for (const b of after) if (a !== b) expect(overlaps(a, b)).toBe(false);
    expect(byId.r4).toEqual(records[4]);
    // The usual gap survives between every pair.
    const sorted = [...after].sort((a, b) => a.y - b.y);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].y - (sorted[i - 1].y + sorted[i - 1].h)).toBe(40);
  });

  it("does nothing when the two are already next to each other", () => {
    const records = stack([200, 150, 260]);
    const plan = planSideBySide(records, "r1", "r2");
    expect(plan.ok && plan.moves).toEqual([]);
  });

  it("lines a record that was dragged sideways back up with the other", () => {
    const records = stack([200, 150]);
    records[1] = { ...records[1], x: 160 };
    const plan = planSideBySide(records, "r0", "r1");
    expect(plan.ok && plan.moves).toEqual([{ id: "r1", dx: -60, dy: 0 }]);
  });

  it("refuses records from two different imports, and anything but two", () => {
    const records = [...stack([200, 150]), ...stack([100], "import:b", 2000).map((r) => ({ ...r, id: "other" }))];
    expect(planSideBySide(records, "r0", "other")).toEqual({ ok: false, reason: "Side by side works on two records from the same import." });
    expect(planSideBySide(records, "r0", "r0").ok).toBe(false);
    expect(planSideBySide(records, "r0", "missing").ok).toBe(false);
  });

  it("only slides records of the same import that sit between the two", () => {
    const records = [...stack([200, 150, 260]), { id: "elsewhere", importId: "import:a", x: 3000, y: 450, w: 400, h: 100 }];
    const plan = planSideBySide(records, "r0", "r2");
    expect(plan.ok && plan.moves.map((m) => m.id).sort()).toEqual(["r1", "r2"]);
  });
});

describe("fieldSlots (review of #55: blank cells must not shift columns)", () => {
  const records = [
    { fields: [{ column: "Objection" }, { column: "Fix" }] }, // no Defence
    { fields: [{ column: "Objection" }, { column: "Defence" }, { column: "Fix" }] },
  ];
  it("gives each column one slot for the whole import, in column order", () => {
    const slots = fieldSlots(records, ["No.", "Objection", "Defence", "Fix", "Severity"]);
    expect(slots.columns).toEqual(["Objection", "Defence", "Fix"]);
    expect(slots.place("Fix")).toEqual({ col: 2, row: 0 });
    expect(slots.place("Defence")).toEqual({ col: 1, row: 0 });
  });
  it("wraps every fifth column onto the next row, the same for every record", () => {
    const wide = [{ fields: ["a", "b", "c", "d", "e"].map((column) => ({ column })) }];
    const slots = fieldSlots(wide, ["a", "b", "c", "d", "e"]);
    expect(slots.place("e")).toEqual({ col: 0, row: 1 });
    expect(slots.perRow).toBe(4);
  });
});

describe("planSideBySide never overlaps (review of #55)", () => {
  it("puts a record dragged beside the other at the same height below it instead of on top", () => {
    const records: RecordBox[] = [
      { id: "a", importId: "i", x: 100, y: 200, w: 1200, h: 200 },
      { id: "b", importId: "i", x: 1400, y: 200, w: 1200, h: 150 },
      { id: "c", importId: "i", x: 100, y: 440, w: 1200, h: 100 },
    ];
    const after = apply(records, planSideBySide(records, "a", "b"));
    const byId = Object.fromEntries(after.map((r) => [r.id, r]));
    expect(byId.b.x).toBe(100);
    expect(byId.b.y).toBeGreaterThanOrEqual(400);
    for (const p of after) for (const q of after) if (p !== q) expect(overlaps(p, q)).toBe(false);
  });

  it("with uneven gaps, the records that slide down never land on the next one", () => {
    const records: RecordBox[] = [
      { id: "r0", importId: "i", x: 0, y: 0, w: 1000, h: 100 },
      { id: "r1", importId: "i", x: 0, y: 400, w: 1000, h: 100 },
      { id: "r2", importId: "i", x: 0, y: 520, w: 1000, h: 100 },
      { id: "r3", importId: "i", x: 0, y: 850, w: 1000, h: 300 },
    ];
    const after = apply(records, planSideBySide(records, "r0", "r2"));
    expect([...after].sort((p, q) => p.y - q.y).map((r) => r.id)).toEqual(["r0", "r2", "r1", "r3"]);
    for (const p of after) for (const q of after) if (p !== q) expect(overlaps(p, q)).toBe(false);
  });
});
