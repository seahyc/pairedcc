// Browser check for item 99: nothing on the first board touches either edge of a 390 px screen, or
// the tool strip, ✦ marks included; a board laid out on a 1440 px screen and opened on a phone is
// framed the same way; and the desktop first board is unchanged (460 px wide, centred).
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-phone-margin.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`) with an empty PAIRED_BOARDS_DIR: the first case
// lays out the account's board at 1440 px and the second opens it at 390 px.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-phone-margin.mjs <screenshot dir>');
const BASE = 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const errors = [];

async function open(width, profile = mkdtempSync(join(tmpdir(), 'phone-margin-'))) {
  const ctx = await chromium.launchPersistentContext(profile, { viewport: { width, height: 844 } });
  const p = ctx.pages()[0] ?? await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await p.goto(`${BASE}/canvas/`);
  await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  return { ctx, p };
}

/** Every card and ✦ mark on the first board, against the canvas edges and the tool strip, in screen px. */
const edges = (p) => p.evaluate(() => {
  const canvas = document.querySelector('.tl-container').getBoundingClientRect();
  const strip = document.querySelector('.tool-strip')?.getBoundingClientRect();
  const boxes = [...document.querySelectorAll('.tl-shape, .scratch-spark')]
    .map((el) => el.getBoundingClientRect()).filter((b) => b.width > 0);
  const left = Math.min(...boxes.map((b) => b.left)), right = Math.max(...boxes.map((b) => b.right));
  // Clear of the strip: nothing at the strip's height overlaps it.
  const underStrip = strip ? boxes.filter((b) => b.left < strip.right && b.top < strip.bottom && b.bottom > strip.top).length : 0;
  const ed = window.__pairedEditor;
  return {
    marginLeft: Math.round(left - canvas.left), marginRight: Math.round(canvas.right - right), underStrip, boxes: boxes.length,
    zoom: +ed.getZoomLevel().toFixed(2), widths: ed.getCurrentPageShapes().map((s) => Math.round(ed.getShapePageBounds(s).w)),
  };
});
const clear = (e) => e.marginLeft >= 8 && e.marginRight >= 8 && e.underStrip === 0;

// 1. The desktop first board is unchanged (the store is empty, so this is the account's board).
let { ctx, p } = await open(1440);
let e = await edges(p);
check('at 1440 px the first board is unchanged: 460 and 400 px cards, at 100%', e.zoom === 1 && e.widths.includes(460) && e.widths.includes(400), JSON.stringify(e));
await p.screenshot({ path: `${out}/phone-margin-desktop.png` });
await p.waitForTimeout(2000); // saved to the account
await ctx.close();

// 2. The same account opens that board on a phone: it is framed clear of the edges and the strip.
({ ctx, p } = await open(390));
e = await edges(p);
check('the 1440 px board opened at 390 px: framed clear of both edges and the tool strip', clear(e), JSON.stringify(e));
await p.screenshot({ path: `${out}/phone-margin-reframed.png` });

// 3. A new board laid out on the phone (Menu, New board).
await p.getByRole('button', { name: /menu/i }).first().click();
await p.getByRole('menuitem', { name: /new board/i }).click();
await p.waitForTimeout(800);
e = await edges(p);
check('a new board at 390 px: nothing touches either edge or the tool strip', clear(e), JSON.stringify(e));
check('  and it opens at 100%, its cards wrapped rather than shrunk', e.zoom === 1, JSON.stringify(e));
await p.screenshot({ path: `${out}/phone-margin-new.png` });
await ctx.close();

check('no page errors', errors.length === 0, errors.join(' | '));
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
