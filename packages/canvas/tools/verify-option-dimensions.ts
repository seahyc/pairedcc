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
  await agent.call("canvas_answer", {
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
  await agent.call("canvas_answer", { id: ask2, alternatives: ["Monday\n\nquietest day", "Tuesday"], dimensions: ["Lost sales"], values: [["Low\n\nabout 30 covers"], ["Medium"]] }).catch((e: Error) => { blankError = e.message; });
  const second = (await agent.call("canvas_asks", { state: "all" })).asks.find((a: any) => a.id === ask2);
  check("an option with blank lines in it still answers, each field on one line", !blankError && second?.state === "answered", blankError || second?.state);
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
