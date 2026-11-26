// Browser check for item 70: Side by side and "Show cited" bring comments along. On a fresh
// profile: paste the synthetic review and import the synthetic pack it cites; the person comments
// on a section the fleet-cost record cites and on a record that Side by side will slide down.
// Pressing "Show Q56, Q16, Q49" and "Side by side" moves those objects without their being
// selected; each comment must move by the same amount as its object, in the same undo step.
//
//   cd <a directory where playwright is installed>
//   node <repo>/packages/canvas/tools/verify-import-follow.mjs <screenshot dir> [http://localhost:5183]
//
// Needs a dev server for this checkout with an empty board store (PAIRED_BOARDS_DIR set to a new folder).
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-import-follow.mjs <screenshot dir> [origin]');
mkdirSync(out, { recursive: true });
const ORIGIN = process.argv[3] ?? 'http://localhost:5183';
const fixture = (name) => readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8');

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'import-follow-')), { viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 300)));
const objects = () => p.evaluate(() => window.paired.read().objects.map(o => ({ id: o.id, type: o.type, parentId: o.parentId, text: o.text ?? '', x: o.bounds?.x ?? 0, y: o.bounds?.y ?? 0, w: o.bounds?.w ?? 0, h: o.bounds?.h ?? 0, meta: o.meta })));
const byId = (objs, id) => objs.find(o => o.id === id);
const records = (objs) => objs.filter(o => o.meta.source?.kind === 'record').sort((a, b) => a.y - b.y);
const select = async (ids) => { await p.evaluate((ids) => window.paired.select(ids), ids); await p.waitForTimeout(250); };
const near = (a, b) => Math.abs(a - b) < 1;

// The person's own comment: select, C, type, Esc.
async function comment(targetId, text) {
  await select([targetId]);
  await p.keyboard.press('c');
  await p.waitForTimeout(300);
  await p.keyboard.type(text);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  const found = (await objects()).find(o => o.meta.targetId === targetId && o.text.includes(text));
  if (!found) throw new Error(`no comment on ${targetId}`);
  return found.id;
}
const delta = (before, after, id) => [byId(after, id).x - byId(before, id).x, byId(after, id).y - byId(before, id).y];

await p.goto(`${ORIGIN}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 20000 });
await p.waitForTimeout(1200);
await p.mouse.click(1000, 620);
await p.evaluate(async (d) => {
  const item = {};
  for (const [type, value] of Object.entries(d)) item[type] = new Blob([value], { type });
  await navigator.clipboard.write([new ClipboardItem(item)]);
}, { 'text/html': fixture('review.html'), 'text/plain': fixture('review.tsv') });
await p.keyboard.press('ControlOrMeta+v');
await p.waitForTimeout(1500);
await p.locator('input[aria-label="Import a file"]').setInputFiles(new URL('../test/fixtures/pack.md', import.meta.url).pathname);
await p.waitForTimeout(1500);
let objs = await objects();
const recs = records(objs);
const fleet = recs.find(r => r.meta.source.values?.Q === 'Q56 vs Q16/Q49');
const q16 = objs.find(o => o.meta.source?.kind === 'section' && String(o.meta.name).startsWith('Q16.'));
check('the review and the pack are on the board', recs.length === 10 && Boolean(fleet) && Boolean(q16));

// --- Show cited ---
const onSection = await comment(q16.id, 'Is this figure still current?');
await select([fleet.id]);
const before = await objects();
await p.locator('.selection-bar button', { hasText: /^Show Q/ }).click();
await p.waitForTimeout(900);
objs = await objects();
const [sx, sy] = delta(before, objs, q16.id), [cx, cy] = delta(before, objs, onSection);
check('Show cited moved the cited section', Math.abs(sx) + Math.abs(sy) > 1, `${Math.round(sx)},${Math.round(sy)}`);
check('the comment on the section moved by the same amount', near(sx, cx) && near(sy, cy), `section ${Math.round(sx)},${Math.round(sy)} · comment ${Math.round(cx)},${Math.round(cy)}`);
await p.evaluate(() => window.paired.select([]));
await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/import-follow-cited.png` });
await p.keyboard.press('ControlOrMeta+z');
await p.waitForTimeout(500);
objs = await objects();
check('one undo puts the section and its comment back', near(byId(objs, q16.id).x, byId(before, q16.id).x) && near(byId(objs, onSection).x, byId(before, onSection).x) && near(byId(objs, onSection).y, byId(before, onSection).y));

// --- Side by side: the first and sixth records; those between slide down ---
const [upper, , slid, , , lower] = recs;
const onSlid = await comment(slid.id, 'Weakest defence so far');
const onLower = await comment(lower.id, 'Compare with the first');
await select([upper.id, lower.id]);
const pre = await objects();
await p.locator('.selection-bar button', { hasText: 'Side by side' }).click();
await p.waitForTimeout(900);
objs = await objects();
const [, ry] = delta(pre, objs, slid.id), [, ky] = delta(pre, objs, onSlid);
const [, ly] = delta(pre, objs, lower.id), [, my] = delta(pre, objs, onLower);
check('Side by side slid a record between them down', ry > 1, `${Math.round(ry)}`);
check('the comment on that record slid with it', near(ry, ky), `record ${Math.round(ry)} · comment ${Math.round(ky)}`);
check('the comment on the record brought up came with it', near(ly, my), `record ${Math.round(ly)} · comment ${Math.round(my)}`);
await p.evaluate(() => window.paired.select([]));
await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/import-follow-side-by-side.png` });
await p.keyboard.press('ControlOrMeta+z');
await p.waitForTimeout(500);
objs = await objects();
check('one undo puts records and comments back', [slid.id, onSlid, lower.id, onLower].every(id => near(byId(objs, id).y, byId(pre, id).y)));
check('no errors in the page', errs.length === 0, errs.join(' | '));
await ctx.close();
console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
