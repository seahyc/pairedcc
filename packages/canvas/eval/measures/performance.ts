import { openCanvas, ready, savedToAccount, type Browser } from "../lib";

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
    const steps: string[] = [];
    page.on("framenavigated", (f: any) => f === page.mainFrame() && steps.push(`navigated ${f.url()}`));
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
      steps.push("built");
      // Let the board persist (IndexedDB, and the account when there is one) before reloading.
      await page.waitForTimeout(Math.max(2000, size));
      await savedToAccount(page, 30000);
      steps.push("persisted");
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
      steps.push("loaded");
      await page.evaluate(() => void (window as any).__pairedEditor.zoomToFit());
      steps.push("fitted");
      // A pan sample on a busy machine is either fast or about twice as slow, in runs (38 or 85 ms
      // at 10k on the sprint container). After a discarded warm-up, many short samples are taken
      // and the figure is the lower quartile of their medians: it reads the fast mode whenever a
      // quarter of the samples land there, so a slow spell does not read as a regression.
      const pan_ = panSettings();
      await frames(page, pan_.frames);
      const samples = [];
      for (let k = 0; k < pan_.samples; k++) samples.push(await frames(page, pan_.frames));
      const pan = summarisePan(samples, pan_.frames);
      results.push({ objects: size, buildMs: Math.round(buildMs), loadMs, panMedianFrameMs: pan.median, panP95FrameMs: pan.p95, panSampleMediansMs: pan.sampleMedians, panMethod: pan.method });
    } catch (error) {
      results.push({ objects: size, error: error instanceof Error ? error.message.split("\n")[0] : String(error), ...(process.env.EVAL_TRACE ? { steps } : {}) });
    } finally {
      await context.close();
    }
  }
  return results;
}
const round = (n: number) => Math.round(n * 10) / 10;

/** A whole-number setting from the environment; anything else is an error, never a silent NaN. */
export function countSetting(value: string | undefined, fallback: number, min: number, name: string) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be a whole number of at least ${min} (got "${value}")`);
  return n;
}
/** How many pan samples are taken after the warm-up, and how many frames each one is. */
export const PAN_SAMPLES_DEFAULT = 12, PAN_FRAMES_DEFAULT = 40;
const panSettings = () => ({
  samples: countSetting(process.env.EVAL_PAN_SAMPLES, PAN_SAMPLES_DEFAULT, 1, "EVAL_PAN_SAMPLES"),
  frames: countSetting(process.env.EVAL_PAN_FRAMES, PAN_FRAMES_DEFAULT, 10, "EVAL_PAN_FRAMES"),
});

/** The lower quartile (nearest rank) of a list. */
const lowerQuartile = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * 0.25)];
};

/**
 * The pan figure: the lower quartile of the samples' medians (and of their p95s), with every
 * sample's median kept to show the spread. Reported as `panMedianFrameMs` so runs before and
 * after compare on one key; `method` says how it was taken.
 */
export function summarisePan(samples: { median: number; p95: number }[], framesPerSample = PAN_FRAMES_DEFAULT) {
  return {
    median: round(lowerQuartile(samples.map((x) => x.median))),
    p95: round(lowerQuartile(samples.map((x) => x.p95))),
    sampleMedians: samples.map((x) => round(x.median)),
    method: `lower quartile of ${samples.length} sample medians of ${framesPerSample} frames each`,
  };
}
