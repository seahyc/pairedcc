// Browser check for item 130, friction from #172's focused attempt on tasks 30 and 31: an agent
// gets a folded thread's pick and a settled thought's next review without a full read.
// (a) The person asks, an agent answers with two options, the person picks one and moves on, so
// the thread folds; `canvas_overview` and `canvas_read` give the ask `pick` (the picked answer).
// (b) A settled thought the person checked themselves on gives `review`, an ISO date, in the
// overview, in read, and in an ask's targets; a settled thought nobody checked gives none.
// Starts its own dev server (port 5198) unless PAIRED_URL is set:
//   node --import tsx tools/verify-overview-pick-review.ts
import { launch, mcpAgent, openCanvas, startServer, until } from "../eval/lib";

const server = process.env.PAIRED_URL ? undefined : await startServer(5198, true);
const base = process.env.PAIRED_URL ?? server!.base;
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail: unknown = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : "  — " + JSON.stringify(detail)}`); };
const browser = await launch();
try {
  const { context, page, session, errors } = await openCanvas(browser, base);
  const agent = await mcpAgent(base, session, "Verifier");
  const ev = (fn: string, arg?: unknown) => page.evaluate(`(${fn})(window.paired, window.__pairedEditor, ${JSON.stringify(arg ?? null)})`);
  const idOf = (r: any) => (typeof r === "string" ? r : r.id);
  await ev("(p, e) => void e.setCamera({ x: 0, y: -1200, z: 1 })");
  const page2: any = await agent.call("canvas_page", { name: "Item 130" });
  void page2;

  // (a) A thread the person finishes by picking, then leaves: it folds.
  const ask = idOf(await ev("(p) => p.create({ kind: 'note', x: 0, y: 0, width: 260, text: 'Where should the offsite be?' })"));
  await ev("(p, e, id) => void p.select([id])", ask);
  await page.keyboard.press("ControlOrMeta+Enter");
  await until(async () => (await agent.call("canvas_asks", { state: "all" })).asks.some((a: any) => a.id === ask) || undefined, "the ask");
  const answered: any = await agent.call("canvas_answer", { id: ask, alternatives: ["Kraków: cheap flights, old town", "Lisbon: warm, but pricier"] });
  const [a, b] = answered.answers.map((o: any) => o.id);
  await ev("(p, e, id) => { const s = e.getShape(id); e.updateShape({ id, type: s.type, meta: { ...s.meta, mark: 'picked' } }); }", a);
  await ev("(p, e) => void e.selectNone()");
  await page.waitForTimeout(300);
  const ov: any = await agent.call("canvas_overview", {});
  const row = (id: string) => ov.objects.find((o: any) => o.id === id);
  check("the thread is folded", row(ask)?.folded === true, row(ask));
  check("overview gives the folded ask the person's pick", row(ask)?.pick?.id === a && /Kraków/.test(row(ask)?.pick?.text ?? ""), row(ask)?.pick);
  check("only on the ask, not on its answers", !("pick" in (row(a) ?? {})) && !("pick" in (row(b) ?? {})));
  const read: any = await agent.call("canvas_read", { ids: [ask] });
  check("read gives the pick too", read.objects?.[0]?.pick?.id === a, read.objects?.[0]?.pick);

  // (b) Two settled thoughts: one checked (it has a schedule), one never checked.
  const DAY = 86400000, due = Date.now() + 3 * DAY;
  const checked = idOf(await ev("(p) => p.create({ kind: 'note', x: 0, y: 600, width: 240, text: 'Hire for writing first' })"));
  const unchecked = idOf(await ev("(p) => p.create({ kind: 'note', x: 280, y: 600, width: 240, text: 'Interview in pairs' })"));
  await ev("(p, e, a) => { for (const [id, recall] of a) { const s = e.getShape(id); e.updateShape({ id, type: s.type, meta: { ...s.meta, settled: true, ...(recall ? { recall } : {}) } }); } }", [[checked, { step: 1, due }], [unchecked, null]]);
  const iso = new Date(due).toISOString();
  const ov2: any = await agent.call("canvas_overview", {});
  const row2 = (id: string) => ov2.objects.find((o: any) => o.id === id);
  check("overview gives a checked settled thought its next review as an ISO date", row2(checked)?.review === iso, row2(checked)?.review);
  check("and none for a settled thought nobody checked", row2(unchecked)?.settled === true && !("review" in row2(unchecked)), row2(unchecked));
  const read2: any = await agent.call("canvas_read", { ids: [checked] });
  check("read gives review too", read2.objects?.[0]?.review === iso);
  const q = idOf(await ev("(p, e, y) => p.create({ kind: 'note', x: 0, y, width: 300, text: 'Which comes back first?' })", 600 + 200));
  const qb: any = await ev("(p, e, a) => { const t = Math.max(...a.ids.map((id) => e.getShapePageBounds(id).maxY)); const s = e.getShape(a.q); e.updateShape({ id: a.q, type: s.type, y: t + 30 }); return t; }", { ids: [checked, unchecked], q });
  void qb;
  await ev("(p, e, id) => void p.select([id])", q);
  await page.keyboard.press("ControlOrMeta+Enter");
  const view: any = await until(async () => (await agent.call("canvas_asks", { state: "all" })).asks.find((x: any) => x.id === q), "the second ask");
  const givenChecked = [...(view.targets ?? []), ...(view.cluster ?? [])].find((m: any) => m.id === checked);
  check("an ask gives the review date with the thought", givenChecked?.review === iso, { targets: view.targets, cluster: view.cluster?.map((m: any) => [m.id, m.review]) });
  check("no page errors", errors.length === 0, errors.slice(0, 3));
  await agent.close();
  await context.close();
} finally {
  await browser.close();
  server?.stop();
}
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
