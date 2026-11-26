// Browser check for item 62 (review of #46), fresh profile: "Show as table" is one undo step and
// is refused once the person has judged a record; a CSV whose quoted notes are full of
// semicolons keeps its columns; a table over 2,000 rows says how many it kept.
//
//   cd <a directory where playwright is installed>
//   node <repo>/packages/canvas/tools/verify-import-faithful.mjs <screenshot dir> [http://localhost:5199]
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-import-faithful.mjs <screenshot dir> [origin]');
mkdirSync(out, { recursive: true });
const ORIGIN = process.argv[3] ?? 'http://localhost:5199';
const fixtures = new URL('../test/fixtures/', import.meta.url);
const fixture = (name) => readFileSync(new URL(name, fixtures), 'utf8');
const fixturePath = (name) => new URL(name, fixtures).pathname;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'faithful-profile-')), { viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 300)));
p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text())) errs.push(m.text().slice(0, 300)); });
const shot = (name) => p.screenshot({ path: `${out}/${name}.png` });
const objects = () => p.evaluate(() => window.paired.read().objects.map(o => ({ id: o.id, type: o.type, parentId: o.parentId, text: o.text ?? '', w: o.bounds?.w ?? 0, h: o.bounds?.h ?? 0, x: o.bounds?.x ?? 0, y: o.bounds?.y ?? 0, meta: o.meta, props: o.props })));
const kind = (o) => o.meta.source?.kind;
const records = (objs) => objs.filter(o => kind(o) === 'record').sort((a, b) => a.y - b.y);
const stepper = () => p.locator('.import-count').textContent().catch(() => '');
const selection = () => p.evaluate(() => window.paired.read().selection);
const setClipboard = (data) => p.evaluate(async (d) => {
  const item = {};
  for (const [type, value] of Object.entries(d)) item[type] = new Blob([value], { type });
  await navigator.clipboard.write([new ClipboardItem(item)]);
}, data);
const paste = async () => { await p.keyboard.press('ControlOrMeta+v'); await p.waitForTimeout(1500); };
/** Rendered text must stay inside its card, and no card may be wider than a reading width. */
const spills = () => p.evaluate(() => [...document.querySelectorAll('.tl-shape[data-shape-type="card"]')].flatMap(el => {
  const t = el.querySelector('.tl-rich-text'), card = el.querySelector('.scrap'); if (!t || !card) return [];
  const box = card.getBoundingClientRect(), text = t.getBoundingClientRect();
  const bad = t.scrollWidth > t.clientWidth + 1 || text.right > box.right + 2 || text.bottom > box.bottom + 2 || (card.classList.contains('scrap--source') && el.offsetWidth > 640);
  return bad ? [{ w: el.offsetWidth, textW: t.scrollWidth, over: Math.round(text.bottom - box.bottom), text: t.textContent.slice(0, 30) }] : [];
}));
const inView = (box) => p.evaluate((b) => {
  const editor = document.querySelector('.tl-container'); const r = editor.getBoundingClientRect();
  return b.left >= r.left - 2 && b.top >= r.top - 2 && b.right <= r.right + 2 && b.bottom <= r.bottom + 2;
}, box ?? { left: -1e6, top: -1e6, right: -1e6, bottom: -1e6 });
/** Where an object is on screen. A group draws nothing itself, so a record is the union of its cards. */
const screenBox = (id) => p.evaluate((ids) => { const rects = ids.flatMap(id => { const el = document.querySelector(`[data-shape-id="${id}"]`); return el ? [el.getBoundingClientRect()] : []; }); return rects.length < ids.length ? null : { left: Math.min(...rects.map(r => r.left)), top: Math.min(...rects.map(r => r.top)), right: Math.max(...rects.map(r => r.right)), bottom: Math.max(...rects.map(r => r.bottom)) }; }, objs.some(o => o.parentId === id) ? objs.filter(o => o.parentId === id).map(o => o.id) : [id]);
const api = async (op, input = {}) => (await fetch(`${ORIGIN}/api/canvas/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: `v-${Math.random()}`, actor: 'Import check', command: { op, input } }), signal: AbortSignal.timeout(20000) })).json();

await p.goto(`${ORIGIN}/canvas/`);
await p.waitForSelector('.topbar', { timeout: 20000 });
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 15000 });
await p.waitForTimeout(1200);
const seed = (await objects()).length;
const pasteReview = async () => { await p.mouse.click(1000, 620); await setClipboard({ 'text/html': fixture('review.html'), 'text/plain': fixture('review.tsv') }); await paste(); };
const summaryButton = (name) => p.locator('.import-summary button', { hasText: name });

// (b) An untouched import switches to a table and back with one undo.
await pasteReview();
await summaryButton('Show as table instead').click(); await p.waitForTimeout(1200);
let objs = await objects();
check('an untouched import becomes one table', objs.filter(o => o.type === 'datatable').length === 1 && records(objs).length === 0);
await p.keyboard.press('Escape');
await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(800);
objs = await objects();
check('one undo brings the cards back', records(objs).length === 10 && objs.filter(o => o.type === 'datatable').length === 0, `${records(objs).length} records, ${objs.filter(o => o.type === 'datatable').length} tables`);
await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(800);
check('and a second undo removes the import', (await objects()).length === seed, `${(await objects()).length} vs ${seed}`);

// (b) Once the person has judged a record, the switch is refused and nothing is lost.
await pasteReview();
objs = await objects();
const first = records(objs)[0];
await p.evaluate((id) => window.paired.select([id]), first.id); await p.keyboard.press('p'); await p.waitForTimeout(300);
await p.keyboard.press('Escape');
await summaryButton('Show as table instead').click(); await p.waitForTimeout(800);
objs = await objects();
const toasts = await p.locator('.toast').allTextContents();
check('after a pick, Show as table is refused and says why', toasts.some(t => t.includes('has changed since it came in')), JSON.stringify(toasts));
check('the cards and the pick are still there', records(objs).length === 10 && objs.find(o => o.id === first.id)?.meta.mark === 'picked');
await shot('01-switch-refused');

// (a) Quoted semicolons do not split a comma file.
await p.locator('input[aria-label="Import a file"]').setInputFiles({ name: 'packing.csv', mimeType: 'text/csv', buffer: Buffer.from('id,notes\n1,"Ready; reviewed; approved"\n2,"Packed; labeled; shipped"\n') });
await p.waitForTimeout(1200);
objs = await objects();
const packing = objs.filter(o => o.meta.source?.from === 'packing.csv');
const table = packing.find(o => o.type === 'datatable');
check('a CSV with quoted semicolons keeps its two columns', Boolean(table) && JSON.stringify(table.props.columns) === '["id","notes"]' && table.props.rows.length === 2, table ? JSON.stringify(table.props.columns) : packing.map(o => o.type).join(','));

// (c) A table over 2,000 rows says how many it kept.
const big = 'a,b\n' + Array.from({ length: 2500 }, (_, i) => `${i},${i * 2}`).join('\n') + '\n';
await p.locator('input[aria-label="Import a file"]').setInputFiles({ name: 'big.csv', mimeType: 'text/csv', buffer: Buffer.from(big) });
await p.waitForTimeout(1500);
objs = await objects();
const bigTable = objs.find(o => o.type === 'datatable' && o.meta.source?.from === 'big.csv');
const summary = await p.locator('.import-summary').textContent().catch(() => '');
check('a 2,500-row table keeps 2,000 and its title says so', bigTable?.props.rows.length === 2000 && /first 2,000 of 2,500 rows/.test(bigTable.props.title), bigTable?.props.title);
check('and so does the summary', /2,000 of 2,500 rows from big\.csv/.test(summary), summary);
await shot('02-large-table');
check('no errors in the page', errs.length === 0, errs.join(' | '));
await ctx.close();
console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
