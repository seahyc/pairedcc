import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { commandSchema } from "../src/protocol";
import { instructions, sessionIdInput, toolDefs } from "./tool-defs";

// Local stdio MCP server for a canvas running on this computer (pnpm dev:canvas).
// The hosted equivalent is https://paired.cc/mcp.

const base = process.env.PAIRED_URL ?? "http://localhost:5183";
const parsedBase = new URL(base);
if (!["localhost", "127.0.0.1", "[::1]"].includes(parsedBase.hostname))
  throw new Error("PAIRED_URL must be a local loopback URL");
// Attribution for this agent's work and ownership of its runs. Set PAIRED_ACTOR to tell
// several local agents apart; agents sharing a label share runs.
const actor = process.env.PAIRED_ACTOR?.trim().slice(0, 80) || "MCP agent";

const server = new McpServer({ name: "paired-canvas", version: "0.1.0" }, { instructions });

async function request(command: z.infer<typeof commandSchema>, sessionId?: string) {
  const response = await fetch(`${base}/api/canvas/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: randomUUID(),
      sessionId: sessionId ?? process.env.PAIRED_SESSION,
      actor,
      command,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const raw: unknown = await response.json();
  const result = z
    .object({ ok: z.boolean().optional(), result: z.unknown().optional(), error: z.string().optional() })
    .parse(raw);
  if (!response.ok || result.ok === false)
    throw new Error(result.error ?? `Canvas API returned ${response.status}`);
  return result.result;
}
async function sessions() {
  const response = await fetch(`${base}/api/canvas/sessions`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Canvas API returned ${response.status}`);
  return response.json();
}
const failure = (error: unknown): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: error instanceof Error ? error.message : "Canvas request failed" }],
});

for (const tool of toolDefs) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.op ? { ...sessionIdInput, ...tool.input } : tool.input },
    async (args: Record<string, unknown>): Promise<CallToolResult> => {
      try {
        if (!tool.op) return { content: [{ type: "text", text: JSON.stringify(await sessions()) }] };
        const { sessionId, ...input } = args as { sessionId?: string };
        const command = commandSchema.parse({ op: tool.op, input });
        const result = await request(command, sessionId);
        if (tool.output === "image") {
          const image = z.object({ data: z.string(), mimeType: z.literal("image/png") }).parse(result);
          return { content: [{ type: "image", data: image.data, mimeType: image.mimeType }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (error) {
        return failure(error);
      }
    },
  );
}
await server.connect(new StdioServerTransport());
