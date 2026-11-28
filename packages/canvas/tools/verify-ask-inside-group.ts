// Browser check for item 131 (P2, "about everything over here"; principles row 3): a question
// written on the empty space inside a group is about that group. The person lays out twelve notes
// as a ring (a 4 × 4 square with its middle empty), each 40 px from the next, and writes a question
// in the middle, more than the 60 px group gap from every note. The ask must give the whole ring as
// its group, with where each note sits, and the board outlines the ring while the ask is worked on.
// A question outside the ring is given no group. Inside a frame holding more than the frame
// context's twelve objects, the ring past that cap is still given as the group. Starts its own
// dev server (port 5194) unless PAIRED_URL is set:
//   node --import tsx tools/verify-ask-inside-group.ts [screenshot dir]
import { launch, mcpAgent, openCanvas, startServer, until } from "../eval/lib";

const out = process.argv[2] ?? ".";
const server = process.env.PAIRED_URL ? undefined : await startServer(5194, true);
const base = process.env.PAIRED_URL ?? server!.base;
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail: unknown = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : "  — " + JSON.stringify(detail)}`); };
const browser = await launch();
try {
  const { context, page, session, errors } = await openCanvas(browser, base);
  const agent = await mcpAgent(base, session, "Verifier");
  const ev = (fn: string, arg?: unknown) => page.evaluate(`(${fn})(window.paired, window.__pairedEditor, ${JSON.stringify(arg ?? null)})`);
  const idOf = (r: any) => (typeof r === "string" ? r : r.id);
  await agent.call("canvas_page", { name: "Ring" });
  const words = ["Cost", "Speed", "Risk", "Team", "Users", "Legal", "Brand", "Data", "Ops", "Sales", "Support", "Hiring"];
  const ids: string[] = [];
  for (const w of words) ids.push(idOf(await ev("(p, e, text) => p.create({ kind: 'note', x: 0, y: 0, width: 160, text })", w)));
  // Lay them out as the ring, measured, so each sits 40 px from the next whatever size a note is.
  const size: any = await ev("(p, e, ids) => ids.reduce((m, id) => { const b = e.getShapePageBounds(id); return { w: Math.max(m.w, b.w), h: Math.max(m.h, b.h) }; }, { w: 0, h: 0 })", ids);
  const cells = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [0, 3], [0, 2], [0, 1]];
  await ev("(p, e, a) => a.ids.forEach((id, i) => { const s = e.getShape(id); e.updateShape({ id, type: s.type, x: a.cells[i][0] * (a.w + 40), y: a.cells[i][1] * (a.h + 40) }); })", { ids, cells, w: size.w, h: size.h });
  const mid = { x: 2 * (size.w + 40) - 20, y: 2 * (size.h + 40) - 20 };
  const q = idOf(await ev("(p, e, a) => p.create({ kind: 'note', x: 0, y: 0, width: 120, text: 'What is missing here?' })", null));
  // Centre the question in the empty middle.
  await ev("(p, e, a) => { const b = e.getShapePageBounds(a.q), s = e.getShape(a.q); e.updateShape({ id: a.q, type: s.type, x: a.mid.x - b.w / 2, y: a.mid.y - b.h / 2 }); }", { q, mid });
  const gaps: number[] = await ev("(p, e, a) => { const q = e.getShapePageBounds(a.q); return a.ids.map((id) => { const b = e.getShapePageBounds(id); return Math.round(Math.hypot(Math.max(0, b.x - q.maxX, q.x - b.maxX), Math.max(0, b.y - q.maxY, q.y - b.maxY))); }); }", { q, ids });
  check("the question sits in the ring's empty middle, beyond the group gap from every note", Math.min(...gaps) > 60, { nearest: Math.min(...gaps) });
  await ev("(p, e, id) => void p.select([id])", q);
  await page.keyboard.press("ControlOrMeta+Enter");
  const view: any = await until(async () => (await agent.call("canvas_asks", { state: "all" })).asks.find((a: any) => a.id === q), "the ask");
  const given = [...(view.targets ?? []), ...(view.cluster ?? [])].map((m: any) => m.id);
  const inRing = given.filter((id) => ids.includes(id)).length;
  check("the ask is given the ring as its group (members listed, the rest counted)", (view.cluster ?? []).length > 0 && (view.cluster ?? []).every((m: any) => ids.includes(m.id)) && inRing + (view.clusterMore ?? 0) === ids.length, { listed: inRing, more: view.clusterMore, group: view.group });
  const top = (view.cluster ?? []).find((m: any) => m.id === ids[1]), bottom = (view.cluster ?? []).find((m: any) => m.id === ids[8]);
  check("each note says where it sits from the question", (view.cluster ?? []).length > 0 && (!top || top.relation === "above") && (!bottom || bottom.relation === "under") && (view.cluster ?? []).every((m: any) => typeof m.relation === "string"), view.cluster?.slice(0, 4).map((m: any) => [m.text, m.relation]));
  await agent.call("canvas_ask_status", { id: q, state: "working", note: "reading the ring" });
  await ev("(p, e) => void e.selectNone()");
  await ev("(p, e, ids) => void e.zoomToBounds(e.getShapesPageBounds(ids), { inset: 80, immediate: true })", ids);
  await page.waitForTimeout(500);
  const drawn: any = await ev("(p, e, ids) => { const el = document.querySelector('.ask-group'); if (!el) return { ok: false, why: 'no group outline' }; const r = el.getBoundingClientRect(); const inside = (id) => { const b = e.getShapePageBounds(id), a = e.pageToScreen({ x: b.x, y: b.y }), z = e.pageToScreen({ x: b.maxX, y: b.maxY }); return a.x >= r.left - 2 && a.y >= r.top - 2 && z.x <= r.right + 2 && z.y <= r.bottom + 2; }; return { ok: ids.every(inside), r: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; }", ids);
  check("while it is worked on, the board outlines the whole ring", drawn.ok, drawn);
  await page.screenshot({ path: `${out}/ask-inside-group.png` });
  // A question outside the ring is not about it.
  const outside = idOf(await ev("(p, e, x) => p.create({ kind: 'note', x, y: 0, width: 160, text: 'Lunch order?' })", 4 * (size.w + 40) + 400));
  await ev("(p, e, id) => void p.select([id])", outside);
  await page.keyboard.press("ControlOrMeta+Enter");
  const view2: any = await until(async () => (await agent.call("canvas_asks", { state: "all" })).asks.find((a: any) => a.id === outside), "the outside ask");
  check("a question outside the ring is given no group", !(view2.cluster ?? []).some((m: any) => ids.includes(m.id)), view2.cluster);
  // The same ring inside a frame that holds more than the frame context's twelve objects: twelve
  // unrelated notes first in the frame's order, then the ring. The frame context gives the twelve;
  // the ring is still given as the group (eight listed with relations, the rest counted), and
  // nothing the frame context gave is repeated in it.
  await agent.call("canvas_page", { name: "Framed ring" });
  const ring2: string[] = [];
  for (const w of words) ring2.push(idOf(await ev("(p, e, text) => p.create({ kind: 'note', x: 0, y: 0, width: 160, text })", w)));
  await ev("(p, e, a) => a.ids.forEach((id, i) => { const s = e.getShape(id); e.updateShape({ id, type: s.type, x: a.cells[i][0] * (a.w + 40), y: a.cells[i][1] * (a.h + 40) }); })", { ids: ring2, cells, w: size.w, h: size.h });
  const loose: string[] = [];
  const looseWords = ["Paint", "Tiles", "Lamp", "Rug", "Sofa", "Desk", "Shelf", "Plant", "Clock", "Mirror", "Vase", "Bench"];
  for (const [i, w] of looseWords.entries()) loose.push(idOf(await ev("(p, e, a) => p.create({ kind: 'note', x: a.x, y: a.y, width: 160, text: a.w })", { w, x: (i % 6) * (size.w + 120), y: 4 * (size.h + 40) + 200 + Math.floor(i / 6) * (size.h + 120) })));
  const q3 = idOf(await ev("(p, e) => p.create({ kind: 'note', x: 0, y: 0, width: 120, text: 'What is missing here?' })"));
  await ev("(p, e, a) => { const b = e.getShapePageBounds(a.q), s = e.getShape(a.q); e.updateShape({ id: a.q, type: s.type, x: a.mid.x - b.w / 2, y: a.mid.y - b.h / 2 }); }", { q: q3, mid });
  const frameId = idOf(await ev("(p, e, a) => p.create({ kind: 'frame', x: -120, y: -120, width: a.w, height: a.h, name: 'Living room' })", { w: 6 * (size.w + 120) + 240, h: 4 * (size.h + 40) + 200 + 2 * (size.h + 120) + 240 }));
  // In this order, so the unrelated notes come first among the frame's children.
  await ev("(p, e, a) => { e.reparentShapes(a.loose, a.frame); e.reparentShapes(a.ring, a.frame); e.reparentShapes([a.q], a.frame); }", { loose, ring: ring2, q: q3, frame: frameId });
  const order: string[] = await ev("(p, e, f) => e.getSortedChildIdsForParent(f)", frameId);
  check("the frame holds the twelve unrelated notes first, then the ring and the question", order.length === 25 && loose.every((id) => order.indexOf(id) < 12) && ring2.every((id) => order.includes(id)) && order.includes(q3), { children: order.length });
  await ev("(p, e, id) => void p.select([id])", q3);
  await page.keyboard.press("ControlOrMeta+Enter");
  const view3: any = await until(async () => (await agent.call("canvas_asks", { state: "all" })).asks.find((a: any) => a.id === q3), "the framed ask");
  const sent = (view3.frame?.objects ?? []).map((o: any) => o.id);
  const cl3 = view3.cluster ?? [];
  check("the frame context gives its twelve objects (the unrelated notes)", sent.length === 12 && sent.every((id: string) => loose.includes(id)), { frame: sent.length });
  check("beyond the frame's cap, the ask is still given the ring: eight listed with relations, the rest counted", cl3.length === 8 && cl3.every((m: any) => ring2.includes(m.id) && typeof m.relation === "string") && cl3.length + (view3.clusterMore ?? 0) === ring2.length, { listed: cl3.length, more: view3.clusterMore, group: view3.group });
  check("what the frame context gave is not repeated in the group", !cl3.some((m: any) => sent.includes(m.id)));
  // The person leaves out the ring note nearest the question. It is withheld before the cap, so the
  // next shareable note takes its place: still eight listed, and three (not four) counted.
  const ringGaps: number[] = await ev("(p, e, a) => { const q = e.getShapePageBounds(a.q); return a.ids.map((id) => { const b = e.getShapePageBounds(id); return Math.hypot(Math.max(0, b.x - q.maxX, q.x - b.maxX), Math.max(0, b.y - q.maxY, q.y - b.maxY)); }); }", { q: q3, ids: ring2 });
  const nearest = ring2[ringGaps.indexOf(Math.min(...ringGaps))];
  await ev("(p, e, id) => { const s = e.getShape(id); e.updateShape({ id, type: s.type, meta: { ...s.meta, leftOut: true } }); }", nearest);
  const view4: any = (await agent.call("canvas_asks", { state: "all" })).asks.find((a: any) => a.id === q3);
  const cl4 = view4?.cluster ?? [];
  check("a left-out ring note frees its slot: eight shareable notes listed, three counted", cl4.length === 8 && !cl4.some((m: any) => m.id === nearest) && cl4.every((m: any) => ring2.includes(m.id)) && view4.clusterMore === 3, { listed: cl4.length, more: view4?.clusterMore, leftOutListed: cl4.some((m: any) => m.id === nearest) });
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
