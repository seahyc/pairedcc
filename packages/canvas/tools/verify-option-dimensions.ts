// Browser check for finding 6 (comparing beats describing): options laid out on the dimensions
// they differ on. The person writes a question and sends it; an agent answers over MCP with two
// alternatives and two dimensions. Each option card lists the dimensions in the same order under
// its headline, inside the card. Writes screenshots to the given directory (default: cwd).
// Starts its own dev server (port 5196) unless PAIRED_URL is set:
//   node --import tsx tools/verify-option-dimensions.ts [screenshot dir]
import { launch, mcpAgent, openCanvas, startServer, until } from "../eval/lib";

const out = process.argv[2] ?? ".";
const server = process.env.PAIRED_URL ? undefined : await startServer(5196, true);
const base = process.env.PAIRED_URL ?? server!.base;
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail: unknown = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : "  — " + JSON.stringify(detail)}`); };
const browser = await launch();
try {
  const { context, page, session, errors } = await openCanvas(browser, base);
  const agent = await mcpAgent(base, session, "Verifier");
  await page.screenshot({ path: `${out}/option-dimensions-first-screen.png` });
  const ev = (fn: string, arg?: unknown) => page.evaluate(`(${fn})(window.paired, window.__pairedEditor, ${JSON.stringify(arg ?? null)})`);
  await ev("(p, e) => void e.setCamera({ x: 0, y: -1200, z: 1 })");
  const made: any = await ev("(p) => p.create({ kind: 'note', x: 160, y: 1400, width: 260, text: 'Which pricing should we test first?' })");
  const ask = typeof made === "string" ? made : made.id;
  await ev("(p, e, id) => void p.select([id])", ask);
  await page.keyboard.press("ControlOrMeta+Enter");
  await until(async () => (await agent.call("canvas_asks", { state: "all" })).asks.some((a: any) => a.id === ask) || undefined, "the ask");
  const answered: any = await agent.call("canvas_answer", {
    id: ask,
    alternatives: ["Charge per seat", "Charge per job post, with a monthly cap so busy months stay predictable"],
    dimensions: ["Cost to try", "Risk"],
    values: [["Low: one settings change", "Churn when teams shrink"], ["Medium", "Lumpy revenue"]],
  });
  await ev("(p, e) => void e.selectNone()");
  const cards: any[] = await ev(`(p, e, ask) => e.getCurrentPageShapes().filter((s) => s.meta.replyTo === ask).sort((a, b) => a.x - b.x).map((s) => {
    const el = document.querySelector('[data-shape-id="' + s.id + '"]');
    const box = el?.getBoundingClientRect();
    const inner = el ? [...el.querySelectorAll('p')].map((q) => ({ text: q.textContent, bottom: q.getBoundingClientRect().bottom, right: q.getBoundingClientRect().right })) : [];
    const tops = Object.fromEntries([...el.querySelectorAll('p')].filter((q) => q.querySelector('strong')).map((q) => [q.querySelector('strong').textContent, Math.round(q.getBoundingClientRect().top)]));
    return { id: s.id, option: s.meta.option, lines: inner.map((q) => q.text).filter((t) => t), tops, fits: !!box && inner.every((q) => q.bottom <= box.bottom + 1 && q.right <= box.right + 1) };
  })`, ask);
  check("the answer is two lettered option cards", cards.length === 2 && cards[0].option === "A" && cards[1].option === "B", cards.map((c) => c.option));
  const dims = (c: any) => c.lines.slice(1).map((l: string) => l.split(":")[0]);
  check("each card lists the dimensions under its headline, in the same order", cards.every((c) => JSON.stringify(dims(c)) === JSON.stringify(["Cost to try", "Risk"])), cards.map((c) => c.lines));
  check("each value sits on its own card", /one settings change/.test(cards[0]?.lines.join(" ")) && /Lumpy revenue/.test(cards[1]?.lines.join(" ")));
  check("every line stays inside its card", cards.every((c) => c.fits));
  // B's headline wraps to more lines than A's; each dimension still sits at one height across the row.
  const aligned = ["Cost to try:", "Risk:"].every((d) => cards.length === 2 && cards[0].tops[d] !== undefined && Math.abs(cards[0].tops[d] - cards[1].tops[d]) <= 2);
  check("each dimension line sits at the same height on every option", aligned, cards.map((c) => c.tops));
  const status = await agent.call("canvas_asks", { state: "all" });
  check("the ask says answered", status.asks.find((a: any) => a.id === ask)?.state === "answered");
  const box: any = await ev(`(p, e, ask) => { const ids = [ask, ...e.getCurrentPageShapes().filter((s) => s.meta.replyTo === ask).map((s) => s.id)]; e.zoomToBounds(e.getShapesPageBounds ? e.getShapesPageBounds(ids) : e.getSelectionPageBounds(), { inset: 80, immediate: true }); return true; }`, ask);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/option-dimensions.png` });
  // A headline or value with blank lines in it still answers (review of #165: an empty text node failed the answer).
  const made2: any = await ev("(p) => p.create({ kind: 'note', x: 2400, y: 1400, width: 260, text: 'Which day should we close?' })");
  const ask2 = typeof made2 === "string" ? made2 : made2.id;
  await ev("(p, e, id) => void p.select([id])", ask2);
  await page.keyboard.press("ControlOrMeta+Enter");
  await until(async () => (await agent.call("canvas_asks", { state: "all" })).asks.some((a: any) => a.id === ask2) || undefined, "the second ask");
  let blankError = "";
  const answered2: any = await agent.call("canvas_answer", { id: ask2, alternatives: ["Monday\n\nquietest day", "Tuesday, after the long weekend when the deliveries arrive late"], dimensions: ["Lost sales"], values: [["Low\n\nabout 30 covers"], ["Medium"]] }).catch((e: Error) => { blankError = e.message; });
  const second = (await agent.call("canvas_asks", { state: "all" })).asks.find((a: any) => a.id === ask2);
  check("an option with blank lines in it still answers, each field on one line", !blankError && second?.state === "answered", blankError || second?.state);
  // The levelling is not an edit: the revision the answer returned still writes, and the run still undoes.
  const b2 = answered2?.answers?.[1];
  let staleError = "";
  if (b2) await agent.call("canvas_update", { id: b2.id, expectedRevision: b2.revision, x: (b2.x ?? 0) + 40 }).catch((e: Error) => { staleError = e.message; });
  check("the revision an answer returns still writes after its lines are levelled", !!b2 && !staleError, staleError || b2?.revision);
  // Part of this row was out of view when it landed, so it was levelled by estimate; scrolled to, it lines up too.
  await ev(`(p, e, ask) => { const ids = [ask, ...e.getCurrentPageShapes().filter((s) => s.meta.replyTo === ask).map((s) => s.id)]; e.zoomToBounds(e.getShapesPageBounds(ids), { inset: 80, immediate: true }); }`, ask2);
  await page.waitForTimeout(400);
  const tops2: number[] = await ev(`(p, e, ask) => e.getCurrentPageShapes().filter((s) => s.meta.replyTo === ask).map((s) => { const q = [...document.querySelectorAll('[data-shape-id="' + s.id + '"] p')].find((q) => q.querySelector('strong')); return q ? q.getBoundingClientRect().top / e.getZoomLevel() : NaN; })`, ask2);
  check("a row partly out of view when it lands is levelled too", tops2.length === 2 && Math.abs(tops2[0] - tops2[1]) <= 2, tops2.map(Math.round));
  await page.screenshot({ path: `${out}/option-dimensions-offscreen-row.png` });
  // An answer that lands while the person is on another page (it goes to its ask's page, #69) is
  // levelled too: opening that page shows the dimension lines level across the row (item 137).
  const made3: any = await ev("(p) => p.create({ kind: 'note', x: 4600, y: 1400, width: 260, text: 'Which plan should we pilot?' })");
  const ask3 = typeof made3 === "string" ? made3 : made3.id;
  await ev("(p, e, id) => void p.select([id])", ask3);
  await page.keyboard.press("ControlOrMeta+Enter");
  await until(async () => (await agent.call("canvas_asks", { state: "all" })).asks.some((a: any) => a.id === ask3) || undefined, "the third ask");
  const home: string = await ev("(p, e) => e.getCurrentPageId()");
  await ev("(p, e) => { e.selectNone(); e.createPage({ name: 'Elsewhere' }); const pg = e.getPages().find((x) => x.name === 'Elsewhere'); e.setCurrentPage(pg.id); }");
  await page.waitForTimeout(300);
  await agent.call("canvas_answer", {
    id: ask3,
    alternatives: ["One team", "Every team in the north office for a whole quarter, then decide together"],
    dimensions: ["Effort", "What we learn"],
    values: [["Low", "Whether one team keeps using it"], ["High", "Whether it holds across teams"]],
  });
  const away: string = await ev("(p, e) => e.getCurrentPageId()");
  check("the third answer landed while another page was open", away !== home, { away, home });
  await page.waitForTimeout(800);
  await ev("(p, e, id) => void e.setCurrentPage(id)", home);
  await page.waitForTimeout(300);
  await ev(`(p, e, ask) => { const ids = [ask, ...e.getCurrentPageShapes().filter((s) => s.meta.replyTo === ask).map((s) => s.id)]; e.zoomToBounds(e.getShapesPageBounds(ids), { inset: 80, immediate: true }); }`, ask3);
  await page.waitForTimeout(500);
  const tops3: Record<string, number>[] = await ev(`(p, e, ask) => e.getCurrentPageShapes().filter((s) => s.meta.replyTo === ask).sort((a, b) => a.x - b.x).map((s) => Object.fromEntries([...document.querySelectorAll('[data-shape-id="' + s.id + '"] p')].filter((q) => q.querySelector('strong')).map((q) => [q.querySelector('strong').textContent, Math.round(q.getBoundingClientRect().top / e.getZoomLevel())])))`, ask3);
  const level3 = tops3.length === 2 && ["Effort:", "What we learn:"].every((d) => tops3[0][d] !== undefined && Math.abs(tops3[0][d] - tops3[1][d]) <= 2);
  check("an answer that lands on another page has its dimension lines level when that page is opened", level3, tops3);
  await page.screenshot({ path: `${out}/option-dimensions-other-page.png` });
  // Review of #174 (item 138 a, b): options in two rows, where the tallest headline and the tallest
  // first value come from different cards, so levelling makes the first row taller than any of its
  // cards was. The second row still starts below it, and the cards the answer returns are the
  // levelled ones.
  const made4: any = await ev("(p) => p.create({ kind: 'note', x: 160, y: 4000, width: 260, text: 'Where should the pilot run?' })");
  const ask4 = typeof made4 === "string" ? made4 : made4.id;
  await ev("(p, e, id) => { p.select([id]); const b = e.getShapePageBounds(id); e.setCamera({ x: -b.x + 40, y: -b.y + 40, z: 2.4 }, { immediate: true }); }", ask4);
  await page.keyboard.press("ControlOrMeta+Enter");
  await until(async () => (await agent.call("canvas_asks", { state: "all" })).asks.some((a: any) => a.id === ask4) || undefined, "the fourth ask");
  const answered4: any = await agent.call("canvas_answer", {
    id: ask4,
    alternatives: ["North", "The south office, where the support team sits next to sales and hears every complaint", "Remote"],
    dimensions: ["Setup", "Reach"],
    values: [["A week of training for every lead, two new laptops and a room booked for the whole quarter", "Small"], ["None", "Wide"], ["None", "Wide"]],
  });
  await page.waitForTimeout(800);
  const rows4: any[] = await ev(`(p, e, ask) => e.getCurrentPageShapes().filter((s) => s.meta.replyTo === ask).map((s) => { const b = e.getShapePageBounds(s.id); return { id: s.id, option: s.meta.option, x: b.x, y: b.y, maxX: b.maxX, maxY: b.maxY, h: b.h }; }).sort((a, b) => a.option.localeCompare(b.option))`, ask4);
  const overlap = (a: any, b: any) => a.x < b.maxX && b.x < a.maxX && a.y < b.maxY && b.y < a.maxY;
  const pairs = rows4.flatMap((a, i) => rows4.slice(i + 1).map((b) => [a, b]));
  check("options in two rows: the levelled first row is not covered by the second", rows4.length === 3 && rows4[2].y > rows4[0].y + 1 && pairs.every(([a, b]) => !overlap(a, b)), rows4.map((r) => ({ o: r.option, y: Math.round(r.y), maxY: Math.round(r.maxY) })));
  const returned = (answered4?.answers ?? []).map((a: any) => ({ id: a.id, h: a.bounds?.h ?? a.h }));
  check("the answer returns the cards as levelled", returned.length === 3 && returned.every((r: any) => Math.abs(r.h - (rows4.find((x) => x.id === r.id)?.h ?? -1)) < 1), { returned: returned.map((r: any) => Math.round(r.h)), now: rows4.map((r) => Math.round(r.h)) });
  await page.screenshot({ path: `${out}/option-dimensions-two-rows.png` });
  // Review of #184: the same two rows on an answer that lands while another page is open. A's
  // headline is short and its first value long, B's the other way round, so levelling grows the
  // first row; the third option, below it, must still clear it, and the lines sit level once the
  // ask's page is opened.
  const made5: any = await ev("(p) => p.create({ kind: 'note', x: 160, y: 6400, width: 260, text: 'Which plan should we pick?' })");
  const ask5 = typeof made5 === "string" ? made5 : made5.id;
  await ev("(p, e, id) => { p.select([id]); const b = e.getShapePageBounds(id); e.setCamera({ x: -b.x + 40, y: -b.y + 40, z: 2.4 }, { immediate: true }); }", ask5);
  await page.keyboard.press("ControlOrMeta+Enter");
  await until(async () => (await agent.call("canvas_asks", { state: "all" })).asks.some((a: any) => a.id === ask5) || undefined, "the fifth ask");
  await ev("(p, e) => { e.selectNone(); const pg = e.getPages().find((x) => x.name === 'Elsewhere'); e.setCurrentPage(pg.id); e.setCamera({ x: 0, y: 0, z: 2.4 }, { immediate: true }); }");
  await page.waitForTimeout(300);
  await agent.call("canvas_answer", {
    id: ask5,
    alternatives: ["Plan A", "Plan B, which moves every team in the north office over for a whole quarter before anyone decides", "Plan C"],
    dimensions: ["Effort", "Risk"],
    values: [["High: a week of training for every lead, two new laptops and a room booked for the whole quarter", "Low"], ["Low", "Medium"], ["Low", "Low"]],
  });
  const away5: string = await ev("(p, e) => e.getCurrentPageId()");
  check("the fifth answer landed while another page was open", away5 !== home, { away5, home });
  await page.waitForTimeout(800);
  await ev("(p, e, id) => void e.setCurrentPage(id)", home);
  await page.waitForTimeout(300);
  await ev(`(p, e, ask) => { const ids = [ask, ...e.getCurrentPageShapes().filter((s) => s.meta.replyTo === ask).map((s) => s.id)]; e.zoomToBounds(e.getShapesPageBounds(ids), { inset: 80, immediate: true }); }`, ask5);
  await page.waitForTimeout(500);
  const rows5: any[] = await ev(`(p, e, ask) => e.getCurrentPageShapes().filter((s) => s.meta.replyTo === ask).map((s) => { const b = e.getShapePageBounds(s.id); const tops = Object.fromEntries([...document.querySelectorAll('[data-shape-id="' + s.id + '"] p')].filter((q) => q.querySelector('strong')).map((q) => [q.querySelector('strong').textContent, Math.round(q.getBoundingClientRect().top / e.getZoomLevel())])); return { option: s.meta.option, x: b.x, y: b.y, maxX: b.maxX, maxY: b.maxY, tops }; }).sort((a, b) => a.option.localeCompare(b.option))`, ask5);
  const wrapped5 = rows5.length === 3 && Math.abs(rows5[0].y - rows5[1].y) < 1 && rows5[2].y > rows5[0].y + 1;
  const level5 = wrapped5 && ["Effort:", "Risk:"].every((d) => rows5[0].tops[d] !== undefined && Math.abs(rows5[0].tops[d] - rows5[1].tops[d]) <= 2);
  check("options in two rows on another page: the first row's dimension lines are level", level5, rows5.map((r) => ({ o: r.option, y: Math.round(r.y), tops: r.tops })));
  const pairs5 = rows5.flatMap((a, i) => rows5.slice(i + 1).map((b) => [a, b]));
  check("options in two rows on another page: the levelled first row is not covered by the second", wrapped5 && pairs5.every(([a, b]) => !overlap(a, b)), rows5.map((r) => ({ o: r.option, y: Math.round(r.y), maxY: Math.round(r.maxY) })));
  await page.screenshot({ path: `${out}/option-dimensions-two-rows-other-page.png` });
  const padsOf = (id: string) => ev("(p, e, id) => e.getShape(id)?.meta.levelPads ?? null", id);
  const a2 = answered2?.answers?.[0];

  const padded: any = a2 ? await padsOf(a2.id) : null;
  const fresh: any = a2 ? await agent.call("canvas_get", { id: a2.id }).catch(() => null) : null;
  const rev = fresh?.revision ?? fresh?.object?.revision ?? a2?.revision;
  if (a2) await agent.call("canvas_update", { id: a2.id, expectedRevision: rev, text: "A · Monday, the quietest day\nLost sales: Low" }).catch(() => undefined);
  const after: any = a2 ? await padsOf(a2.id) : null;
  check("editing a levelled card's text drops the space measured for the old text", Array.isArray(padded) && padded.some((n: number) => n > 0) && after === null, { padded, after });
  const runs: any = await agent.call("canvas_runs", {});
  const run = runs.runs?.find((r: any) => r.op === "answer" && cards.some((c) => (r.created ?? []).includes(c.id)));
  let undoError = "";
  if (run) await agent.call("canvas_undo_run", { runId: run.runId }).catch((e: Error) => { undoError = e.message; });
  const left: number = await ev("(p, e, ask) => e.getCurrentPageShapes().filter((s) => s.meta.replyTo === ask).length", ask);
  check("the answer's run undoes after its lines are levelled", !!run && !undoError && left === 0, undoError || { run: run?.runId, left });
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
