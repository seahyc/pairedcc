// Live check of overview reads and per-run undo over HTTP and MCP stdio.
// Start the dev server (pnpm dev:canvas) with no canvas tab open, then:
//   node --import tsx tools/verify-runs.ts
// It opens its own headless tab (the "human"), which it closes at the end.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

const base = "http://localhost:5183";
// Playwright is preinstalled on the machine, not a package dependency, so type only what is used.
type Page = {
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: () => boolean, arg: null, options: { timeout: number }): Promise<unknown>;
  evaluate<R, A>(fn: (arg: A) => R, arg?: A): Promise<R>;
};
const { chromium } = createRequire(import.meta.url)("playwright") as {
  chromium: { launch(): Promise<{ newPage(o: object): Promise<Page>; close(): Promise<void> }> };
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${base}/canvas/`);
await page.waitForFunction(() => Boolean(window.paired), null, { timeout: 30_000 });
const sessionId = await page.evaluate(() => document.documentElement.dataset.pairedSession!);
const log = (step: string, detail: unknown = "") => console.log(`✓ ${step}`, typeof detail === "string" ? detail : JSON.stringify(detail));

type Obj = { id: string; revision: number; [k: string]: unknown };
async function http(op: string, input: unknown = {}) {
  const r = await fetch(`${base}/api/canvas/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: randomUUID(), sessionId, actor: "Runs check", command: { op, input } }),
  });
  const j = (await r.json()) as { ok: boolean; result?: any; error?: string };
  return j;
}
async function ok(op: string, input: unknown = {}) {
  const j = await http(op, input);
  assert.equal(j.ok, true, `${op}: ${j.error}`);
  return j.result;
}
const human = <T>(fn: "create" | "update", arg: unknown) =>
  page.evaluate(([fn, arg]: [string, unknown]) => (window.paired as unknown as Record<string, (a: unknown) => unknown>)[fn](arg), [fn, arg]) as Promise<T>;
const count = async () => (await ok("overview", { limit: 1 })).counts.objects as number;

