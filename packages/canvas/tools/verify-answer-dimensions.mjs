// Browser check for item 122: options compared on stated dimensions.
//
// On a fresh profile at 1440 x 900 the person writes a question ("Which pricing should we
// pick?"); it is sent as they finish. An agent answers over HTTP with three alternatives and two
// dimensions. There must be three lettered option cards and one small table under them: a row per
// dimension, a column per option lettered like the cards, its text inside its cells, on top of
// nothing, part of the answer (replyTo the ask) and not counted as an option ("3 options" is
// announced). One undo takes the whole answer back, table included. Values that do not line up
// are refused with a reason. An agent reading the board gets the table's rows.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-answer-dimensions.mjs <screenshot dir>
//
// Needs a dev server for this checkout with an empty board store. No model is needed.
// Exits non-zero if any check fails.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-answer-dimensions.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'answer-dims-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await p.waitForTimeout(1500);
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function command(op, input) {
  const sessionId = await p.evaluate(() => document.documentElement.dataset.pairedSession);
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `dims-${Date.now()}-${Math.random()}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  return res.json();
}

await p.screenshot({ path: `${out}/1-first-screen.png` });
await p.keyboard.press('n');
await p.waitForTimeout(300);
await p.keyboard.press('Enter');
await p.waitForTimeout(500);
await p.keyboard.type('Which pricing should we pick? Compare them', { delay: 0 });
await p.keyboard.type('?', { delay: 0 });
await p.keyboard.press('Escape');
await p.waitForTimeout(800);
const ask = await p.evaluate(() => window.__pairedEditor.getCurrentPageShapes().find((s) => s.meta.ask)?.id);
check('the person\'s question is sent as an ask', Boolean(ask), String(ask));

const alternatives = ['Per seat: each person costs the same', 'Flat price for the whole team', 'Usage based: pay for what you run'];
const dimensions = ['cost to small teams', 'predictable bill'];
const values = [['grows with headcount', 'yes'], ['high at the start', 'yes'], ['low until used a lot', 'no']];

const refused = await command('answer', { id: ask, alternatives, dimensions, values: values.slice(0, 2) });
check('values that do not line up are refused with a reason', refused.ok === false && /one row per alternative/.test(JSON.stringify(refused)), JSON.stringify(refused).slice(0, 200));

const before = await p.evaluate(() => window.__pairedEditor.getCurrentPageShapes().length);
const answered = await command('answer', { id: ask, alternatives, dimensions, values, read: 'your question' });
check('the answer with dimensions is accepted', answered.ok === true, JSON.stringify(answered).slice(0, 200));
await p.waitForTimeout(1200);
const look = await p.evaluate((askId) => {
  const ed = window.__pairedEditor;
  const answers = ed.getCurrentPageShapes().filter((s) => s.meta.replyTo === askId);
  const cards = answers.filter((s) => s.type === 'card');
  const table = answers.find((s) => s.type === 'datatable');
  const box = (s) => ed.getShapePageBounds(s);
  const tb = table && box(table);
  const cardBottom = Math.max(...cards.map((c) => box(c).maxY));
  const cardLeft = Math.min(...cards.map((c) => box(c).x));
  const others = ed.getCurrentPageShapes().filter((s) => s.id !== table?.id && !['arrow', 'frame'].includes(s.type)).map(box);
  const overlaps = tb ? others.filter((o) => o.x < tb.maxX && tb.x < o.maxX && o.y < tb.maxY && tb.y < o.maxY).length : -1;
  const el = table && document.querySelector(`.tl-shape[data-shape-id="${table.id}"]`);
  const cells = el ? [...el.querySelectorAll('td, th')] : [];
  const fits = cells.length > 0 && cells.every((c) => c.scrollWidth <= c.clientWidth + 1);
  const er = el?.getBoundingClientRect();
  const inner = el?.firstElementChild?.getBoundingClientRect();
  return {
    cards: cards.map((c) => c.meta.option),
    table: table ? { columns: table.props.columns, rows: table.props.rows, compare: table.meta.compare, author: table.meta.createdBy } : null,
    under: Boolean(tb && tb.y >= cardBottom),
    alignedLeft: Boolean(tb && Math.abs(tb.x - cardLeft) < 1),
    overlaps,
    fits,
    contained: Boolean(er && inner && inner.bottom <= er.bottom + 2 && inner.right <= er.right + 2),
    heard: document.querySelector('[data-ask-announcer]')?.textContent ?? '',
  };
}, ask);
check('three lettered option cards', JSON.stringify(look.cards) === JSON.stringify(['A', 'B', 'C']), JSON.stringify(look.cards));
check('one table: a row per dimension, a column per option lettered like the cards', look.table && JSON.stringify(look.table.columns) === JSON.stringify(['', 'A', 'B', 'C']) && look.table.rows.length === 2 && look.table.rows[0][0] === 'cost to small teams' && look.table.rows[1][3] === 'no', JSON.stringify(look.table));
check('the table is the agent\'s, part of the answer, marked as a comparison', look.table?.author === 'Verifier' && look.table?.compare === true);
check('it sits under the option cards, lined up with them, on top of nothing', look.under && look.alignedLeft && look.overlaps === 0, JSON.stringify({ under: look.under, alignedLeft: look.alignedLeft, overlaps: look.overlaps }));
check('its text stays inside its cells and the table', look.fits && look.contained, JSON.stringify({ fits: look.fits, contained: look.contained }));
check('"3 options" is announced: the table is not counted as an option', /3 options/.test(look.heard), look.heard);
await p.evaluate((id) => { const ed = window.__pairedEditor; const ids = ed.getCurrentPageShapes().filter((s) => s.id === id || s.meta.replyTo === id).map((s) => s.id); ed.zoomToBounds(ids.map((i) => ed.getShapePageBounds(i)).reduce((a, b) => a.union(b)), { animation: { duration: 0 }, targetZoom: 1 }); }, ask);
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/2-compared.png` });

const read = await command('read', {});
const seen = (read.result?.objects ?? []).find((o) => o.type === 'datatable');
check('an agent reading the board gets the table\'s rows', Boolean(seen && JSON.stringify(seen).includes('predictable bill')), JSON.stringify(seen ?? {}).slice(0, 160));

await p.evaluate(() => { window.paired.select([]); window.__pairedEditor.focus(); });
await p.keyboard.press(`${mod}+z`);
await p.waitForTimeout(500);
const after = await p.evaluate((askId) => ({ count: window.__pairedEditor.getCurrentPageShapes().length, left: window.__pairedEditor.getCurrentPageShapes().filter((s) => s.meta.replyTo === askId).length }), ask);
check('one undo takes the whole answer back, table included', after.left === 0 && after.count === before, JSON.stringify({ before, ...after }));
check('no page errors', errors.length === 0, errors.join(' | '));

await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
