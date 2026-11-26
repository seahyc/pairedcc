import { describe, expect, it } from "vitest";
import { isDerivedField, onlyDerivedChange } from "../src/revision";

// Store updates keep unchanged values by reference, as tldraw's do.
const richText = { type: "doc" };
const card = (h: number, extra: Record<string, unknown> = {}) => ({
  id: "shape:a", type: "card", x: 0, y: 0, props: { w: 240, h, richText, tone: "agent" }, meta: { revision: 3 }, ...extra,
});

describe("derived fields", () => {
  it("are the revision counter, the text-edit timestamp and a card's auto-sized height", () => {
    expect(isDerivedField("card", "props.h")).toBe(true);
    expect(isDerivedField("geo", "props.h")).toBe(false);
    expect(isDerivedField("geo", "meta.revision")).toBe(true);
    expect(isDerivedField("geo", "meta.updatedAt")).toBe(true);
    expect(isDerivedField("card", "props.w")).toBe(false);
  });

  it("a card re-measuring its height is not a change anyone made", () => {
    expect(onlyDerivedChange(card(82), card(105))).toBe(true);
    expect(onlyDerivedChange(card(82), { ...card(105), meta: { revision: 3, updatedAt: 5 } })).toBe(true);
  });

  it("anything else is a real change", () => {
    expect(onlyDerivedChange(card(82), card(82, { x: 10 }))).toBe(false);
    expect(onlyDerivedChange(card(82), { ...card(82), props: { ...card(82).props, w: 300 } })).toBe(false);
    expect(onlyDerivedChange(card(82), { ...card(82), meta: { revision: 3, name: "renamed" } })).toBe(false);
    expect(onlyDerivedChange(card(82), { ...card(82), props: { ...card(82).props, richText: { type: "doc", content: [] } } })).toBe(false);
    const geo = { ...card(82), type: "geo" };
    expect(onlyDerivedChange(geo, { ...geo, props: { ...geo.props, h: 120 } })).toBe(false);
  });
});
