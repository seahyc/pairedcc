// Browser check for item 65 (b), fresh profile: ask about a pasted record, let an agent answer
// over HTTP, then ask a follow-up about the answer (each on the pink card Ask opens beside what is
// asked about). The follow-up's history must still carry
// the record's fields with their column names, not an empty entry for its group.
//
//   cd <a directory where playwright is installed>
//   node <repo>/packages/canvas/tools/verify-ask-record.mjs <screenshot dir> [http://localhost:5199]
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-ask-record.mjs <screenshot dir> [origin]');
mkdirSync(out, { recursive: true });
const ORIGIN = process.argv[3] ?? process.env.CANVAS_BASE ?? 'http://localhost:5199';
const fixtures = new URL('../test/fixtures/', import.meta.url);
const fixture = (name) => readFileSync(new URL(name, fixtures), 'utf8');
const fixturePath = (name) => new URL(name, fixtures).pathname;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'askrec-profile-')), { viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
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
await p.mouse.click(1000, 620);
await setClipboard({ 'text/html': fixture('review.html'), 'text/plain': fixture('review.tsv') });
await paste();
let objs = await objects();
const record = records(objs)[0];
check('the pasted review is ten records', records(objs).length === 10, String(records(objs).length));
// The card is the question; there is no question box and no starters. Asking about something
// the person did not write (the pasted record, an agent's answer) opens a pink card beside it in
// typing mode: the question is typed there and sent when they finish writing (Escape).
const ask = async (id, question) => {
  await p.evaluate((id) => window.paired.select([id]), id); await p.waitForTimeout(300);
  await p.locator('.selection-bar button.primary').click();
  await p.waitForFunction(() => Boolean(window.__pairedEditor.getEditingShapeId()), null, { timeout: 5000 });
  await p.keyboard.type(question, { delay: 0 });
  return async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(900); };
};
// This step used to click the starter chip "Is this point valid?" the ask box offered for a
// record. Starters are gone; the person writes the same question on the card Ask opens, and the
// check is what remains of the step: the ask is about the record and gives the record's text.
const finish = await ask(record.id, 'Is this point valid?');
await shot('00-question-card'); await finish();
let asked = await api('asks', { state: 'all' });
const first = asked.result?.asks?.find(a => a.question === 'Is this point valid?');
check('the first ask is about the record', Boolean(first) && first.targets.length === 5, `${first?.targets.length} targets`);
const given = (first?.targets ?? []).map(g => String(g.text ?? '')).join('\n');
check('it gives the record\'s text as context', given.includes('Q56 says two vessels cost 9.2m in total') && given.includes('Pick the supplier quote as the single source'), JSON.stringify(first?.targets?.map(g => String(g.text).slice(0, 30))));
const answered = await api('answer', { id: first.id, text: 'Partly: Q56 is the supplier quote, so Q16 and Q49 should be corrected to match it.' });
check('an agent answers over HTTP', answered.ok === true, JSON.stringify(answered).slice(0, 160));
await p.waitForTimeout(800);
objs = await objects();
const answer = objs.find(o => o.meta.replyTo === first.id && o.text.startsWith('Partly'));
check('the answer is on the board', Boolean(answer));
await (await ask(answer.id, 'Which figure should the table use?'))();
asked = await api('asks', { state: 'all' });
const follow = asked.result?.asks?.find(a => a.question === 'Which figure should the table use?');
const history = follow?.history ?? [];
const fields = history.filter(h => /^How a sceptical reader would attack this: “Q56 says|^Suggested fix: Pick the supplier quote/.test(h.said));
check('the follow-up remembers the record with its column names', fields.length === 2, JSON.stringify(history.map(h => `${h.who}: ${String(h.said).slice(0, 40)}`)));
check('and no empty entry stands in for the record', !history.some(h => !String(h.said ?? '').trim()), JSON.stringify(history.map(h => String(h.said).slice(0, 20))));
await shot('01-follow-up');
check('no errors in the page', errs.length === 0, errs.join(' | '));
await ctx.close();
console.log(`\n${results.filter((r) => r.ok).length} of ${results.length} checks passed`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
