// Browser check for "Side by side" on imported records, on a fresh profile: paste the synthetic
// review, select two records that are far apart, press Side by side, and check that the lower one
// now sits directly under the upper one with its columns lined up, nothing overlaps, the
// records keep their order otherwise, one undo puts everything back, and text stays in its cards.
//
//   cd <a directory where playwright is installed>
//   node <repo>/packages/canvas/tools/verify-compare.mjs <screenshot dir> [http://localhost:5199]
//
// Needs a dev server for this checkout with an empty board store (packages/canvas/.local/boards).
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-compare.mjs <screenshot dir> [origin]');
mkdirSync(out, { recursive: true });
const ORIGIN = process.argv[3] ?? 'http://localhost:5199';
const fixture = (name) => readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'compare-profile-')), { viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 300)));
p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text())) errs.push(m.text().slice(0, 300)); });
const shot = (name) => p.screenshot({ path: `${out}/${name}.png` });
const objects = () => p.evaluate(() => window.paired.read().objects.map(o => ({ id: o.id, type: o.type, parentId: o.parentId, text: o.text ?? '', x: o.bounds?.x ?? 0, y: o.bounds?.y ?? 0, w: o.bounds?.w ?? 0, h: o.bounds?.h ?? 0, meta: o.meta })));
const records = (objs) => objs.filter(o => o.meta.source?.kind === 'record').sort((a, b) => a.y - b.y);
const fields = (objs, id) => objs.filter(o => o.parentId === id && o.meta.source?.kind === 'field').sort((a, b) => a.x - b.x);
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const button = () => p.locator('.selection-bar button', { hasText: 'Side by side' });
const spills = () => p.evaluate(() => [...document.querySelectorAll('.tl-shape[data-shape-type="card"]')].flatMap(el => {
  const t = el.querySelector('.tl-rich-text'), card = el.querySelector('.scrap'); if (!t || !card) return [];
  const box = card.getBoundingClientRect(), text = t.getBoundingClientRect();
  return t.scrollWidth > t.clientWidth + 1 || text.right > box.right + 2 || text.bottom > box.bottom + 2 ? [t.textContent.slice(0, 30)] : [];
}));

await p.goto(`${ORIGIN}/canvas/`);
await p.waitForSelector('.topbar', { timeout: 20000 });
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 15000 });
await p.waitForTimeout(1200);
await p.mouse.click(1000, 620);
await p.evaluate(async (d) => {
  const item = {};
  for (const [type, value] of Object.entries(d)) item[type] = new Blob([value], { type });
  await navigator.clipboard.write([new ClipboardItem(item)]);
}, { 'text/html': fixture('review.html'), 'text/plain': fixture('review.tsv') });
await p.keyboard.press('ControlOrMeta+v');
await p.waitForTimeout(1500);
let objs = await objects();
const before = records(objs);
check('the pasted review is ten records', before.length === 10, `${before.length}`);

// One record alone, or a record with something that is not a record: no Side by side.
await p.evaluate((id) => window.paired.select([id]), before[0].id); await p.waitForTimeout(300);
check('one record selected: no Side by side', await button().count() === 0);
const seedCard = objs.find(o => o.type === 'card' && !o.meta.source);
await p.evaluate((ids) => window.paired.select(ids), [before[0].id, seedCard.id]); await p.waitForTimeout(300);
check('a record and a note selected: no Side by side', await button().count() === 0);

// The first and the fourth record: three apart on the board.
const [upper, lower] = [before[0], before[3]];
await p.evaluate((ids) => window.paired.select(ids), [lower.id, upper.id]);
await p.evaluate(() => { window.__pairedEditor.zoomToSelection(); }); // the person zooms out to see both
await p.waitForTimeout(500);
check('two records selected: Side by side is offered', await button().count() === 1);
await shot('01-two-records-selected');
await button().click();
await p.waitForTimeout(800);
objs = await objects();
const after = records(objs);
const byId = Object.fromEntries(after.map(r => [r.id, r]));
check('the lower record now sits directly under the upper one', Math.abs(byId[lower.id].y - before[1].y) < 1 && after[1].id === lower.id, `${Math.round(byId[lower.id].y)} vs ${Math.round(before[1].y)}`);
check('the order is otherwise kept', after.map(r => before.findIndex(b => b.id === r.id)).join(',') === '0,3,1,2,4,5,6,7,8,9', after.map(r => before.findIndex(b => b.id === r.id)).join(','));
const upperFields = fields(objs, upper.id), lowerFields = fields(objs, lower.id);
check('the same columns line up', upperFields.length === lowerFields.length && upperFields.every((f, i) => Math.abs(f.x - lowerFields[i].x) < 1 && f.meta.source.column === lowerFields[i].meta.source.column), upperFields.map((f, i) => `${f.meta.source.column}@${Math.round(f.x)}/${Math.round(lowerFields[i]?.x)}`).join(' '));
check('no two records overlap', after.every(a => after.every(b => a === b || !overlaps(a, b))));
check('records after the pair did not move', before.slice(4).every(b => Math.abs(byId[b.id].y - b.y) < 1 && Math.abs(byId[b.id].x - b.x) < 1));
const sel = await p.evaluate(() => window.paired.read().selection);
check('both records stay selected', [upper.id, lower.id].every(id => sel.includes(id)), JSON.stringify(sel));
check('text stays inside every card', (await spills()).length === 0);
await p.waitForTimeout(400);
await shot('02-side-by-side');

// Straight after, as a person would. (Escape first would itself be an undo step: tldraw records
// clearing a selection, so the first undo would bring the selection back.)
await p.keyboard.press('ControlOrMeta+z');
await p.waitForTimeout(600);
objs = await objects();
const undone = records(objs);
check('one undo puts every record back', before.every(b => { const r = undone.find(u => u.id === b.id); return r && Math.abs(r.y - b.y) < 1 && Math.abs(r.x - b.x) < 1; }), before.map(b => { const r = undone.find(u => u.id === b.id); return r ? `${Math.round(b.y)}→${Math.round(r.y)}` : 'gone'; }).join(' '));
check('no errors in the page', errs.length === 0, errs.join(' | '));
await ctx.close();
console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
