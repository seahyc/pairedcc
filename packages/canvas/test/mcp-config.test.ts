import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localMcpConfig } from "../src/mcp-config";

describe("local MCP configuration shown in Agent access", () => {
  const dir = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

  it("points at this checkout's tsx and MCP entry point, and both exist", () => {
    const { command, args } = localMcpConfig(dir, "abc").mcpServers.paired;
    expect(command).toBe("node");
    expect(args).toEqual([`${dir}/node_modules/tsx/dist/cli.mjs`, `${dir}/tools/mcp.ts`]);
    for (const path of args) expect(existsSync(path), path).toBe(true);
  });

  it("targets the tab's session", () => {
    expect(localMcpConfig(dir, "abc").mcpServers.paired.env).toEqual({ PAIRED_SESSION: "abc" });
  });

  it("tolerates a trailing slash", () => {
    const { args } = localMcpConfig("/srv/checkout/packages/canvas/", "").mcpServers.paired;
    expect(args[1]).toBe("/srv/checkout/packages/canvas/tools/mcp.ts");
  });
});
