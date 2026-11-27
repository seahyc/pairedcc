import { describe, it, expect } from "vitest";
import { CALM_PAGE_ID, calmSeedIds, chosenPageName } from "../src/calm-ids";
import { mergeSnapshots } from "../src/board-sync";

const snap = (store: Record<string, unknown>) => ({ store, schema: {} }) as never;

describe("the calm board laid out on two devices", () => {
  it("gives the same page and card ids on every device, distinct per page", () => {
    expect(calmSeedIds(CALM_PAGE_ID)).toEqual(calmSeedIds(CALM_PAGE_ID));
    const a = Object.values(calmSeedIds("page:one")), b = Object.values(calmSeedIds("page:two"));
    expect(new Set([...a, ...b]).size).toBe(6);
    for (const id of a) expect(id).toMatch(/^shape:/);
  });
  it("merges into one Thinking page and one set of cards, though each device placed them for its own screen", () => {
    const older = { "page:older": { typeName: "page", id: "page:older", name: "Pricing" } };
    const layout = (x: number) => ({
      ...older,
      [CALM_PAGE_ID]: { typeName: "page", id: CALM_PAGE_ID, name: "Thinking" },
      ...Object.fromEntries(Object.values(calmSeedIds(CALM_PAGE_ID)).map((id) => [id, { typeName: "shape", id, parentId: CALM_PAGE_ID, x }])),
    });
    const { snapshot } = mergeSnapshots(snap(older), snap(layout(120)), snap(layout(24)));
    const records = Object.values((snapshot as { store: Record<string, { typeName: string; name?: string }> }).store);
    expect(records.filter((r) => r.typeName === "page" && r.name === "Thinking")).toHaveLength(1);
    expect(records.filter((r) => r.typeName === "shape")).toHaveLength(3);
  });
});

describe("a page's name", () => {
  it("is kept when someone chose it", () => {
    expect(chosenPageName("Launch plan")).toBe(true);
    expect(chosenPageName("Board 12 ideas")).toBe(true);
  });
  it("is a default for tldraw's Page 1, the canvas's Board 1, or nothing", () => {
    expect(chosenPageName("Page 1")).toBe(false);
    expect(chosenPageName("Board 3")).toBe(false);
    expect(chosenPageName("  ")).toBe(false);
  });
});