try {
  // ── HTTP ─────────────────────────────────────────────
  await ok("page", { name: "Runs check" });
  const scene = await ok("scene", {
    name: "Three options",
    nodes: [
      { key: "f", shape: { kind: "frame", x: 0, y: 0, width: 900, height: 360, name: "Options" } },
      { key: "a", parentKey: "f", shape: { kind: "note", x: 40, y: 80, text: "Option A: a long note whose text runs well past the eighty character snippet limit of the overview" } },
      { key: "b", parentKey: "f", shape: { kind: "note", x: 320, y: 80, text: "Option B" } },
      { key: "c", parentKey: "f", shape: { kind: "note", x: 600, y: 80, text: "Option C" } },
    ],
    connections: [{ fromKey: "a", toKey: "b" }],
  });
  const ids = Object.fromEntries(Object.entries(scene.objects as Record<string, Obj>).map(([k, v]) => [k, v.id]));

  const top = await ok("overview");
  const frame = top.objects.find((o: Obj) => o.id === ids.f);
  assert.equal(frame.children, 4, "three notes and their arrow");
  assert.equal(top.objects.some((o: Obj) => o.id === ids.a), false, "children are not at the top level");
  assert.equal("props" in frame || "meta" in frame, false, "overview stays compact");
  log("overview lists the top level only, with child counts", { total: top.total, frame: { name: frame.name, children: frame.children }, counts: top.counts });
  const p1 = await ok("overview", { parentId: ids.f, limit: 3 });
  const p2 = await ok("overview", { parentId: ids.f, limit: 3, cursor: p1.nextCursor });
  assert.equal(p1.objects.length, 3);
  assert.equal(p2.objects.length, 1);
  assert.equal(p2.nextCursor, undefined);
  const a = [...p1.objects, ...p2.objects].find((o: Obj) => o.id === ids.a);
  assert.ok(a.text.length <= 80 && a.text.endsWith("…"));
  log("overview paginates a frame's children and truncates text", { page1: p1.objects.length, cursor: p1.nextCursor, page2: p2.objects.length, snippet: a.text });
  const detail = await ok("read", { ids: [ids.a] });
  assert.equal(detail.objects.length, 1);
  log("read with ids returns detail for just that object", { text: detail.objects[0].text.slice(0, 30) + "…" });

  const humanRect = await human<string>("create", { kind: "rectangle", x: 1000, y: 0, text: "Human's own box" });
  const bNow = (await ok("read", { ids: [ids.b] })).objects[0] as Obj;
  await ok("update", { id: ids.b, expectedRevision: bNow.revision, text: "Option B, revised" });
  const runs = (await ok("runs")).runs;
  assert.deepEqual(runs.slice(0, 2).map((r: { op: string }) => r.op), ["update", "scene"]);
  const sceneRun = runs[1], updateRun = runs[0];
  assert.equal(sceneRun.created.length, 7, "frame, three notes, an arrow and its two end bindings");
  log("runs lists each agent operation with the objects it touched", runs.slice(0, 2).map((r: any) => ({ op: r.op, created: r.created.length, updated: r.updated.length })));

  const before = await count();
  const blocked = await http("undo_run", { runId: sceneRun.runId });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error!, /changed after the run created it \(props\.richText\)/);
  assert.equal(await count(), before, "a rejected undo changes nothing");
  log("undoing the scene is rejected while a later edit depends on it", blocked.error);

  const undone = await ok("undo_run", { runId: updateRun.runId });
  assert.equal((await ok("read", { ids: [ids.b] })).objects[0].text, "Option B");
  log("undo_run reverts just the text edit", { restored: undone.restored });
  const undoneScene = await ok("undo_run", { runId: sceneRun.runId });
  const after = await ok("overview");
  assert.deepEqual(after.objects.map((o: Obj) => o.id), [humanRect], "only the human's box remains");
  log("undo_run removes the whole scene in one step; the human's box survives", { removed: undoneScene.removedNow.length, remaining: after.objects.map((o: any) => o.name) });
  const again = await http("undo_run", { runId: sceneRun.runId });
  assert.match(again.error!, /already been undone/);
  log("a run cannot be undone twice", again.error);


  // ── MCP stdio ────────────────────────────────────────
  const env: Record<string, string> = { PAIRED_SESSION: sessionId };
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  const client = new Client({ name: "paired-runs-check", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url)), fileURLToPath(new URL("./mcp.ts", import.meta.url))],
    env,
  }));
  const mcp = async (name: string, args: Record<string, unknown> = {}) => {
    const r = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
    const t = r.content.find((c) => c.type === "text");
    return { isError: r.isError === true, value: t && t.type === "text" ? (r.isError ? t.text : JSON.parse(t.text)) : undefined };
  };
  const names = (await client.listTools()).tools.map((t) => t.name);
  for (const n of ["canvas_overview", "canvas_runs", "canvas_undo_run"]) assert.ok(names.includes(n), n);
  log("MCP lists canvas_overview, canvas_runs and canvas_undo_run");
  const mOverview = await mcp("canvas_overview");
  assert.equal(mOverview.isError, false);
  log("MCP overview", { total: mOverview.value.total });
  const m1 = (await mcp("canvas_create", { kind: "note", x: 0, y: 500, text: "MCP note one" })).value as Obj;
  const m2 = (await mcp("canvas_create", { kind: "note", x: 400, y: 500, text: "MCP note two" })).value as Obj;
  const m1Now = (await mcp("canvas_get", { id: m1.id })).value as Obj;
  await human("update", { id: m1.id, expectedRevision: m1Now.revision, x: 60 }); // the person moves note one
  const mRuns = (await mcp("canvas_runs", { limit: 2 })).value.runs;
  assert.deepEqual(mRuns.map((r: any) => r.created.includes(m2.id) ? "m2" : r.created.includes(m1.id) ? "m1" : "?"), ["m2", "m1"]);
  const mBlocked = await mcp("canvas_undo_run", { runId: mRuns[1].runId });
  assert.equal(mBlocked.isError, true);
  assert.match(String(mBlocked.value), /\(x\)/);
  log("MCP undo of a note the person has since moved is rejected", String(mBlocked.value));
  const mUndo = await mcp("canvas_undo_run", { runId: mRuns[0].runId });
  assert.equal(mUndo.isError, false);
  const still = (await mcp("canvas_overview")).value.objects.map((o: Obj) => o.id);
  assert.ok(still.includes(m1.id) && !still.includes(m2.id));
  log("MCP undo removes note two only; the moved note one stays", { remaining: still.length });
  await client.close();
  console.log("All run and overview checks passed.");
} finally {
  await browser.close();
}
