// Live check for item 118 (a) and (b), friction from the 28-task agent attempt (#159):
// canvas_overview gives the person's mark, a card's style, settled and what a chart shows, so
// tasks like 06, 16 and 26 need no full read; canvas_runs names the objects each run touched.
// Starts its own dev server (port 5199) unless PAIRED_URL is set:
//   node --import tsx tools/verify-agent-friction-3.ts
import { launch, mcpAgent, openCanvas, startServer } from "../eval/lib";

const server = process.env.PAIRED_URL ? undefined : await startServer(5199, true);
const base = process.env.PAIRED_URL ?? server!.base;
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail: unknown = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : "  — " + JSON.stringify(detail)}`); };
const browser = await launch();
try {
  const { context, page, session } = await openCanvas(browser, base, "?prototype=data");
  const agent = await mcpAgent(base, session);
  const person = (fn: string, arg?: unknown) => page.evaluate(`(${fn})(window.paired, window.__pairedEditor, ${JSON.stringify(arg ?? null)})`);
  await agent.call("canvas_page", { name: "Friction 3" });
  const a = await agent.call("canvas_create", { kind: "note", x: 0, y: 0, text: "Slow mornings" });
  const b = await agent.call("canvas_create", { kind: "note", x: 400, y: 0, text: "Good coffee, no rush" });
  const q = await agent.call("canvas_create", { kind: "note", x: 800, y: 0, text: "“Nobody reads the menu.”", style: "quote" });
  await person("(p, e, id) => { const s = e.getShape(id); e.updateShape({ id, type: s.type, meta: { ...s.meta, mark: 'picked' } }); }", b.id);
  await person("(p, e, id) => { const s = e.getShape(id); e.updateShape({ id, type: s.type, meta: { ...s.meta, mark: 'rejected' } }); }", a.id);
  const ds = await agent.call("canvas_dataset", { x: 0, y: 400, synthetic: "orders" });
  const ch = await agent.call("canvas_chart", { x: 520, y: 400, datasetId: ds.id, state: { x: "region", y: "orders", filter: { product: ["Tea"] } } });
  const ov = await agent.call("canvas_overview", {});
  const row = (id: string) => ov.objects.find((o: any) => o.id === id);
  check("overview gives the person's pick and cross-out", row(b.id)?.mark === "picked" && row(a.id)?.mark === "rejected" && !("mark" in row(q.id)), { b: row(b.id)?.mark, a: row(a.id)?.mark });
  check("overview gives a card's style", row(q.id)?.style === "quote" && row(b.id)?.style === "note", { q: row(q.id)?.style, b: row(b.id)?.style });
  check("overview says what a chart shows, filter included", /Tea/.test(row(ch.id)?.chart?.summary ?? ""), row(ch.id)?.chart);
  const read = await agent.call("canvas_read", { ids: [ch.id] });
  check("and it is the same line read's widget gives", row(ch.id)?.chart?.summary === read.objects[0]?.widget?.summary);
  const before = await agent.call("canvas_get", { id: b.id });
  await agent.call("canvas_update", { id: b.id, expectedRevision: before.revision, x: 420 });
  const runs = (await agent.call("canvas_runs", { page: "current" })).runs;
  const recolour = runs.find((r: any) => r.op === "update"), made = runs.find((r: any) => r.created?.includes(q.id));
  check("runs name the objects each run touched", recolour?.names?.[b.id] === "Good coffee, no rush" && made?.names?.[q.id]?.includes("Nobody reads the menu"), { update: recolour?.names, create: made?.names });
  const bytes = JSON.stringify(ov).length;
  console.log(`overview ${bytes} bytes for ${ov.objects.length} objects`);
  await agent.close();
  await context.close();
} finally {
  await browser.close();
  server?.stop();
}
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
