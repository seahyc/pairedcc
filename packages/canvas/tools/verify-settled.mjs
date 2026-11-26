// Browser check for P3, part 1: the person settles a thought.
//
// On a fresh profile at 1440 x 900: write a thought (N, Enter, type, Esc), press S. The card must
// be marked settled, turn from rough handwriting to print with a small check, keep its text inside
// it, and say "Settled" on the selection bar. One undo reopens it; S again settles it; it is still
// settled after a reload, and an agent reading the board over HTTP sees `settled: true`. S once
// more reopens it. Nothing on the first screen changes.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-settled.mjs <screenshot dir>
//
// Needs a dev server for this checkout with an empty board store (packages/canvas/.local/boards).
// No model is needed. Playwright is loaded from the directory you run this in. Exits non-zero if
// any check fails.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-settled.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'settled-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
const open = async () => {
  await p.goto(`${BASE}/canvas/`);
  await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
};
await open();
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const press = async (key, wait = 350) => { await p.keyboard.press(key); await p.waitForTimeout(wait); };
await p.screenshot({ path: `${out}/1-first-screen.png` });

async function command(op, input) {
  const sessionId = await p.evaluate(() => document.documentElement.dataset.pairedSession);
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `settled-${Date.now()}-${Math.random()}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
/** The card as the person sees it: settled flag, label font, the check, and whether text fits. */
const look = (id) => p.evaluate((id) => {
  const ed = window.__pairedEditor, shape = ed.getShape(id);
  const el = document.querySelector(`.tl-shape[data-shape-id="${id}"] .scrap`);
  const label = el?.querySelector('.tl-rich-text');
  const box = el?.getBoundingClientRect(), text = label?.getBoundingClientRect();
  return {
    settled: shape?.meta.settled === true,
    font: label ? getComputedStyle(label).fontFamily : '',
    check: el ? getComputedStyle(el, '::after').content : '',
    inside: Boolean(box && text && text.bottom <= box.bottom + 2 && text.right <= box.right + 2),
    bar: document.querySelector('.selection-bar')?.textContent ?? '',
  };
}, id);

// A thought of the person's.
await press('n');
await press('Enter', 500);
await p.keyboard.type('Per-seat pricing, because cost should follow team size', { delay: 0 });
await press('Escape', 500);
const card = await p.evaluate(() => window.__pairedEditor.getOnlySelectedShapeId());
const rough = await look(card);
check('a fresh thought is rough handwriting and not settled', !rough.settled && /Caveat/.test(rough.font) && rough.check === 'none', JSON.stringify(rough));
await p.screenshot({ path: `${out}/2-rough.png` });

await press('s', 500);
let done = await look(card);
check('S settles it', done.settled, JSON.stringify(done));
check('settled, it is print with a small check, not handwriting', !/Caveat/.test(done.font) && done.check.includes('✓'), `${done.font}; ${done.check}`);
check('its text stays inside the card', done.inside);
check('the selection bar says it is settled, with its key', /Settled ✓/.test(done.bar), done.bar);
await p.screenshot({ path: `${out}/3-settled.png` });

await press(`${mod}+z`, 500);
let undone = await look(card);
check('one undo reopens it', !undone.settled && /Caveat/.test(undone.font), JSON.stringify(undone));
await p.evaluate((id) => { window.paired.select([id]); window.__pairedEditor.focus(); }, card);
await press('s', 500);
check('S settles it again', (await look(card)).settled);

// It stays settled after a reload, and an agent reads it.
await p.waitForTimeout(2500);
await open();
const kept = await look(card);
check('still settled after a reload', kept.settled && kept.check.includes('✓'), JSON.stringify(kept));
const read = await command('read', { ids: [card] });
const seen = (read.objects ?? []).find((o) => o.id === card);
check('an agent reading the board sees settled: true', seen?.settled === true, JSON.stringify(seen && { settled: seen.settled, author: seen.author }));

await p.evaluate((id) => { window.paired.select([id]); window.__pairedEditor.focus(); }, card);
await press('s', 500);
check('S on a settled thought reopens it', !(await look(card)).settled);
check('no page errors', errors.length === 0, errors.join(' | '));

await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
