// Browser check for item 74: a stale flag stays readable at the canvas edge, and only flags on
// screen are Tab stops. A stale note is panned to the bottom edge of the view and selected (its
// reason must open inside the view), panned to the top edge and its flag focused (likewise), then
// panned out of view (its flag must leave the Tab order).
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-stale-edges.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`), ideally with an empty PAIRED_BOARDS_DIR.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-stale-edges.mjs <screenshot dir>');
const BASE = 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'stale-edges-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await p.waitForTimeout(800);

let n = 0;
async function command(op, input) {
  const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
  const list = sessions.sessions ?? sessions;
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `stale-edges-${++n}`, sessionId: list[0]?.id ?? list[0]?.sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}

const longName = 'Quarterly revenue estimate for the northern sales region, before returns and refunds';
const input = await command('create', { kind: 'note', x: 120, y: 1600, width: 300, text: 'Revenue: 1.2m', name: longName });
const derived = await command('create', { kind: 'note', x: 520, y: 1600, width: 300, text: 'So we can hire two people', name: 'Hiring plan', inputs: [input.id] });
await command('update', { id: input.id, expectedRevision: input.revision, text: 'Revenue: 0.9m' });
await p.evaluate(() => window.paired.select([]));

/** Pan (at 100%) so the derived note's top or bottom edge sits `gap` px inside the canvas. */
const panTo = (edge, gap) => p.evaluate(([id, edge, gap]) => {
  const ed = window.__pairedEditor, b = ed.getShapePageBounds(id), view = ed.getViewportScreenBounds();
  const y = edge === 'bottom' ? view.h - gap - b.maxY : gap - b.y;
  ed.setCamera({ x: 200 - b.x, y, z: 1 });
}, [derived.id, edge, gap]);
/** The flag's box against the canvas's box, in screen pixels. */
const flagBox = () => p.evaluate((id) => {
  const f = document.querySelector(`.stale-flag[data-shape-id="${id}"]`), c = document.querySelector('.tl-canvas') ?? document.querySelector('.tl-container');
  if (!f || !c) return null;
  const fb = f.getBoundingClientRect(), cb = c.getBoundingClientRect();
  // Not hidden behind the selection bar either.
  const bar = document.querySelector('.selection-bar')?.getBoundingClientRect();
  const underBar = Boolean(bar && fb.left < bar.right && fb.right > bar.left && fb.top < bar.bottom && fb.bottom > bar.top);
  return { underBar, inside: fb.top >= cb.top - 1 && fb.bottom <= cb.bottom + 1, top: Math.round(fb.top - cb.top), bottom: Math.round(cb.bottom - fb.bottom), tab: f.tabIndex, clipped: f.scrollWidth > f.clientWidth + 1 };
}, derived.id);

await panTo('bottom', 6);
await p.waitForTimeout(300);
await p.evaluate((id) => window.paired.select([id]), derived.id);
await p.waitForTimeout(300);
let box = await flagBox();
check('selected near the bottom edge, the whole reason opens inside the view, clear of the selection bar', box?.inside && box.clipped === false && !box.underBar, JSON.stringify(box));
await p.screenshot({ path: `${out}/stale-edge-bottom-selected.png` });
await p.evaluate(() => window.paired.select([]));

await panTo('top', 16);
await p.waitForTimeout(300);
await p.evaluate((id) => document.querySelector(`.stale-flag[data-shape-id="${id}"]`)?.focus(), derived.id);
await p.waitForTimeout(300);
box = await flagBox();
check('focused near the top edge, the whole reason stays inside the view', box?.inside && box.clipped === false, JSON.stringify(box));
await p.screenshot({ path: `${out}/stale-edge-top-focused.png` });
await p.evaluate(() => document.activeElement?.blur());

await p.evaluate(([id]) => { const ed = window.__pairedEditor, b = ed.getShapePageBounds(id); ed.setCamera({ x: -b.x - 3000, y: -b.y, z: 1 }); }, [derived.id]);
await p.waitForTimeout(300);
box = await flagBox();
check('panned out of view, the flag is not a Tab stop', box?.tab === -1, JSON.stringify(box));
await panTo('bottom', 300);
await p.waitForTimeout(300);
box = await flagBox();
check('back in view, it is a Tab stop again', box?.tab === 0, JSON.stringify(box));
check('no page errors', errors.length === 0, errors.join(' | '));
await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
