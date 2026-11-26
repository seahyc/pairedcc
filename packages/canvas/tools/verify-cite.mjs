// Browser check for bringing cited sections beside a record, on a fresh profile: paste the
// synthetic review, import the synthetic pack it cites, select the record that cites Q56, Q16
// and Q49, press "Show Q56, Q16, Q49", and check the three sections stand beside the record in
// that order, linked by reference arrows, clear of everything, as one undo step.
//
//   cd <a directory where playwright is installed>
//   node <repo>/packages/canvas/tools/verify-cite.mjs <screenshot dir> [http://localhost:5199]
//
// Needs a dev server for this checkout with an empty board store (packages/canvas/.local/boards).
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-cite.mjs <screenshot dir> [origin]');
mkdirSync(out, { recursive: true });
const ORIGIN = process.argv[3] ?? 'http://localhost:5199';
const fixture = (name) => readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'cite-profile-')), { viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 300)));
p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text())) errs.push(m.text().slice(0, 300)); });
const shot = (name) => p.screenshot({ path: `${out}/${name}.png` });
const objects = () => p.evaluate(() => window.paired.read().objects.map(o => ({ id: o.id, type: o.type, parentId: o.parentId, text: o.text ?? '', x: o.bounds?.x ?? 0, y: o.bounds?.y ?? 0, w: o.bounds?.w ?? 0, h: o.bounds?.h ?? 0, meta: o.meta })));
const records = (objs) => objs.filter(o => o.meta.source?.kind === 'record').sort((a, b) => a.y - b.y);
const fields = (objs, id) => objs.filter(o => o.parentId === id && o.meta.source?.kind === 'field').sort((a, b) => a.x - b.x);
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const button = () => p.locator('.selection-bar button', { hasText: /^Show Q/ });
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
const recs = records(objs);
check('the pasted review is ten records', recs.length === 10, `${recs.length}`);
const fleet = recs.find(r => r.meta.source.values?.Q === 'Q56 vs Q16/Q49');
await p.evaluate((id) => window.paired.select([id]), fleet.id); await p.waitForTimeout(300);
check('before the pack is imported, no Show button', await button().count() === 0);

await p.locator('input[aria-label="Import a file"]').setInputFiles(new URL('../test/fixtures/pack.md', import.meta.url).pathname);
await p.waitForTimeout(1500);
objs = await objects();
const sections = objs.filter(o => o.meta.source?.kind === 'section');
check('the pack is twelve sections', sections.length === 12, `${sections.length}`);
const sectionOf = (code) => sections.find(s => String(s.meta.name).startsWith(`${code}.`));
const before = Object.fromEntries(['Q56', 'Q16', 'Q49'].map(c => [c, sectionOf(c)]));

// The person steps to the fleet-cost record (J until it is selected).
await p.evaluate((id) => window.paired.select([id]), fleet.id);
await p.evaluate(() => { window.__pairedEditor.zoomToSelection(); });
await p.waitForTimeout(500);
check('one record that cites sections: the bar names them', (await button().textContent())?.trim() === 'Show Q56, Q16, Q49', await button().textContent());
await shot('01-record-selected');
await button().click();
await p.waitForTimeout(900);
objs = await objects();
const rec = objs.find(o => o.id === fleet.id);
const moved = ['Q56', 'Q16', 'Q49'].map(c => objs.find(o => o.id === before[c].id));
check('the three sections stand just right of the record', moved.every(s => s.x > rec.x + rec.w && s.x - (rec.x + rec.w) < 400 && Math.abs(s.x - moved[0].x) < 1), moved.map(s => Math.round(s.x)).join(',') + ` record right ${Math.round(rec.x + rec.w)}`);
check('top-aligned with the record, in the order cited', Math.abs(moved[0].y - rec.y) < 1 && moved[0].y < moved[1].y && moved[1].y < moved[2].y, moved.map(s => Math.round(s.y)).join(','));
const others = objs.filter(o => o.type !== 'arrow' && o.type !== 'group' && !moved.some(m => m.id === o.id) && o.parentId?.startsWith('page:'));
check('nothing else is underneath them', moved.every(m => others.every(o => !overlaps(m, o))), moved.flatMap(m => others.filter(o => overlaps(m, o)).map(o => o.meta.name)).join(', '));
const title = objs.filter(o => o.parentId === fleet.id && o.meta.source?.kind === 'field').sort((a, b) => a.y - b.y || b.x - a.x)[0];
const arrows = objs.filter(o => o.type === 'arrow' && o.meta.fromId === title.id);
check('each is linked from the record by a reference arrow', arrows.length === 3 && moved.every(m => arrows.some(a => a.meta.toId === m.id && a.meta.relation === 'reference')), `${arrows.length} arrows`);
check('the other nine sections did not move', sections.filter(s => !moved.some(m => m.id === s.id)).every(s => { const n = objs.find(o => o.id === s.id); return Math.abs(n.x - s.x) < 1 && Math.abs(n.y - s.y) < 1; }));
check('text stays inside every card', (await spills()).length === 0);
await p.waitForTimeout(300);
await shot('02-cited-beside');

// Again: gathered again, no second set of arrows.
await p.evaluate((id) => window.paired.select([id]), fleet.id); await p.waitForTimeout(300);
await button().click(); await p.waitForTimeout(600);
objs = await objects();
check('pressing it again adds no arrows', objs.filter(o => o.type === 'arrow' && o.meta.fromId === title.id).length === 3);
await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(400);
await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(600);
objs = await objects();
check('undo puts the sections back and removes the arrows', ['Q56', 'Q16', 'Q49'].every(c => { const n = objs.find(o => o.id === before[c].id); return Math.abs(n.x - before[c].x) < 1 && Math.abs(n.y - before[c].y) < 1; }) && objs.filter(o => o.type === 'arrow' && o.meta.fromId === title.id).length === 0);

// A record citing a code the pack does not have says so.
const env = recs.find(r => r.meta.source.values?.Q === 'Q40/Q41');
await p.evaluate((id) => window.paired.select([id]), env.id); await p.waitForTimeout(300);
check('a record citing Q40/Q41 offers only Q40', (await button().textContent())?.trim() === 'Show Q40', await button().textContent());
await button().click(); await p.waitForTimeout(600);
const notice = await p.locator('.notice, [role="status"]').allTextContents();
check('and says Q41 is not on this page', notice.some(t => t.includes('Not on this page: Q41')), JSON.stringify(notice));
check('no errors in the page', errs.length === 0, errs.join(' | '));
await ctx.close();
console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
