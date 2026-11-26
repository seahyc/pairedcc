import { describe, expect, it } from "vitest";
import { summariseRun, type AgentRun } from "../src/agent-runs";
import { chooseDuplicateOffset, duplicateInput } from "../src/composition";

describe("canvas_duplicate default offset", () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  it("puts the copy just right of the originals instead of a fixed 320", () => {
    expect(chooseDuplicateOffset([{ box: box(0, 0, 600, 300) }])).toEqual({ x: 640, y: 0 });
    expect(chooseDuplicateOffset([{ box: box(100, 0, 200, 50) }, { box: box(500, 0, 240, 50) }])).toEqual({ x: 680, y: 0 });
    expect(chooseDuplicateOffset([])).toEqual({ x: 320, y: 0 });
  });
  it("keeps copies inside the frame that will still hold them: below when beside would leave it, refused when neither fits", () => {
    const frame = box(0, 0, 1200, 800);
    // Two children 180 wide at x 40 and 640: beside would put the second at x 1460, past the frame.
    expect(chooseDuplicateOffset([{ box: box(40, 80, 180, 120), container: frame }, { box: box(640, 80, 180, 120), container: frame }])).toEqual({ x: 0, y: 160 });
    // A child that fills the frame: no room anywhere.
    expect(chooseDuplicateOffset([{ box: box(20, 20, 1100, 700), container: frame }])).toBeNull();
    // Room beside: beside wins.
    expect(chooseDuplicateOffset([{ box: box(40, 80, 180, 120), container: frame }])).toEqual({ x: 220, y: 0 });
  });
  it("still honours an explicit offset", () => {
    const input = duplicateInput.parse({ objects: [{ id: "shape:a", expectedRevision: 0 }], offsetX: 320 });
    expect(input.offsetX).toBe(320);
    const bare = duplicateInput.parse({ objects: [{ id: "shape:a", expectedRevision: 0 }] });
    expect([bare.offsetX, bare.offsetY]).toEqual([undefined, undefined]);
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
