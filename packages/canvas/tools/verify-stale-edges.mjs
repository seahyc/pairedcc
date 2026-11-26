// Browser check for item 74: a stale flag stays readable at the canvas edge, and only flags on
// screen are Tab stops. A stale note is panned to the bottom edge of the view and selected (its
// reason must open inside the view), panned to the top edge and its flag focused (likewise), then
// panned out of view (its flag must leave the Tab order).
//
// Item 93 adds cases where the drawn flag and the object's span disagree: (a) a selected flag whose
// short reason opens wholly off screen is not a Tab stop, one that opens into view is, and a
// focused flag near the left edge stays inside it; (b) at 200% a long reason near the bottom opens
// where all of it fits; (c) a compact flag straddling the top edge grows down from inside the view.
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
const panTo = (edge, gap, of = derived.id, z = 1, x = 200) => p.evaluate(([id, edge, gap, z, x]) => {
  const ed = window.__pairedEditor, b = ed.getShapePageBounds(id), view = ed.getViewportScreenBounds();
  // Screen y = (page y + camera y) * z.
  // 'above': the object's bottom edge sits `gap` px above the top of the canvas.
  const y = edge === 'bottom' ? (view.h - gap) / z - b.maxY : edge === 'above' ? -gap / z - b.maxY : gap / z - b.y;
  ed.setCamera({ x: x / z - b.x, y, z });
}, [of, edge, gap, z, x]);
/** The flag's box against the canvas's box, in screen pixels. */
const flagBox = (of = derived.id) => p.evaluate((id) => {
  const f = document.querySelector(`.stale-flag[data-shape-id="${id}"]`), c = document.querySelector('.tl-canvas') ?? document.querySelector('.tl-container');
  if (!f || !c) return null;
  const fb = f.getBoundingClientRect(), cb = c.getBoundingClientRect();
  // Not hidden behind the selection bar either.
  const bar = document.querySelector('.selection-bar')?.getBoundingClientRect();
  const underBar = Boolean(bar && fb.left < bar.right && fb.right > bar.left && fb.top < bar.bottom && fb.bottom > bar.top);
  return { w: Math.round(fb.width), underBar, inside: fb.top >= cb.top - 1 && fb.bottom <= cb.bottom + 1 && fb.left >= cb.left - 1 && fb.right <= cb.right + 1, visible: fb.right > cb.left && fb.left < cb.right && fb.bottom > cb.top && fb.top < cb.bottom, left: Math.round(fb.left - cb.left), top: Math.round(fb.top - cb.top), bottom: Math.round(cb.bottom - fb.bottom), tab: f.tabIndex, clipped: f.scrollWidth > f.clientWidth + 1 };
}, of);

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

// Item 93. A second pair with short names, so the selected flag's reason is short.
const cost = await command('create', { kind: 'note', x: 120, y: 2400, width: 300, text: 'Cost: 40', name: 'Cost' });
const plan = await command('create', { kind: 'note', x: 520, y: 2400, width: 300, text: 'Fine', name: 'Plan', inputs: [cost.id] });
await command('update', { id: cost.id, expectedRevision: cost.revision, text: 'Cost: 90' });
// And one whose input's name (200 characters, the most a name may have) wraps the reason onto four lines.
const essay = ('Assumptions behind the estimate: ' + 'every region keeps its current staff, prices rise in spring, and returns stay under five percent of orders '.repeat(2)).slice(0, 200).trim();
const big = await command('create', { kind: 'note', x: 120, y: 3200, width: 300, text: 'Estimate', name: essay });
const memo = await command('create', { kind: 'note', x: 520, y: 3200, width: 300, text: 'Memo', name: 'Memo', inputs: [big.id] });
await command('update', { id: big.id, expectedRevision: big.revision, text: 'Estimate, revised' });
await p.evaluate(() => window.paired.select([]));
await p.waitForTimeout(300);

// (a) Selected, with only the card's right 40 px on screen at the left edge: its short reason opens
// under the card's left part, wholly off screen, so it is no Tab stop.
await panTo('top', 300, plan.id, 1, -260);
await p.evaluate((id) => window.paired.select([id]), plan.id);
await p.waitForTimeout(300);
box = await flagBox(plan.id);
check('(a) selected, its short reason opened wholly off screen, it is not a Tab stop', box && !box.visible && box.tab === -1, JSON.stringify(box));
// Selected at 200% with the card just above the view: its reason opens under it, into view.
await panTo('above', 46, derived.id, 2);
await p.evaluate((id) => window.paired.select([id]), derived.id);
await p.waitForTimeout(300);
box = await flagBox();
check('(a) selected, its reason opened into view under a card above the view, it is a Tab stop', box?.visible && box.tab === 0, JSON.stringify(box));
await p.screenshot({ path: `${out}/stale-edge-opened-into-view.png` });
await p.evaluate(() => window.paired.select([]));
// Focused with the card's right end 200 px inside the left edge: the whole reason stays on screen.
await panTo('top', 300, derived.id, 1, 200 - 300);
await p.waitForTimeout(300);
await p.evaluate((id) => document.querySelector(`.stale-flag[data-shape-id="${id}"]`)?.focus(), derived.id);
await p.waitForTimeout(300);
box = await flagBox();
check('(a) focused near the left edge, the whole reason stays inside the view', box?.inside && box.tab === 0, JSON.stringify(box));
await p.screenshot({ path: `${out}/stale-edge-left-focused.png` });
await p.evaluate(() => document.activeElement?.blur());

// (b) At 200%, 130 screen px under the card (more than the old fixed 120) and plenty above: the
// long reason must open where all of it fits.
await panTo('bottom', 130, memo.id, 2);
await p.evaluate((id) => window.paired.select([id]), memo.id);
await p.waitForTimeout(300);
box = await flagBox(memo.id);
check('(b) at 200%, a long reason near the bottom opens wholly inside the view', box?.inside && !box.underBar, JSON.stringify(box));
await p.screenshot({ path: `${out}/stale-edge-zoomed-long.png` });
await p.evaluate(() => window.paired.select([]));

// (c) The card's top 15 px above the view: the compact flag straddles the top edge. Focused, it
// grows down from inside the view, its first line whole.
await panTo('top', -15);
await p.waitForTimeout(300);
await p.evaluate((id) => document.querySelector(`.stale-flag[data-shape-id="${id}"]`)?.focus(), derived.id);
await p.waitForTimeout(300);
box = await flagBox();
check('(c) focused while straddling the top edge, the whole reason is inside the view', box?.inside && box.tab === 0, JSON.stringify(box));
await p.screenshot({ path: `${out}/stale-edge-top-straddle.png` });
await p.evaluate(() => document.activeElement?.blur());

check('no page errors', errors.length === 0, errors.join(' | '));
await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
