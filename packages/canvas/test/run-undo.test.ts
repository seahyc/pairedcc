import { describe, expect, it } from "vitest";
import { changedPaths, documentDiff, isEmptyDiff, planUndo, type RunDiff } from "../src/run-undo";

const shape = (id: string, over: Record<string, unknown> = {}, props: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
  id, typeName: "shape", type: "geo", x: 0, y: 0, parentId: "page:1", props: { w: 100, h: 100, color: "black", ...props }, meta: { revision: 1, ...meta }, ...over,
});
const store = (...recs: ReturnType<typeof shape>[]) => {
  const m = new Map(recs.map((r) => [r.id, r]));
  return (id: string) => m.get(id);
};
const diff = (d: Partial<RunDiff>): RunDiff => ({ added: {}, updated: {}, removed: {}, ...d });

describe("changed fields", () => {
  it("lists top-level, props and meta differences and ignores the revision counter", () => {
    expect(changedPaths(shape("a"), shape("a", { x: 5 }, { color: "red" }, { revision: 7, name: "n" })).sort()).toEqual(["meta.name", "props.color", "x"]);
  });
  it("ignores auto-sized card height", () => {
    expect(changedPaths(shape("c", { type: "card" }), shape("c", { type: "card" }, { h: 140 }))).toEqual([]);
  });
});

describe("planning the undo of one agent run", () => {
  it("removes objects the run created when nobody has touched them", () => {
    const created = shape("shape:a");
    const plan = planUndo(diff({ added: { [created.id]: created } }), store({ ...created, meta: { revision: 9 } }));
    expect(plan).toEqual({ put: [], remove: ["shape:a"], conflicts: [] });
  });
  it("restores only the fields the run changed, keeping a human's later edits to other fields", () => {
    const before = shape("shape:a"), after = shape("shape:a", {}, { color: "violet" });
    const now = shape("shape:a", { x: 300 }, { color: "violet" }); // human moved it afterwards
    const plan = planUndo(diff({ updated: { [before.id]: [before, after] } }), store(now));
    expect(plan.conflicts).toEqual([]);
    expect(plan.put).toEqual([shape("shape:a", { x: 300 }, { color: "black" })]);
  });
  it("rejects the whole undo when a human changed a field the run changed", () => {
    const created = shape("shape:new");
    const before = shape("shape:a"), after = shape("shape:a", { x: 50 });
    const plan = planUndo(
      diff({ added: { [created.id]: created }, updated: { [before.id]: [before, after] } }),
      store(created, shape("shape:a", { x: 80 })),
    );
    expect(plan.put).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.conflicts).toEqual([{ id: "shape:a", reason: "changed again after the run", fields: ["x"] }]);
  });
  it("rejects when a created object has since been edited, or a changed one deleted", () => {
    const created = shape("shape:a");
    expect(planUndo(diff({ added: { [created.id]: created } }), store(shape("shape:a", {}, { color: "red" }))).conflicts[0]).toMatchObject({ id: "shape:a", fields: ["props.color"] });
    const b = shape("shape:b");
    expect(planUndo(diff({ updated: { [b.id]: [b, { ...b, x: 1 }] } }), store()).conflicts[0].reason).toMatch(/deleted/);
  });
  it("puts back what the run deleted, pages before shapes before bindings", () => {
    const page = { id: "page:2", typeName: "page", name: "P", index: "a1", meta: {} };
    const s = shape("shape:a", { parentId: "page:2" });
    const binding = { id: "binding:1", typeName: "binding", type: "arrow", fromId: "shape:x", toId: "shape:a", props: {}, meta: {} };
    const plan = planUndo(diff({ removed: { [binding.id]: binding, [s.id]: s, [page.id]: page } }), store());
    expect(plan.put.map((r) => r.id)).toEqual(["page:2", "shape:a", "binding:1"]);
    expect(planUndo(diff({ removed: { [s.id]: s } }), store(s)).conflicts[0].reason).toMatch(/recreated/);
  });
  it("removes created bindings before created shapes", () => {
    const s = shape("shape:a");
    const binding = { id: "binding:1", typeName: "binding", type: "arrow", props: {}, meta: {} };
    const m = new Map<string, any>([[s.id, s], [binding.id, binding]]);
    expect(planUndo(diff({ added: { [s.id]: s, [binding.id]: binding } }), (id) => m.get(id)).remove).toEqual(["binding:1", "shape:a"]);
  });
});

describe("document diff", () => {
  it("drops per-tab records such as camera, pointer and selection", () => {
    const d = documentDiff(diff({
      added: { "shape:a": shape("shape:a") },
      updated: { "camera:1": [{ id: "camera:1", typeName: "camera" }, { id: "camera:1", typeName: "camera", x: 1 }], "instance_page_state:1": [{ id: "i", typeName: "instance_page_state" }, { id: "i", typeName: "instance_page_state" }] },
    }));
    expect(Object.keys(d.added)).toEqual(["shape:a"]);
    expect(d.updated).toEqual({});
    expect(isEmptyDiff(documentDiff(diff({ updated: { "camera:1": [{ id: "camera:1", typeName: "camera" }, { id: "camera:1", typeName: "camera" }] } })))).toBe(true);
  });
});
