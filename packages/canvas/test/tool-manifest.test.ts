import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { manifestJson, toolDefs } from "../tools/tool-defs";

describe("hosted tool manifest", () => {
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
