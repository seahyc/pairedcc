import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

// Checks the feedback tools over the real stdio MCP server against an open canvas:
// reads the queue, replies to the first open comment and resolves it, then reopens it.
// Leaves the reply on the board. Set PAIRED_SESSION when several tabs are open.

const client = new Client({ name: "paired-feedback-check", version: "1.0.0" });
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url)), fileURLToPath(new URL("./mcp.ts", import.meta.url))],
    env,
  }),
);
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  const text = result.content.find((c) => c.type === "text");
  assert.ok(text && text.type === "text");
  return JSON.parse(text.text);
}
const names = (await client.listTools()).tools.map((t) => t.name);
assert.ok(names.includes("canvas_feedback") && names.includes("canvas_reply"), "feedback tools are listed");
const queue = await call("canvas_feedback", { status: "open" });
console.log("counts", JSON.stringify(queue.counts));
const comment = queue.items.find((i: { kind: string }) => i.kind === "comment");
assert.ok(comment, "leave an open comment on the board first (press C)");
const replied = await call("canvas_reply", { id: comment.id, text: "Read over MCP. Checking the feedback loop." });
assert.equal(replied.item.replies.at(-1).text, "Read over MCP. Checking the feedback loop.");
await call("canvas_resolve", { id: comment.id, expectedRevision: replied.item.revision, status: "resolved" });
const after = await call("canvas_feedback", {});
const resolved = after.items.find((i: { id: string }) => i.id === comment.id);
assert.equal(resolved.status, "resolved");
assert.equal(resolved.resolvedBy, "MCP agent");
await call("canvas_resolve", { id: comment.id, expectedRevision: resolved.revision, status: "open" });
console.log(`MCP feedback check passed: read ${queue.items.length} open items, replied to and resolved "${comment.text}", then reopened it.`);
await client.close();
process.exit(0);
