import { describe, expect, it } from "vitest";
import type { AgentRun } from "../src/agent-runs";
import { agentRunOf, relationships, relationshipsOf, sourceOf, transformationOf, type PrimitiveRecord } from "../src/primitives";

const text = (t: string) => ({ richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] } });
const board: PrimitiveRecord[] = [
  { id: "shape:ds", type: "dataset", meta: { createdBy: "MCP agent" }, props: { data: { source: "Synthetic, made up", version: 2 } } },
  { id: "shape:chart", type: "chart", meta: { createdBy: "MCP agent" }, props: { datasetId: "shape:ds", inputVersion: 1, state: { x: "region", y: "orders" } } },
  { id: "shape:note", type: "card", meta: { createdBy: "MCP agent", inputs: [{ id: "shape:chart", version: 3 }] } },
  { id: "shape:a", type: "geo", meta: { createdBy: "MCP agent" } },
  { id: "shape:b", type: "geo", meta: {} },
  { id: "shape:alt", type: "arrow", meta: { fromId: "shape:a", toId: "shape:b", relation: "alternative", createdBy: "MCP agent" }, props: text("cheaper") },
  { id: "shape:hand", type: "arrow", meta: {}, props: text("") },
  { id: "shape:loose", type: "arrow", meta: {} },
  { id: "shape:comment", type: "card", meta: { role: "annotation", author: "Human", targetId: "shape:a", targetIds: ["shape:a", "shape:b"] } },
  { id: "shape:pin", type: "arrow", meta: { fromId: "shape:comment", toId: "shape:a", relation: "feedback" } },
  { id: "shape:fb", type: "arrow", meta: { fromId: "shape:b", toId: "shape:a", relation: "feedback" } },
];

describe("Relationship", () => {
  const all = relationships(board, [
    { arrowId: "shape:hand", terminal: "start", toId: "shape:b" },
    { arrowId: "shape:hand", terminal: "end", toId: "shape:note" },
  ]);

  it("reads typed arrows, recorded inputs, chart datasets and annotation targets", () => {
    expect(all).toContainEqual({ kind: "alternative", from: "shape:a", to: "shape:b", via: "arrow", arrowId: "shape:alt", label: "cheaper", author: "MCP agent" });
    expect(all).toContainEqual({ kind: "derived-from", from: "shape:note", to: "shape:chart", via: "inputs", author: "MCP agent" });
    expect(all).toContainEqual({ kind: "depends-on", from: "shape:chart", to: "shape:ds", via: "chart" });
    expect(all.filter((r) => r.kind === "annotates").map((r) => r.to)).toEqual(["shape:a", "shape:b"]);
  });

  it("lists an annotation once, not again as its connector arrow, but keeps other feedback arrows", () => {
    expect(all.some((r) => r.arrowId === "shape:pin")).toBe(false);
    expect(all).toContainEqual({ kind: "feedback", from: "shape:b", to: "shape:a", via: "arrow", arrowId: "shape:fb" });
  });

  it("keeps a hand-drawn arrow as decorative and ignores an arrow bound to nothing", () => {
    expect(all).toContainEqual({ kind: "decorative", from: "shape:b", to: "shape:note", via: "arrow", arrowId: "shape:hand" });
    expect(all.some((r) => r.arrowId === "shape:loose")).toBe(false);
  });

  it("splits one object's relationships by direction", () => {
    const b = relationshipsOf("shape:b", all);
    expect(b.incoming.map((r) => r.kind).sort()).toEqual(["alternative", "annotates"]);
    expect(b.outgoing.map((r) => r.kind).sort()).toEqual(["decorative", "feedback"]);
  });
});

describe("Source", () => {
  it("keeps a dataset's origin and version, and marks agent output with no origin as generated", () => {
    expect(sourceOf(board[0])).toEqual({ objectId: "shape:ds", origin: "Synthetic, made up", version: 2, generated: false });
    expect(sourceOf({ id: "shape:x", type: "dataset", meta: { createdBy: "Agent" }, props: { data: { version: 0 } } })?.generated).toBe(true);
    expect(sourceOf({ id: "shape:i", type: "image", meta: { createdBy: "Agent", sourceUrl: "https://example.org/a.png" } })).toEqual({ objectId: "shape:i", url: "https://example.org/a.png", generated: false });
    expect(sourceOf({ id: "shape:i", type: "image", meta: { createdBy: "Agent" } })?.generated).toBe(true);
    expect(sourceOf(board[3])).toBeUndefined();
  });
});

describe("Transformation", () => {
  it("describes a chart as an aggregation of its dataset at the version it used, with its state as parameters", () => {
    expect(transformationOf(board[1])).toEqual({ output: "shape:chart", name: "aggregate", inputs: [{ id: "shape:ds", version: 1 }], parameters: { x: "region", y: "orders" } });
  });
  it("describes an object with recorded inputs as a derivation, and anything else as none", () => {
    expect(transformationOf(board[2])).toEqual({ output: "shape:note", name: "derive", inputs: [{ id: "shape:chart", version: 3 }] });
    expect(transformationOf(board[3])).toBeUndefined();
  });
});

describe("Agent run", () => {
  const run = (undone: boolean): AgentRun => ({
    runId: "run-1",
    op: "scene",
    actor: "MCP agent",
    at: "2026-11-26T10:00:00.000Z",
    undone,
    changes: { added: { "shape:n": {} }, updated: { "shape:a": {} }, removed: { "shape:old": {} } } as never,
  });
  it("is attributable, scoped to what it touched and reversible until undone", () => {
    expect(agentRunOf(run(false))).toEqual({
      runId: "run-1",
      request: "scene",
      actor: "MCP agent",
      at: "2026-11-26T10:00:00.000Z",
      scope: ["shape:n", "shape:a", "shape:old"],
      progress: "done",
      changes: { created: ["shape:n"], updated: ["shape:a"], removed: ["shape:old"] },
      reversible: true,
    });
    expect(agentRunOf(run(true))).toMatchObject({ progress: "undone", reversible: false });
  });
});
