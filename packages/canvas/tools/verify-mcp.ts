import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
const client = new Client({
  name: "paired-integration-check",
  version: "1.0.0",
});
const env: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env))
  if (value !== undefined) env[key] = value;
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url)),
    fileURLToPath(new URL("./mcp.ts", import.meta.url)),
  ],
  env,
});
await client.connect(transport);
const object = z.object({ id: z.string(), revision: z.number() });
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = CallToolResultSchema.parse(
    await client.callTool({ name, arguments: args }),
  );
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  const text = result.content.find((c) => c.type === "text");
  return {
    result,
    value: text && text.type === "text" ? JSON.parse(text.text) : undefined,
  };
}
let id: string | undefined;
const fixtures = new Set<string>();
try {
  const tools = await client.listTools();
  assert.ok(tools.tools.some((t) => t.name === "canvas_image"));
  assert.ok(tools.tools.some((t) => t.name === "canvas_screenshot"));
  for (const name of ["canvas_scene", "canvas_arrange", "canvas_duplicate"])
    assert.ok(tools.tools.some(t => t.name === name));
  await call("canvas_read");
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="100"><rect width="180" height="100" rx="12" fill="#6f5ec7"/><text x="20" y="55" fill="white">MCP round trip</text></svg>';
  const created = await call("canvas_image", {
    x: 3000,
    y: 3000,
    width: 180,
    height: 100,
    name: "Temporary MCP image",
    src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  });
  const image = object.parse(created.value);
  id = image.id;
  const get = await call("canvas_get", { id, includeAsset: true });
  assert.equal(get.value.asset.props.mimeType, "image/svg+xml");
  const screenshot = await call("canvas_screenshot", { ids: [id] });
  assert.ok(screenshot.result.content.some((c) => c.type === "image"));
  const composed = await call("canvas_scene", {
    name: "Temporary MCP composition check",
    nodes: [
      { key: "a", shape: { kind: "rectangle", x: 4000, y: 4000, text: "Evidence", font: "mono", size: "s", fill: "none" } },
      { key: "b", shape: { kind: "rectangle", x: 4400, y: 4000, text: "Hypothesis" } },
    ],
    connections: [{ fromKey: "a", toKey: "b", label: "supports" }],
  });
  const scene = z.object({ objects: z.record(z.string(), object), connections: z.array(object) }).parse(composed.value);
  for (const value of [...Object.values(scene.objects), ...scene.connections]) fixtures.add(value.id);
  const guarded = (value: z.infer<typeof object>) => ({ id: value.id, expectedRevision: value.revision });
  const duplicated = await call("canvas_duplicate", { objects: [...Object.values(scene.objects), ...scene.connections].map(guarded), offsetX: 0, offsetY: 500 });
  const copies = z.object({ objects: z.array(object) }).parse(duplicated.value);
  for (const value of copies.objects) fixtures.add(value.id);
  assert.equal(copies.objects.length, 3);
  const copiedRead = await call("canvas_read", { ids: copies.objects.map(value => value.id) });
  const copiedIds = new Set(copies.objects.map(value => value.id));
  const bindings = z.object({ bindings: z.array(z.object({ fromId: z.string(), toId: z.string() })) }).parse(copiedRead.value).bindings;
  const copiedBindings = bindings.filter(binding => copiedIds.has(binding.fromId));
  assert.equal(copiedBindings.length, 2);
  assert.ok(copiedBindings.every(binding => copiedIds.has(binding.toId)), "Copied arrows must bind copied objects");
  const current = await call("canvas_read", { ids: Object.values(scene.objects).map(value => value.id) });
  const originals = z.object({ objects: z.array(object) }).parse(current.value);
  await call("canvas_arrange", { objects: originals.objects.map(guarded), layout: "column", x: 4000, y: 4000, gap: 30 });
  console.log(
    `PASS: MCP stdio handshake, ${tools.tools.length} tools, live image/PNG, scene composition, connected duplication and layout`,
  );
} finally {
  for (const fixture of fixtures) {
    const current = await call("canvas_read", { ids: [fixture] });
    const [remaining] = z.object({ objects: z.array(object) }).parse(current.value).objects;
    if (remaining) await call("canvas_remove", guardedCleanup(remaining));
  }
  if (id) {
    const current = await call("canvas_get", { id });
    const obj = object.parse(current.value);
    await call("canvas_remove", { id, expectedRevision: obj.revision });
  }
  await client.close();
}
function guardedCleanup(value: z.infer<typeof object>) {
  return { id: value.id, expectedRevision: value.revision };
}
