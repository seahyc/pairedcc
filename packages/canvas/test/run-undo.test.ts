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
  it("ignores the text-edit timestamp the canvas stamps on its own", () => {
    expect(changedPaths(shape("a"), shape("a", {}, {}, { updatedAt: 1764148926000 }))).toEqual([]);
    expect(changedPaths(shape("a"), shape("a", {}, { color: "red" }, { updatedAt: 1764148926000 }))).toEqual(["props.color"]);
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
  it("does not write to an object the person locked after the run", () => {
    const before = shape("shape:a"), after = shape("shape:a", {}, { color: "violet" });
    const plan = planUndo(diff({ updated: { [before.id]: [before, after] } }), store(shape("shape:a", { isLocked: true }, { color: "violet" })));
    expect(plan.put).toEqual([]);
    expect(plan.conflicts).toEqual([{ id: "shape:a", reason: "locked after the run changed it" }]);
  });
  it("puts back what the run deleted, pages before shapes before bindings", () => {
    const page = { id: "page:2", typeName: "page", name: "P", index: "a1", meta: {} };
    const s = shape("shape:a", { parentId: "page:2" });
    const binding = { id: "binding:1", typeName: "binding", type: "arrow", fromId: "shape:x", toId: "shape:a", props: {}, meta: {} };
    // The arrow's other end (shape:x) still exists on the board.
    const plan = planUndo(diff({ removed: { [binding.id]: binding, [s.id]: s, [page.id]: page } }), store(shape("shape:x")));
    expect(plan.put.map((r) => r.id)).toEqual(["page:2", "shape:a", "binding:1"]);
    expect(planUndo(diff({ removed: { [s.id]: s } }), store(s)).conflicts[0].reason).toMatch(/recreated/);
  });
  it("refuses to put back a shape whose frame was deleted since, rather than leave an orphan", () => {
    const frame = shape("shape:frame", { type: "frame" });
    const child = shape("shape:child", { parentId: "shape:frame" });
    // The run deleted the child; the person then deleted the frame.
    const plan = planUndo(diff({ removed: { [child.id]: child } }), store());
    expect(plan.put).toEqual([]);
    expect(plan.conflicts).toEqual([{ id: "shape:child", reason: "its parent shape:frame was deleted after the run" }]);
    // Restoring the frame in the same undo is fine, and so is a parent that still exists.
    const page1 = { id: "page:1", typeName: "page" } as unknown as ReturnType<typeof shape>;
    expect(planUndo(diff({ removed: { [child.id]: child, [frame.id]: frame } }), store(page1)).conflicts).toEqual([]);
    expect(planUndo(diff({ removed: { [child.id]: child } }), store(frame)).conflicts).toEqual([]);
  });
  it("refuses to put back an arrow binding whose other end is gone", () => {
    const binding = { id: "binding:1", typeName: "binding", type: "arrow", fromId: "shape:arrow", toId: "shape:gone", props: {}, meta: {} };
    const plan = planUndo(diff({ removed: { [binding.id]: binding } }), store(shape("shape:arrow")));
    expect(plan.conflicts).toEqual([{ id: "binding:1", reason: "it connects shape:gone, which was deleted after the run" }]);
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

import { createRunLedger, summariseRun, type AgentRun } from "../src/agent-runs";
describe("whose runs an agent sees", () => {
  const run = (runId: string, actor: string): AgentRun => ({ runId, op: "update", actor, at: "2026-11-26T10:00:00Z", changes: diff({}), undone: false });
  it("lists only the calling agent's runs, newest first", () => {
    const ledger = createRunLedger();
    ledger.add(run("r1", "Agent A"));
    ledger.add(run("r2", "Agent B"));
    ledger.add(run("r3", "Agent A"));
    expect(ledger.list(10, "Agent A").map((r) => r.runId)).toEqual(["r3", "r1"]);
    expect(ledger.list(1, "Agent A").map((r) => r.runId)).toEqual(["r3"]);
    expect(ledger.list(10).map(summariseRun).map((r) => r.runId)).toEqual(["r3", "r2", "r1"]);
  });
});
