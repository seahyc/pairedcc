// Browser check for import and paste, on a fresh profile: a spreadsheet tab pasted as
// HTML + TSV becomes ten record clusters, the stepper, undo, pick / cross out / comment,
// ask context, a numeric table, a markdown file, an image drop and the agent operation.
//
//   cd <a directory where playwright is installed>
//   node <repo>/packages/canvas/tools/verify-import.mjs <screenshot dir> [http://localhost:5199]
//
// Needs a dev server for this checkout. Playwright is not a dependency of this repository;
// it is loaded from the directory you run this in. All fixtures are synthetic.
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-import.mjs <screenshot dir> [origin]');
mkdirSync(out, { recursive: true });
const ORIGIN = process.argv[3] ?? 'http://localhost:5199';
const fixtures = new URL('../test/fixtures/', import.meta.url);
const fixture = (name) => readFileSync(new URL(name, fixtures), 'utf8');
const fixturePath = (name) => new URL(name, fixtures).pathname;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'import-profile-')), { viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
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
const seedCount = (await objects()).length;

// 1. Ordinary short text keeps its usual paste: one object, no import.
await p.mouse.click(1000, 620);
await setClipboard({ 'text/plain': 'Charge per seat, not per company' });
await paste();
let objs = await objects();
const plain = objs.filter(o => o.text.includes('Charge per seat'));
check('short text paste is still one ordinary object', plain.length === 1 && !plain[0].meta.source && objs.length === seedCount + 1, `${plain.map(o => o.type).join(',')}; ${objs.length - seedCount} new`);
check('no import summary for ordinary text', await p.locator('.import-summary').count() === 0);
await p.evaluate((id) => window.paired.select([id]), plain[0].id); await p.keyboard.press('Backspace'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
const beforeImport = (await objects()).length;

// 2. A spreadsheet tab on the clipboard (HTML table + TSV) becomes ten record clusters.
await setClipboard({ 'text/html': fixture('review.html'), 'text/plain': fixture('review.tsv') });
await p.mouse.click(1000, 620);
await paste();
objs = await objects();
let recs = records(objs);
const childrenOf = (id) => objs.filter(o => o.parentId === id);
check('ten record clusters', recs.length === 10 && recs.every(r => r.type === 'group'), `${recs.length} groups`);
check('each record is a title line and four field cards', recs.every(r => childrenOf(r.id).filter(c => kind(c) === 'title').length === 1 && childrenOf(r.id).filter(c => kind(c) === 'field').length === 4), recs.map(r => childrenOf(r.id).length).join(','));
const fields = objs.filter(o => kind(o) === 'field');
check('field cards are labelled with their column, in column order', (() => {
  const first = childrenOf(recs[0].id).filter(c => kind(c) === 'field').sort((a, b) => a.x - b.x);
  return first.map(c => c.meta.source.column).join('|') === 'How a sceptical reader would attack this|What the pack already says in defence|Gap / exposure|Suggested fix' && first.every(c => c.text.startsWith(c.meta.source.column));
})());
check('the empty Check column is not drawn', !objs.some(o => o.meta.source?.column === 'Check') && recs[0].meta.source.verdictColumns.join() === 'Check');
check('most severe first', recs.map(r => r.meta.source.values.Severity).join(',') === 'Critical,Critical,Critical,High,High,High,Medium,Medium,Medium,Medium', recs.map(r => r.meta.source.values.Severity[0]).join(''));
check('provenance on every imported object', objs.filter(o => o.meta.source).every(o => o.meta.source.from === 'pasted' && /^\d{4}-/.test(o.meta.source.at)) && fields.every(o => o.meta.source.row >= 1 && o.meta.source.row <= 10));
check('clusters do not overlap', recs.every((r, i) => i === 0 || r.y >= recs[i - 1].y + recs[i - 1].h + 20), recs.map(r => Math.round(r.y)).join(','));
check('summary says what happened', /10 records from paste, as cards, most severe first/.test(await p.locator('.import-summary').textContent()), await p.locator('.import-summary').textContent());
const firstBox = await screenBox(recs[0].id), secondBox = await screenBox(recs[1].id);
check('the first record is in view after the import', Boolean(firstBox) && await inView(firstBox));
check('not all ten are in view at once', !(await inView(await screenBox(recs[9].id))));
const look = await p.evaluate(() => {
  const css = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundColor : null; };
  const chip = document.querySelector('.source-chip.sev-0');
  return { source: css('.scrap--source'), human: css('.scrap--human'), agent: css('.scrap--agent'), chip: chip?.textContent, legend: [...document.querySelectorAll('.source-chips')].map(c => c.textContent).find(t => /Critical.*High.*Medium/.test(t)) };
});
check('source cards have their own look, a severity chip and a legend', look.source && look.source !== look.human && look.source !== look.agent && look.chip === 'Critical' && Boolean(look.legend), JSON.stringify(look));
await shot('01-pasted-review-first-records');
void secondBox;
let bad = await spills();
check('text is wrapped inside the cards in view', bad.length === 0, JSON.stringify(bad.slice(0, 3)));

// 3. The whole import is one undo step.
await p.keyboard.press('Escape');
await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(500);
objs = await objects();
check('one undo removes the whole import', objs.filter(o => o.meta.source).length === 0 && objs.length === beforeImport, `${objs.filter(o => o.meta.source).length} imported objects left, ${objs.length} objects, ${beforeImport} before: ${objs.map(o => o.type + ':' + o.text.slice(0, 14)).join(' / ')}`);
await p.keyboard.press('ControlOrMeta+Shift+z'); await p.waitForTimeout(700);
objs = await objects(); recs = records(objs);
check('redo brings it back', recs.length === 10);

// 4. Show as table instead, and back.
await p.locator('.import-summary button', { hasText: 'Show as table instead' }).click(); await p.waitForTimeout(1200);
objs = await objects();
check('the same paste as one table', objs.filter(o => o.type === 'datatable').length === 1 && records(objs).length === 0, `${objs.filter(o => o.type === 'datatable').length} table`);
await shot('02-review-shown-as-table');
await p.locator('.import-summary button', { hasText: 'Show as cards instead' }).click(); await p.waitForTimeout(1200);
objs = await objects(); recs = records(objs);
check('and back to ten record clusters', recs.length === 10 && objs.filter(o => o.type === 'datatable').length === 0);

// 5. Every card wraps: look at the whole import at once.
await p.keyboard.press('Shift+1'); await p.waitForTimeout(1200);
bad = await spills();
const rendered = await p.locator('.scrap--source').count();
check('text is wrapped inside all forty field cards', bad.length === 0 && rendered === 40, `${rendered} rendered, ${JSON.stringify(bad.slice(0, 3))}`);
await shot('03-all-ten-records-overview');

// 6. The stepper.
await p.keyboard.press('Escape');
check('stepper shows the count before stepping', /10 records/.test(await stepper()), await stepper());
await p.keyboard.press('j'); await p.waitForTimeout(600);
check('J goes to the first record', /^1 of 10/.test(await stepper()) && (await selection()).join() === recs[0].id, await stepper());
await p.keyboard.press('j'); await p.waitForTimeout(600);
check('J again goes to the second', /^2 of 10/.test(await stepper()) && (await selection()).join() === recs[1].id, await stepper());
check('the record stepped to is in view, whole', await inView(await screenBox(recs[1].id)));
await shot('04-stepped-to-record-2');
await p.keyboard.press('k'); await p.waitForTimeout(600);
check('K goes back', /^1 of 10/.test(await stepper()));
await p.locator('.import-stepper button[aria-label^="Next"]').click(); await p.waitForTimeout(600);
await p.keyboard.press(']'); await p.waitForTimeout(600);
check('the arrows and ] step too', /^3 of 10/.test(await stepper()) && (await selection()).join() === recs[2].id, await stepper());

// 7. Pick, cross out and comment on a record and on one of its cards.
await p.keyboard.press('p'); await p.waitForTimeout(300);
objs = await objects();
check('P picks the whole record', objs.find(o => o.id === recs[2].id).meta.mark === 'picked');
check('stepper counts it as judged', /1 judged/.test(await p.locator('.import-stepper').textContent()));
const attack = childrenOf(recs[2].id).filter(c => kind(c) === 'field').sort((a, b) => a.x - b.x)[0];
await p.evaluate((id) => window.paired.select([id]), attack.id); await p.waitForTimeout(200);
await p.keyboard.press('x'); await p.waitForTimeout(300);
objs = await objects();
check('X crosses out one card inside a record', objs.find(o => o.id === attack.id).meta.mark === 'rejected');
const defence = childrenOf(recs[2].id).filter(c => kind(c) === 'field').sort((a, b) => a.x - b.x)[1];
await p.evaluate((id) => window.paired.select([id]), defence.id); await p.waitForTimeout(200);
await p.keyboard.press('c'); await p.waitForTimeout(500);
await p.keyboard.type('Only one of three funders signed', { delay: 5 }); await p.keyboard.press('Escape'); await p.waitForTimeout(400);
objs = await objects();
const comment = objs.find(o => o.meta.role === 'annotation' && o.text.includes('Only one of three'));
check('C pins a comment to a card inside a record', Boolean(comment) && comment.meta.targetId === defence.id);
const grown = objs.find(o => o.id === recs[2].id);
check('the comment sits beside the record, not inside it', Boolean(comment) && comment.parentId.startsWith('page:') && comment.x >= recs[2].x + recs[2].w && Math.abs(comment.y - defence.y) < 60 && Math.abs(grown.h - recs[2].h) < 4 && Math.abs(grown.w - recs[2].w) < 4, comment ? `comment at ${Math.round(comment.x)},${Math.round(comment.y)}; record ${Math.round(grown.w)}×${Math.round(grown.h)} was ${Math.round(recs[2].w)}×${Math.round(recs[2].h)}` : '');
await p.keyboard.press('Escape');
await p.evaluate((id) => window.paired.select([id]), recs[2].id); await p.waitForTimeout(300);
await p.evaluate(() => document.activeElement?.blur?.());
await shot('05-picked-crossed-commented');

// 8. A drag moves the cluster together.
const before = (await objects()).find(o => o.id === recs[3].id);
await p.keyboard.press('Escape');
await p.evaluate((id) => window.paired.select([id]), recs[3].id); await p.keyboard.press('Shift+2'); await p.waitForTimeout(700);
const grip = await screenBox(childrenOf(recs[3].id).find(c => kind(c) === 'field').id);
await p.mouse.move(grip.left + 60, grip.top + 40); await p.mouse.down(); await p.mouse.move(grip.left + 160, grip.top + 90, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(400);
objs = await objects();
const after = objs.find(o => o.id === recs[3].id);
check('dragging one card moves the whole record', after.x - before.x > 40 && after.y - before.y > 20 && Math.abs(after.w - before.w) < 2, `moved ${Math.round(after.x - before.x)},${Math.round(after.y - before.y)}`);
await p.keyboard.press('ControlOrMeta+z'); await p.waitForTimeout(300);

// 9. Ask about a record: the agent is given its fields with their column names.
await p.keyboard.press('Escape');
await p.evaluate((id) => window.paired.select([id]), recs[0].id); await p.keyboard.press('Shift+2'); await p.waitForTimeout(700);
await p.locator('.selection-bar button.primary').click(); await p.waitForTimeout(400);
const starterTexts = await p.locator('.ask-starters button').allTextContents();
check('a record offers "Is this point valid?"', starterTexts[0] === 'Is this point valid?', starterTexts.join(' | '));
await shot('06-ask-box-on-a-record');
await p.locator('.ask-starters button', { hasText: 'Is this point valid?' }).click(); await p.waitForTimeout(900);
const asked = await api('asks', { state: 'all' });
const ask = asked.result?.asks?.find(a => a.question === 'Is this point valid?');
const texts = ask?.targets.map(t => t.text) ?? [];
check('the ask carries the title line and the four fields with column names', texts.length === 5 && /^No\.: 2 · Q: Q56 vs Q16\/Q49 · Topic: Fleet cost inconsistency · Severity: Critical/.test(texts[0]) && /^How a sceptical reader would attack this: “Q56 says/.test(texts[1]) && /^Suggested fix: Pick the supplier quote/.test(texts[4]), JSON.stringify(texts.map(t => t.slice(0, 50))));
check('and says it is imported source, with its row', Boolean(ask) && ask.targets.every(t => t.author === 'Imported source (pasted, row 2)'), ask?.targets[0]?.author);
await p.waitForTimeout(400);
await shot('07-ask-on-a-record');
await p.keyboard.press('Escape');

// 10. Pasting while writing in a card goes into the card, not onto the board.
await p.keyboard.press('Shift+1'); await p.waitForTimeout(700);
const countBefore = records(await objects()).length;
const free = await p.evaluate(() => { const o = window.paired.read().objects.filter(o => o.bounds); return { x: Math.max(...o.map(s => s.bounds.x + s.bounds.w)) + 400, y: Math.min(...o.map(s => s.bounds.y)) }; });
const made = await p.evaluate((at) => window.paired.create({ kind: 'text', x: at.x, y: at.y, width: 300, text: 'Notes' }), free);
await p.evaluate((id) => window.paired.select([id]), made); await p.keyboard.press('Shift+2'); await p.waitForTimeout(700);
const spot = await screenBox(made);
await p.mouse.dblclick((spot.left + spot.right) / 2, (spot.top + spot.bottom) / 2); await p.waitForTimeout(500);
const editing = await p.evaluate(() => Boolean(document.activeElement?.closest('[contenteditable]')));
await setClipboard({ 'text/html': fixture('review.html'), 'text/plain': 'a\tb\n1\t2\n3\t4' });
await p.keyboard.press('ControlOrMeta+v'); await p.waitForTimeout(900);
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
objs = await objects();
const typedInto = objs.find(o => o.id === made)?.text ?? '';
check('paste inside a text editor goes into the text and does not import', editing && records(objs).length === countBefore && objs.filter(o => o.type === 'datatable').length === 0 && typedInto.length > 5 && typedInto !== 'Notes', `editing=${editing}, records=${records(objs).length}, text=${JSON.stringify(typedInto.slice(0, 40))}`);
await p.evaluate((id) => window.paired.select([id]), made); await p.keyboard.press('Backspace'); await p.keyboard.press('Escape');

// 11. A grid of numbers stays a table (file chooser).
await p.locator('input[aria-label="Import a file"]').setInputFiles(fixturePath('metrics.csv')); await p.waitForTimeout(1500);
objs = await objects();
const table = objs.find(o => o.type === 'datatable');
check('a numeric CSV stays one table', Boolean(table) && table.props.columns.length === 7 && table.props.rows.length === 6 && table.meta.source.from === 'metrics.csv' && records(objs).length === 10, table ? `${table.props.columns.length}×${table.props.rows.length}` : 'none');
check('its summary offers cards instead', /6 rows from metrics.csv, as a table/.test(await p.locator('.import-summary').textContent()) && await p.locator('.import-summary button', { hasText: 'Show as cards instead' }).count() === 1);
const cells = await p.evaluate(() => { const t = document.querySelector('.source-table table'), wrap = document.querySelector('.source-table-wrap'); return t ? { rows: t.querySelectorAll('tbody tr').length, fits: t.getBoundingClientRect().bottom <= wrap.getBoundingClientRect().bottom + 2 && t.scrollWidth <= wrap.clientWidth + 2 } : null; });
check('the table is drawn whole', cells?.rows === 6 && cells.fits, JSON.stringify(cells));
await shot('08-numeric-table');

// 12. A markdown file becomes section cards in reading order.
await p.locator('input[aria-label="Import a file"]').setInputFiles(fixturePath('notes.md')); await p.waitForTimeout(1500);
objs = await objects();
const sections = objs.filter(o => kind(o) === 'section').sort((a, b) => a.y - b.y);
check('a markdown file becomes one card per section, in order', sections.length === 3 && sections.map(s => s.text.split(' ').slice(0, 2).join(' ')).join('|') === 'What the|What worries|What to' && sections.every(s => s.meta.source.from === 'notes.md'), sections.map(s => s.text.slice(0, 16)).join('|'));
bad = await spills();
check('section text is wrapped', bad.length === 0, JSON.stringify(bad.slice(0, 2)));
check('the stepper follows the newest import', /3 sections/.test(await stepper()), await stepper());
await p.keyboard.press('j'); await p.waitForTimeout(500);
check('and steps through its sections', /^1 of 3/.test(await stepper()), await stepper());
await shot('09-markdown-sections');

// 13. An image dropped on the board.
const png = readFileSync(new URL('swatch.png', fixtures)).toString('base64');
await p.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const data = new DataTransfer();
  data.items.add(new File([bytes], 'swatch.png', { type: 'image/png' }));
  const target = document.querySelector('.tl-canvas') ?? document.querySelector('.tl-container');
  for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, clientX: 760, clientY: 430 }));
}, png);
await p.waitForTimeout(2500);
objs = await objects();
const image = objs.find(o => o.type === 'image');
check('a dropped image becomes an image, marked with its file name', Boolean(image) && image.meta.source?.kind === 'image' && image.meta.source.from === 'swatch.png', image ? JSON.stringify(image.meta.source) : 'no image');
await shot('10-image-dropped');
await p.locator('input[aria-label="Import a file"]').setInputFiles({ name: 'book.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK') }); await p.waitForTimeout(500);
check('a broken .xlsx file says plainly it cannot be read', /not an Excel workbook that can be read/.test(await p.locator('.toast').textContent().catch(() => '')));
await p.locator('input[aria-label="Import a file"]').setInputFiles({ name: 'old.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('xx') }); await p.waitForTimeout(500);
check('an .xls file says only .xlsx is read', /only \.xlsx workbooks are/.test(await p.locator('.toast').textContent().catch(() => '')));
await p.locator('input[aria-label="Import a file"]').setInputFiles(fixturePath('review.xlsx')); await p.waitForTimeout(1500);
objs = await objects();
const fromBook = records(objs.filter(o => o.meta.source?.from === 'review.xlsx'));
check('an .xlsx workbook becomes the same ten record clusters as the paste', fromBook.length === 10 && fromBook.every(r => objs.filter(o => o.parentId === r.id).length === 5) && fromBook.map(r => r.meta.source.values.Severity[0]).join('') === 'CCCHHHMMMM', `${fromBook.length} records`);
check('its summary says where it came from', /10 records from review\.xlsx/.test(await p.locator('.import-summary').textContent().catch(() => '')), await p.locator('.import-summary').textContent().catch(() => ''));
check('a workbook with two sheets says only the first was read', (await p.locator('.toast').allTextContents()).some(t => /first sheet of review\.xlsx, “Review”/.test(t)), JSON.stringify(await p.locator('.toast').allTextContents()));
await shot('10b-xlsx-records');

// 14. An agent imports through the same operation.
const imported = await api('import', { content: fixture('findings.json'), name: 'findings.json' });
objs = await objects();
check('the agent operation brings in records', imported.ok === true && imported.result.kind === 'records' && imported.result.objects.length === 4 && objs.filter(o => kind(o) === 'record' && o.meta.source.from === 'findings.json').length === 4, JSON.stringify(imported).slice(0, 160));
await p.waitForTimeout(800);
await shot('11-agent-import');

// 15. Everything survives a reload.
const total = objs.length;
await p.waitForTimeout(1200);
await p.reload(); await p.waitForSelector('.topbar'); await p.waitForFunction(() => window.paired?.read().objects.length > 10, null, { timeout: 15000 }); await p.waitForTimeout(1500);
objs = await objects();
check('the board is the same after a reload', objs.length === total && records(objs).length === 24 /* 10 pasted, 10 from the workbook, 4 from the agent */ && objs.some(o => o.type === 'datatable'), `${objs.length} of ${total}`);
check('no errors in the page', errs.length === 0, errs.slice(0, 3).join(' | '));

await ctx.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
