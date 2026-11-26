// Browser check for PDF import, on a fresh profile: notes.pdf (the synthetic notes printed by
// Chromium) chosen from the menu becomes its sections under its title, in order across its two
// pages; a file that is not a readable PDF says so and creates nothing.
//
//   cd <a directory where playwright is installed>
//   node <repo>/packages/canvas/tools/verify-pdf.mjs <screenshot dir> [http://localhost:5199]
//
// Needs a dev server for this checkout with an empty board store (packages/canvas/.local/boards).
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-pdf.mjs <screenshot dir> [origin]');
mkdirSync(out, { recursive: true });
const ORIGIN = process.argv[3] ?? 'http://localhost:5199';
const fixture = (name) => readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'pdf-profile-')), { viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
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
await p.locator('input[aria-label="Import a file"]').setInputFiles(new URL('../test/fixtures/notes.pdf', import.meta.url).pathname);
await p.waitForTimeout(1800);
let objs = await objects();
const sections = objs.filter(o => o.meta.source?.kind === 'section' && o.meta.source.from === 'notes.pdf').sort((a, b) => a.meta.source.order - b.meta.source.order);
check('a PDF becomes its sections, in order across pages', sections.map(s => s.meta.name).join(' | ') === 'What the route is for | What worries the assessors | What to do next | What to do next (continued) | Second page heading', sections.map(s => s.meta.name).join(' | '));
const header = objs.filter(o => o.meta.source?.kind === 'header').map(o => o.text).join(' ');
check('under its title', header.includes('Larkspur Ferries: route review notes') && header.includes('from notes.pdf'), header.slice(0, 90));
check('the list stays a list', sections[1]?.text.includes('• The winter passenger numbers rest on one summer survey.') && sections[1]?.text.includes('• The terminal lease'), sections[1]?.text.slice(0, 120));
check('text stays inside every card', (await spills()).length === 0);
await shot('01-pdf-sections');
await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(600);
check('one undo removes it', (await objects()).length === seed);
await p.locator('input[aria-label="Import a file"]').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not really a pdf') }); await p.waitForTimeout(600);
const toast = await p.locator('.toast').allTextContents();
check('a file that is not a readable PDF says so and creates nothing', toast.some(t => t.includes('not a PDF that can be read')) && (await objects()).length === seed, JSON.stringify(toast));
check('no errors in the page', errs.length === 0, errs.join(' | '));
await ctx.close();
console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
