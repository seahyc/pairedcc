import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "tldraw";
import { executeCommand } from "../src/agent-operations";
import { PROTOTYPE_OPS, canvasReturnTo, prototypeEnabled, prototypeRefusal } from "../src/prototype-flags";
import { commandSchema } from "../src/protocol";

// An editor that fails the test if a refused operation reaches it.
const untouchable = new Proxy({} as Editor, {
  get(_, key) {
    throw new Error(`the editor was used (${String(key)})`);
  },
});

describe("prototype flags", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a tab's prototype flags, and only those, through sign-in", () => {
    expect(canvasReturnTo("")).toBe("/canvas/");
    expect(canvasReturnTo("?prototype=data")).toBe("/canvas/?prototype=data");
    expect(canvasReturnTo("?prototype=data&prototype=converge&x=1")).toBe("/canvas/?prototype=data&prototype=converge");
    expect(canvasReturnTo("?next=//evil.example")).toBe("/canvas/");
  });

  it("reads each flag from the tab's query string", () => {
    expect(prototypeEnabled("data", "?prototype=data")).toBe(true);
    expect(prototypeEnabled("learning", "?prototype=data&prototype=learning")).toBe(true);
    expect(prototypeEnabled("data", "")).toBe(false);
    expect(prototypeEnabled("data", "?prototype=learning")).toBe(false);
  });

  it("gates every data, learning and converge operation, and nothing else", () => {
    expect(Object.keys(PROTOTYPE_OPS).sort()).toEqual(["cell", "chart", "chart_state", "converge", "dataset", "learn"]);
    for (const op of commandSchema.shape.op.options) {
      const refusal = prototypeRefusal(op, "");
      if (op in PROTOTYPE_OPS) expect(refusal, op).toMatch(/is off in this tab\. Nothing was changed\..*\?prototype=(data|learning|converge)/);
      else expect(refusal, op).toBeNull();
    }
    expect(prototypeRefusal("chart", "?prototype=data")).toBeNull();
    expect(prototypeRefusal("learn", "?prototype=data")).toContain("?prototype=learning");
    expect(prototypeRefusal("learn", "?prototype=learning")).toBeNull();
  });

  it("refuses a prototype operation in an unflagged tab before touching the board", async () => {
    vi.stubGlobal("location", { search: "" });
    for (const op of ["dataset", "chart", "chart_state", "cell", "learn"] as const)
      await expect(executeCommand(untouchable, { op, input: {} }, "Agent")).rejects.toThrow(/is off in this tab/);
  });

  it("lets a flagged tab run the operation", async () => {
    vi.stubGlobal("location", { search: "?prototype=data" });
    // It now reaches the operation itself, which uses the editor.
    const error = await executeCommand(untouchable, { op: "dataset", input: {} }, "Agent").catch((e: Error) => e);
    expect(String(error)).not.toContain("off in this tab");
  });
});
