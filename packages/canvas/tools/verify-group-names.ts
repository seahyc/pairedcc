// Live check for item 124 (P2, what was left: named regions beyond frames). The person's pile of
// cards has a title card on top; agents get the pile's name from canvas_overview's clusters and
// from an ask in it (`group`), the same label the overview (O) shows, never the ask's own words.
// Starts its own dev server (port 5195) unless PAIRED_URL is set:
//   node --import tsx tools/verify-group-names.ts [screenshot dir]
import { launch, mcpAgent, openCanvas, startServer, until } from "../eval/lib";

const server = process.env.PAIRED_URL ? undefined : await startServer(5195, true);
const base = process.env.PAIRED_URL ?? server!.base;
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail: unknown = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : "  — " + JSON.stringify(detail)}`); };
const browser = await launch();
try {
  const { context, page, session, errors } = await openCanvas(browser, base);
  const agent = await mcpAgent(base, session, "Verifier");
  const ev = (fn: string, arg?: unknown) => page.evaluate(`(${fn})(window.paired, window.__pairedEditor, ${JSON.stringify(arg ?? null)})`);
  await agent.call("canvas_page", { name: "Group names" });
  const make = async (x: number, y: number, text: string) => { const r: any = await ev("(p, e, a) => p.create({ kind: 'note', x: a.x, y: a.y, width: 220, text: a.text })", { x, y, text }); return typeof r === "string" ? r : r.id; };
  // The question sits at the pile's top left, where reading order would name the pile after it.
  const question = await make(0, 0, "Which of these would you test first?");
  const title = await make(260, 0, "Pricing ideas");
  const a = await make(260, 140, "Charge per seat");
  const b = await make(520, 140, "Charge per job post");
  const far = await make(2200, 0, "Office move in March");
  await ev("(p, e, id) => void p.select([id])", question);
  await page.keyboard.press("ControlOrMeta+Enter");
  const ask = await until(async () => (await agent.call("canvas_asks", { state: "all" })).asks.find((x: any) => x.id === question), "the ask");
  check("an ask in the pile says what the pile is called", ask.group === "Pricing ideas", { group: ask.group, cluster: ask.cluster?.map((m: any) => m.text) });
  check("and its members are still given, without the far card", [title, a, b].every((id) => ask.cluster?.some((m: any) => m.id === id) || ask.targets?.some((t: any) => t.id === id)) && !ask.cluster?.some((m: any) => m.id === far));
  const ov = await agent.call("canvas_overview", {});
  const pile = ov.clusters.find((c: any) => c.ids.includes(a));
  check("canvas_overview names the same pile, not after the question in it", pile?.label === "Pricing ideas", pile && { label: pile.label, count: pile.count });
  // In the overview the pile includes the question card, which is first in reading order; the
  // overview box (O) shows the same label for the same members.
  await page.keyboard.press("Escape");
  await ev("(p, e) => void e.selectNone()");
  await page.keyboard.press("o");
  await page.waitForTimeout(400);
  const labels: string[] = await ev("() => [...document.querySelectorAll('.overview-box, [class*=overview] button')].map((el) => el.textContent?.trim() ?? '')");
  if (process.argv[2]) await page.screenshot({ path: `${process.argv[2]}/group-names-overview.png` });
  check("the overview (O) shows that label on a box", labels.some((l) => l.includes(pile?.label ?? "\u0000")), { label: pile?.label, boxes: labels.slice(0, 6) });
  // Item 132: a question written across a frame's edge is lifted onto the page (#155), where its
  // only neighbour is the frame. It sits in the frame's group: the ask says so, and
  // canvas_overview names that cluster after the frame, not after the question.
  await page.keyboard.press("Escape");
  await agent.call("canvas_page", { name: "Group names, lifted" });
  const frameMade: any = await ev("(p) => p.create({ kind: 'frame', x: 0, y: 0, width: 620, height: 360, name: 'Kitchen quotes' })");
  const frame = typeof frameMade === "string" ? frameMade : frameMade.id;
  const inFrame = async (x: number, y: number, width: number, text: string) =>
    ev("(p, e, a) => { const r = p.create({ kind: 'note', x: a.x, y: a.y, width: a.width, text: a.text }); const id = typeof r === 'string' ? r : r.id; e.reparentShapes([id], a.frame); return id; }", { x, y, width, text, frame }) as Promise<string>;
  await inFrame(30, 50, 170, "Oakline Joinery: £8,400");
  await inFrame(220, 50, 170, "Brook & Sons: £7,250");
  const lifted = await inFrame(400, 300, 260, "Which of these quotes is cheapest?");
  await ev("(p, e, id) => void p.select([id])", lifted);
  await page.keyboard.press("ControlOrMeta+Enter");
  const liftedAsk = await until(async () => (await agent.call("canvas_asks", { state: "all" })).asks.find((x: any) => x.id === lifted), "the lifted ask");
  const where: any = await ev("(p, e, id) => { const s = e.getShape(id); return { onPage: s.parentId === e.getCurrentPageId(), within: s.meta.within ?? null }; }", lifted);
  check("a question across the frame's edge is lifted onto the page", where.onPage && where.within === frame, where);
  check("its ask says it sits in the frame's group", liftedAsk.group === "Kitchen quotes", { group: liftedAsk.group, frame: liftedAsk.frame?.name });
  const ov2 = await agent.call("canvas_overview", {});
  const withFrame = ov2.clusters.find((c: any) => c.ids.includes(lifted));
  check("canvas_overview names that cluster after the frame, not the question", withFrame?.label === "Kitchen quotes", withFrame && { label: withFrame.label, ids: withFrame.ids.length });
  // Review of #179: an unnamed shape (a rectangle with no words) as the lifted question's only
  // neighbour on the page does not name its group "Untitled": the question is in the frame's group.
  await page.keyboard.press("Escape");
  await agent.call("canvas_page", { name: "Group names, lifted beside a shape" });
  const frame3: any = await ev("(p) => p.create({ kind: 'frame', x: 0, y: 0, width: 620, height: 360, name: 'Kitchen quotes' })");
  const frame3Id = typeof frame3 === "string" ? frame3 : frame3.id;
  await ev("(p, e, a) => { const r = p.create({ kind: 'note', x: 30, y: 50, width: 170, text: 'Oakline Joinery: £8,400' }); e.reparentShapes([typeof r === 'string' ? r : r.id], a); }", frame3Id);
  await ev("(p) => p.create({ kind: 'rectangle', x: 630, y: 300, width: 120, height: 80 })");
  const lifted3: string = await ev("(p, e, a) => { const r = p.create({ kind: 'note', x: 400, y: 300, width: 260, text: 'Which of these quotes is cheapest?' }); const id = typeof r === 'string' ? r : r.id; e.reparentShapes([id], a); return id; }", frame3Id) as string;
  await ev("(p, e, id) => void p.select([id])", lifted3);
  await page.keyboard.press("ControlOrMeta+Enter");
  const ask3 = await until(async () => (await agent.call("canvas_asks", { state: "all" })).asks.find((x: any) => x.id === lifted3), "the ask beside a shape");
  check("an unnamed neighbour does not name the lifted question's group", ask3.group === "Kitchen quotes", { group: ask3.group, cluster: ask3.cluster?.map((m: any) => m.type) });
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
