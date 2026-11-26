// Browser check for item 51 on the data prototype, fresh profile: dropping a Windows-1252 CSV
// creates nothing and says how to fix it; a CSV of long IDs keeps them as distinct text; a
// one-column CSV keeps a row holding a quoted empty value.
//
//   cd <a directory where playwright is installed>
//   node <repo>/packages/canvas/tools/verify-csv-faithful.mjs <screenshot dir> [http://localhost:5199]
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-csv-faithful.mjs <screenshot dir> [origin]');
mkdirSync(out, { recursive: true });
const ORIGIN = process.argv[3] ?? 'http://localhost:5199';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'csv-profile-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 300)));
const datasets = () => p.evaluate(() => window.paired.read().objects.filter(o => o.type === 'dataset'));
const drop = (name, bytes, x) => p.evaluate(async ({ name, bytes, x }) => {
  const target = document.querySelector('.tl-canvas') ?? document.body;
  const data = new DataTransfer();
  data.items.add(new File([new Uint8Array(bytes)], name, { type: 'text/csv' }));
  const at = { clientX: x, clientY: 300, bubbles: true, cancelable: true, dataTransfer: data };
  for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, at));
}, { name, bytes: [...bytes], x });

await p.goto(`${ORIGIN}/canvas/?prototype=data`);
await p.waitForSelector('.topbar', { timeout: 20000 });
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 15000 });
await p.waitForTimeout(1200);

const latin1 = Buffer.concat([Buffer.from('dish,price\ncaf'), Buffer.from([0xe9]), Buffer.from(' au lait,3.5\n')]);
await drop('menu.csv', latin1, 400); await p.waitForTimeout(800);
const toast = await p.locator('.toast').textContent().catch(() => '');
check('a Windows-1252 file creates nothing', (await datasets()).length === 0);
check('and says how to fix it', /menu\.csv was not imported: It is not UTF-8 text .* near line 2 .*CSV UTF-8/.test(toast), toast);
await p.screenshot({ path: `${out}/01-not-utf8.png` });

await drop('accounts.csv', Buffer.from('account,balance\n9007199254740993,10\n9007199254740992,20\n'), 400); await p.waitForTimeout(1000);
let ds = await datasets();
const data = await p.evaluate((id) => window.__pairedEditor.getShape(id)?.props.data, ds[0]?.id);
check('long IDs stay text and distinct', data?.columns?.[0]?.type === 'text' && data.rows[0].account === '9007199254740993' && data.rows[1].account === '9007199254740992', JSON.stringify(data?.rows));
await drop('notes.csv', Buffer.from('note\nfirst\n""\nlast\n'), 900); await p.waitForTimeout(1000);
ds = await datasets();
const notes = await p.evaluate((ids) => ids.map(id => window.__pairedEditor.getShape(id)?.props.data).find(d => d?.title === 'notes'), ds.map(d => d.id));
check('a quoted empty value keeps its row', notes?.rows?.length === 3 && notes.rows[1].note === '', JSON.stringify(notes?.rows));
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/02-ids-and-notes.png` });
check('no errors in the page', errs.length === 0, errs.join(' | '));
await ctx.close();
console.log(`\n${results.filter(Boolean).length} of ${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
