import { describe, expect, it } from "vitest";
import { summariseRun, type AgentRun } from "../src/agent-runs";
import { defaultDuplicateOffset, duplicateInput } from "../src/composition";

describe("canvas_duplicate default offset", () => {
  it("puts the copy just right of the originals instead of a fixed 320", () => {
    expect(defaultDuplicateOffset([{ x: 0, w: 600 }])).toBe(640);
    expect(defaultDuplicateOffset([{ x: 100, w: 200 }, { x: 500, w: 240 }])).toBe(680);
    expect(defaultDuplicateOffset([])).toBe(320);
  });
  it("still honours an explicit offset", () => {
    const input = duplicateInput.parse({ objects: [{ id: "shape:a", expectedRevision: 0 }], offsetX: 320 });
    expect(input.offsetX).toBe(320);
    expect(duplicateInput.parse({ objects: [{ id: "shape:a", expectedRevision: 0 }] }).offsetX).toBeUndefined();
  });
});

describe("canvas_runs", () => {
  it("names the fields each run changed on each object, leaving out derived ones", () => {
    const from = { id: "shape:a", typeName: "shape", type: "geo", x: 0, y: 0, props: { color: "blue", w: 100 }, meta: { revision: 1 } };
    const to = { ...from, props: { color: "red", w: 100 }, meta: { revision: 2 } };
    const run: AgentRun = { runId: "r1", op: "update", actor: "Agent", at: "2026-11-26T11:00:00.000Z", undone: false, changes: { added: {}, removed: {}, updated: { "shape:a": [from, to] } } as never };
    expect(summariseRun(run).fields).toEqual({ "shape:a": ["props.color"] });
  });
});
