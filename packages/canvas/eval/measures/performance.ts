import { openCanvas, ready, type Browser } from "../lib";

// Load time and pan frame time for boards of 1k and 10k objects. The board is built
// with the editor directly (development builds expose it) because building 10k
// objects through the agent interface takes minutes; that cost is reported too.

async function frames(page: any, count = 120) {
  return page.evaluate(async (n: number) => {
    const editor = (window as any).__pairedEditor;
    const start = editor.getCamera();
    const times: number[] = [];
    let last = performance.now();
    for (let i = 0; i < n; i++) {
      await new Promise((done) => requestAnimationFrame(done));
      const now = performance.now();
      times.push(now - last);
      last = now;
      editor.setCamera({ ...start, x: start.x - i * 25, y: start.y - i * 10 });
    }
    editor.setCamera(start);
    times.sort((a, b) => a - b);
    return { median: times[Math.floor(n / 2)], p95: times[Math.floor(n * 0.95)] };
  }, count);
}

export async function performanceMeasure(browser: Browser, base: string, sizes = (process.env.EVAL_SIZES ?? "1000,10000").split(",").map(Number)) {
  const results: Record<string, unknown>[] = [];
  for (const size of sizes) {
    const { context, page } = await openCanvas(browser, base);
    try {
      const built = await page.evaluate((n: number) => {
        const editor = (window as any).__pairedEditor;
        const t = performance.now();
        editor.createPage({ name: `Perf ${n}` });
        const id = editor.getPages().at(-1).id;
        editor.setCurrentPage(id);
        const shapes = Array.from({ length: n }, (_, i) => ({
          type: i % 5 === 0 ? "text" : "geo",
          x: (i % 100) * 140,
          y: Math.floor(i / 100) * 110,
          props: i % 5 === 0 ? {} : { w: 120, h: 90 },
        }));
        editor.run(() => editor.createShapes(shapes), { history: "ignore" });
        editor.zoomToFit();
        return { ms: performance.now() - t, created: editor.getCurrentPageShapeIds().size };
      }, size);
      if (built.created < size) throw new Error(`only ${built.created} of ${size} objects could be created on one page (tldraw's default maxShapesPerPage is 4,000)`);
      const buildMs = built.ms;
      // Let the board persist to IndexedDB before reloading.
      await page.waitForTimeout(Math.max(2000, size));
      const t = Date.now();
      await page.reload();
      await ready(page);
      try {
        await page.waitForFunction((n: number) => (window as any).__pairedEditor?.getCurrentPageShapeIds().size >= n, size, { timeout: 120000 });
      } catch {
        const state = await page.evaluate(() => {
          const e = (window as any).__pairedEditor;
          return e ? `${e.getCurrentPageShapeIds().size} objects on "${e.getCurrentPage().name}"` : "no editor";
        });
        throw new Error(`board did not reload with ${size} objects within 120 s (${state})`);
      }
      const loadMs = Date.now() - t;
      await page.evaluate(() => (window as any).__pairedEditor.zoomToFit());
      const pan = await frames(page);
      results.push({ objects: size, buildMs: Math.round(buildMs), loadMs, panMedianFrameMs: round(pan.median), panP95FrameMs: round(pan.p95) });
    } catch (error) {
      results.push({ objects: size, error: error instanceof Error ? error.message.split("\n")[0] : String(error) });
    } finally {
      await context.close();
    }
  }
  return results;
}
const round = (n: number) => Math.round(n * 10) / 10;
