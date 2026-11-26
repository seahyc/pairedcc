import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hostedPrototypeTools, instructions, manifestJson, toolDefs, toolManifest } from "../tools/tool-defs";

describe("hosted tool manifest", () => {
  it("never offers an agent a field that sets authorship (the canvas attributes every write to the caller)", () => {
    const manifest = JSON.parse(manifestJson());
    for (const tool of manifest.tools) expect(Object.keys(tool.inputSchema.properties ?? {}), tool.name).not.toContain("author");
  });
  it("matches the tool definitions (run pnpm --filter @pairedcc/canvas manifest)", () => {
    const committed = readFileSync(new URL("../../server/src/canvas/tool-manifest.json", import.meta.url), "utf8");
    expect(committed).toBe(manifestJson());
  });
  it("gives every operation tool an optional sessionId", () => {
    const manifest = JSON.parse(manifestJson());
    for (const tool of manifest.tools.filter((t: { op: string | null }) => t.op))
      expect(tool.inputSchema.properties.sessionId).toBeDefined();
    expect(manifest.tools).toHaveLength(toolDefs.length);
  });
});

describe("prototype tool switch", () => {
  const prototypes = toolDefs.filter((t) => t.prototype).map((t) => t.name);

  it("flags exactly the tools whose descriptions say PROTOTYPE", () => {
    expect(prototypes).toEqual(toolDefs.filter((t) => t.description.includes("PROTOTYPE")).map((t) => t.name));
    expect(prototypes).toEqual(["canvas_learn", "canvas_dataset", "canvas_chart", "canvas_chart_state", "canvas_cell"]);
  });

  it("keeps today's behaviour by default: the hosted manifest offers every tool", () => {
    expect(hostedPrototypeTools).toBe(true);
    expect(toolManifest().tools.map((t) => t.name)).toEqual(toolDefs.map((t) => t.name));
    expect(toolManifest().instructions).toBe(instructions);
  });

  it("leaves prototype tools and their guidance out of the hosted manifest when switched off", () => {
    const off = toolManifest(false);
    expect(off.tools.map((t) => t.name).filter((n) => prototypes.includes(n))).toEqual([]);
    expect(off.tools).toHaveLength(toolDefs.length - prototypes.length);
    expect(off.instructions).not.toMatch(/prototype|canvas_chart|inputs: \[chartId\]/i);
    expect(instructions.startsWith(off.instructions)).toBe(true);
    expect(JSON.parse(manifestJson(false))).toEqual(off);
  });
});
