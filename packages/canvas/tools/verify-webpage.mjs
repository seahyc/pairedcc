// Browser check for web pages, on a fresh profile: a saved page chosen from the menu becomes its
// article's sections under its title, without navigation, scripts or footer; a stretch copied
// from a page (HTML with headings) pastes as section cards; one copied paragraph stays one object.
//
//   cd <a directory where playwright is installed>
//   node <repo>/packages/canvas/tools/verify-webpage.mjs <screenshot dir> [http://localhost:5199]
//
// Needs a dev server for this checkout with an empty board store (packages/canvas/.local/boards).
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-webpage.mjs <screenshot dir> [origin]');
mkdirSync(out, { recursive: true });
const ORIGIN = process.argv[3] ?? 'http://localhost:5199';
const fixture = (name) => readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'webpage-profile-')), { viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
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
const seed = (await objects()).length;

await p.locator('input[aria-label="Import a file"]').setInputFiles(new URL('../test/fixtures/article.html', import.meta.url).pathname);
await p.waitForTimeout(1500);
let objs = await objects();
const sections = objs.filter(o => o.meta.source?.kind === 'section' && o.meta.source.from === 'article.html').sort((a, b) => a.y - b.y);
check('a saved web page becomes four sections', sections.length === 4, `${sections.length}`);
check('in reading order, with the page headings', sections.slice(1).map(s => s.meta.name).join(' | ') === 'What the operator says | What the assessors will ask | What happens next', sections.map(s => s.meta.name).join(' | '));
const headerText = objs.filter(o => o.meta.source?.kind === 'header').map(o => o.text).join(' ');
check('under the article title', headerText.includes('Second ferry for the estuary?'), headerText.slice(0, 80));
const allText = objs.map(o => o.text).join(' ');
check('without navigation, scripts, asides or footer', !['Subscribe now', 'TRACKING CODE', 'Pier repairs', 'All rights reserved', 'Sign up'].some(j => allText.includes(j)));
check('text stays inside every card', (await spills()).length === 0);
await shot('01-web-page-sections');

await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(600);
check('one undo removes it', (await objects()).length === seed);

const para = 'The operator says the crossing saves commuters a long drive around the estuary, and that demand has grown every summer. ';
const setClipboard = (d) => p.evaluate(async (d) => {
  const item = {};
  for (const [type, value] of Object.entries(d)) item[type] = new Blob([value], { type });
  await navigator.clipboard.write([new ClipboardItem(item)]);
}, d);
await p.mouse.click(1000, 620);
await setClipboard({ 'text/html': `<meta charset="utf-8"><h2>What the operator says</h2><p>${para.repeat(2)}</p><h2>What the assessors will ask</h2><p>${'Assessors will question the forecast and the lease. '.repeat(4)}</p>`, 'text/plain': `What the operator says\n${para}\nWhat the assessors will ask\nAssessors will question the forecast and the lease.` });
await p.keyboard.press('ControlOrMeta+v'); await p.waitForTimeout(1500);
objs = await objects();
const pasted = objs.filter(o => o.meta.source?.kind === 'section' && o.meta.source.from === 'pasted').sort((a, b) => a.y - b.y);
check('a stretch copied from a web page pastes as its sections', pasted.map(s => s.meta.name).join(' | ') === 'What the operator says | What the assessors will ask', pasted.map(s => s.meta.name).join(' | '));
await shot('02-web-paste-sections');
await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(600);
await setClipboard({ 'text/html': '<p>Charge per seat, not per company.</p>', 'text/plain': 'Charge per seat, not per company.' });
await p.mouse.click(1000, 620);
await p.keyboard.press('ControlOrMeta+v'); await p.waitForTimeout(1200);
objs = await objects();
check('one copied paragraph is still one ordinary object', objs.length === seed + 1 && objs.some(o => o.text.includes('Charge per seat') && !o.meta.source));
check('no errors in the page', errs.length === 0, errs.join(' | '));
await ctx.close();
console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
