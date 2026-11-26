// Browser check for item 94: moving one object on a big board stays quick.
//
// Builds a 10,000-object page (the scorecard's performance board: geo and text in a grid), then
// moves one object 40 steps at a time, three rounds, unselected and selected (as when dragging),
// and reports the median time per step (an update and the frame after it). It also opens the
// layers panel from the menu and checks it lists the page's objects, so the panel still works
// now that it is built only while open. Times are reported, not judged: they depend on the
// machine. Exits non-zero if the panel check fails.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-big-edit.mjs [objects]
//
// Needs a dev server for this checkout with an empty board store (packages/canvas/.local/boards).
import { createRequire } from 'node:module';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const SIZE = Number(process.argv[2] ?? 10000);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/canvas/`);
await page.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.evaluate((n) => {
  const editor = window.__pairedEditor;
  editor.createPage({ name: `Perf ${n}` });
  editor.setCurrentPage(editor.getPages().at(-1).id);
  const shapes = Array.from({ length: n }, (_, i) => ({
    type: i % 5 === 0 ? 'text' : 'geo',
    x: (i % 100) * 140,
    y: Math.floor(i / 100) * 110,
    props: i % 5 === 0 ? {} : { w: 120, h: 90 },
  }));
  editor.run(() => editor.createShapes(shapes), { history: 'ignore' });
  editor.setCamera({ x: 0, y: 0, z: 1 });
}, SIZE);
await page.waitForTimeout(Math.max(3000, SIZE / 2));

/** Median ms per step over `rounds` rounds of `steps` one-object moves. */
const moves = (selected, rounds = 3, steps = 40) => page.evaluate(async ({ selected, rounds, steps }) => {
  const ed = window.__pairedEditor;
  const id = [...ed.getCurrentPageShapeIds()][1];
  if (selected) ed.select(id); else ed.selectNone();
  const medians = [];
  for (let r = 0; r < rounds; r++) {
    const s = ed.getShape(id), times = [];
    for (let i = 0; i < steps; i++) {
      const t = performance.now();
      ed.updateShape({ id, type: s.type, x: s.x + (i % 2 ? 3 : -3) });
      await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    medians.push(Math.round(times[Math.floor(steps / 2)]));
  }
  ed.selectNone();
  const sorted = [...medians].sort((a, b) => a - b);
  return { median: sorted[1], rounds: medians };
}, { selected, rounds, steps });

const unselected = await moves(false);
const selected = await moves(true);
console.log(`${SIZE} objects, one object moved, ms per step: unselected median ${unselected.median} (rounds ${unselected.rounds.join(', ')}); selected median ${selected.median} (rounds ${selected.rounds.join(', ')})`);

// The layers panel, opened from the menu, lists the page's objects.
await page.click('.menu-button');
await page.getByRole('menuitem', { name: /Show layers and pages/ }).click();
await page.waitForTimeout(Math.max(1000, SIZE / 5));
const panel = await page.evaluate(() => ({
  open: Boolean(document.querySelector('.left-panel')),
  count: document.querySelector('.left-panel .section-heading.border-top span:last-child')?.textContent,
  rows: document.querySelectorAll('.left-panel .layer').length,
}));
const ok = panel.open && Number(panel.count) === SIZE && panel.rows === SIZE;
console.log(`${ok ? 'PASS' : 'FAIL'}  the layers panel opens from the menu and lists every object  — ${JSON.stringify(panel)}`);
await page.click('[aria-label="Hide layers"]');
await page.waitForTimeout(500);
const closed = await page.evaluate(() => !document.querySelector('.left-panel'));
console.log(`${closed ? 'PASS' : 'FAIL'}  hiding it takes its rows off the page  — ${closed}`);
await browser.close();
process.exit(ok && closed ? 0 : 1);
