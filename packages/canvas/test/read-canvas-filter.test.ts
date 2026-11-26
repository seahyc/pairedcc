import { describe, expect, it } from "vitest";
import { toRichText, type Editor, type TLShape } from "tldraw";
import { readCanvas } from "../src/agent-operations";

// The filter as `read` applies it, not only the helper: one filter, over rich text and the name.
const card = (id: string, text: string, name?: string) =>
  ({ id: `shape:${id}`, type: "card", typeName: "shape", parentId: "page:page", x: 0, y: 0, rotation: 0, opacity: 1, isLocked: false, meta: name ? { name } : {}, props: { w: 200, richText: toRichText(text), tone: "note" } }) as unknown as TLShape;
const shapes = [card("a", "कला"), card("b", "आज कल"), card("c", "Hauptstraße 5"), card("d", "かぐ"), card("e", "plain", "Café regulars")];
const known: Record<string, unknown> = {
  getCurrentPageShapesSorted: () => shapes,
  getCurrentPageShapes: () => shapes,
  getShape: (id: string) => shapes.find((s) => s.id === id),
  getShapePageBounds: () => undefined,
  getCurrentPage: () => ({ id: "page:page", name: "Page 1" }),
  getCurrentPageId: () => "page:page",
};
const editor = new Proxy({}, { get: (_, key: string) => known[key] ?? (() => []) }) as unknown as Editor;
const found = (text: string) => readCanvas(editor, { text }).objects.map((o) => o.id);

describe("read's text filter, through readCanvas", () => {
  it("matches whole characters only", () => {
    expect(found("कल")).toEqual(["shape:b"]);
    expect(found("かく")).toEqual([]);
  });
  it("folds ß to ss and still ignores accents, in text and in names", () => {
    expect(found("STRASSE")).toEqual(["shape:c"]);
    expect(found("cafe")).toEqual(["shape:e"]);
  });
  it("gives everything when there is no filter", () => {
    expect(readCanvas(editor).objects).toHaveLength(shapes.length);
  });
});
