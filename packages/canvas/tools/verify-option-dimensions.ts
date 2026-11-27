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
