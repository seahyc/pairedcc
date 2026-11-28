// Live check for item 134: the overview (O) keeps a card lifted out of its frame with the frame.
// The person writes a card across the bottom edge of their "Kitchen quotes" frame (N, click, type,
// Esc); it is lifted onto the page so nothing of it is cut off (#155). O shows one box for the
// frame, counting the lifted card, and no box of the card's own.
// Starts its own dev server (port 5197) unless PAIRED_URL is set:
//   node --import tsx tools/verify-overview-lifted.ts [screenshot dir]
import { launch, openCanvas, startServer } from "../eval/lib";

const server = process.env.PAIRED_URL ? undefined : await startServer(5197, true);
const base = process.env.PAIRED_URL ?? server!.base;
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail: unknown = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : "  — " + JSON.stringify(detail)}`); };
const browser = await launch();
try {
  const { context, page, errors } = await openCanvas(browser, base);
  const ev = (fn: string, arg?: unknown) => page.evaluate(`(${fn})(window.paired, window.__pairedEditor, ${JSON.stringify(arg ?? null)})`);
  await ev("(p, e) => { e.deleteShapes([...e.getCurrentPageShapeIds()]); e.setCamera({ x: 0, y: 0, z: 1 }); }");
  const frame: any = await ev("(p) => { const r = p.create({ kind: 'frame', x: 200, y: 150, width: 560, height: 300, name: 'Kitchen quotes' }); return typeof r === 'string' ? r : r.id; }");
  const write = async (x: number, y: number, text: string) => {
    const at: any = await ev("(p, e, a) => e.pageToScreen(a)", { x, y });
    await page.keyboard.press("Escape");
    await page.keyboard.press("n");
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(() => document.activeElement?.closest?.("[contenteditable=true]"), null, { timeout: 3000 });
    await page.keyboard.type(text, { delay: 0 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    return ev("(p, e) => e.getCurrentPageShapes().filter((s) => s.type === 'card').at(-1).id") as Promise<string>;
  };
  await write(240, 200, "Oakline: £8,400");
  await write(500, 200, "Brook & Sons: £7,250");
  const long = await write(480, 400, "Ask whether Brook & Sons can start before the end of March, since ten weeks is long");
  const where: any = await ev("(p, e, id) => { const s = e.getShape(id); return { onPage: s.parentId === e.getCurrentPageId(), within: s.meta.within ?? null }; }", long);
  check("a card written across the frame's edge is lifted onto the page", where.onPage && where.within === frame, where);
  await ev("(p, e) => void e.selectNone()");
  await page.keyboard.press("o");
  await page.waitForTimeout(500);
  const boxes: string[] = await ev("() => [...document.querySelectorAll('.overview-box, [class*=overview] button')].map((el) => el.textContent?.trim() ?? '').filter((t) => t && t !== 'Esc')");
  if (process.argv[2]) await page.screenshot({ path: `${process.argv[2]}/overview-lifted.png` });
  check("O shows one box for the frame, counting the lifted card", boxes.length === 1 && /Kitchen quotes/.test(boxes[0]) && /3 open/.test(boxes[0]), boxes);
  check("and no box of the lifted card's own", !boxes.some((b) => b.startsWith("Ask whether")), boxes);
  // Review of #180: a card lifted out of a frame nested in another is counted in the outer frame's
  // box, the one O draws (nested frames are counted inside their top-level frame).
  await page.keyboard.press("Escape");
  await ev("(p, e) => { e.deleteShapes([...e.getCurrentPageShapeIds()]); e.setCamera({ x: 0, y: 0, z: 1 }); }");
  const outer: any = await ev("(p) => { const r = p.create({ kind: 'frame', x: 150, y: 120, width: 700, height: 420, name: 'Kitchen' }); return typeof r === 'string' ? r : r.id; }");
  const inner: any = await ev("(p, e, outer) => { const r = p.create({ kind: 'frame', x: 200, y: 170, width: 420, height: 240, name: 'Quotes' }); const id = typeof r === 'string' ? r : r.id; e.reparentShapes([id], outer); return id; }", outer);
  const nested = await write(470, 400, "Ask whether Brook & Sons can start before the end of March, since ten weeks is long");
  const nestedAt: any = await ev("(p, e, id) => { const s = e.getShape(id); return { onPage: s.parentId === e.getCurrentPageId(), within: s.meta.within ?? null }; }", nested);
  check("a card across the nested frame's edge is lifted, going with that frame", nestedAt.onPage && nestedAt.within === inner, nestedAt);
  await ev("(p, e) => void e.selectNone()");
  await page.keyboard.press("o");
  await page.waitForTimeout(500);
  const nestedBoxes: string[] = await ev("() => [...document.querySelectorAll('.overview-box, [class*=overview] button')].map((el) => el.textContent?.trim() ?? '').filter((t) => t && t !== 'Esc')");
  if (process.argv[2]) await page.screenshot({ path: `${process.argv[2]}/overview-lifted-nested.png` });
  check("O counts it in the outer frame's box, with no box of its own", nestedBoxes.length === 1 && /Kitchen/.test(nestedBoxes[0]) && /1 open/.test(nestedBoxes[0]), nestedBoxes);
  check("no page errors", errors.length === 0, errors.slice(0, 3));
  await context.close();
} finally {
  await browser.close();
  server?.stop();
}
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
