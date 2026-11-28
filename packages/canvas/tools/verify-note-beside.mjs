// Browser check for item 118 (c)-(e), friction reported by the 28-task agent attempt (PR #159).
// (c) An agent's note on one card among many lands beside that card, not hundreds of pixels down
//     the page, covers nothing, and a short note gets a card that fits it rather than 420 px.
// (d) Answering an ask that is a feedback item shows the answer as that item's reply in the queue
//     and resolves it; a clarifying question back is a reply that leaves the item open.
// (e) An ask can be answered straight away, without reporting `working` first.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-note-beside.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`) with an empty board store (PAIRED_BOARDS_DIR
// set to a new folder).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-note-beside.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await p.waitForTimeout(800);
const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
const list = sessions.sessions ?? sessions;
const sessionId = list[list.length - 1].id ?? list[list.length - 1].sessionId;
let n = 0;
async function command(op, input) {
  const res = await fetch(`${BASE}/api/canvas/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: `note-beside-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }) });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
const bounds = (id) => p.evaluate((id) => { const b = window.__pairedEditor.getShapePageBounds(id); return b && { x: b.x, y: b.y, w: b.w, h: b.h }; }, id);
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// The empty space between two rectangles (0 when they touch or overlap).
const gap = (a, b) => Math.hypot(Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)));
const coveredBy = async (noteId) => {
  const nb = await bounds(noteId);
  const others = await p.evaluate((note) => window.paired.read().objects.filter((o) => o.id !== note && o.type !== 'arrow' && o.type !== 'frame' && o.bounds).map((o) => ({ id: o.id, text: (o.text ?? '').slice(0, 30), ...o.bounds })), noteId);
  return others.filter((o) => overlaps(nb, o));
};

// (c) Task 20's board: 60 notes in rows, one of them about the budget.
const nodes = Array.from({ length: 60 }, (_, i) => ({
  key: `n${i}`,
  shape: { kind: 'note', x: (i % 10) * 280, y: Math.floor(i / 10) * 160, text: i === 37 ? 'Budget: £4,200 for the pilot' : `Observation ${i + 1}: participant mentioned onboarding` },
}));
await command('scene', { name: 'Many notes', nodes });
await p.waitForTimeout(400);
const target = await p.evaluate(() => window.paired.read().objects.find((o) => /budget/i.test(o.text ?? '')).id);
const tb = await bounds(target);
const short = await command('annotate', { targetId: target, text: 'Check this number' });
const shortId = short.id;
const sb = await bounds(shortId);
check('a note on one card among many lands beside it', gap(sb, tb) <= 120, `gap ${Math.round(gap(sb, tb))} px; note ${JSON.stringify(sb)}, card ${JSON.stringify(tb)}`);
const sc = await coveredBy(shortId);
check('it covers nothing', sc.length === 0, sc.map((o) => o.text || o.id).join(' | '));
check('a short note gets a card that fits it, not 420 px', sb.w < 420, `width ${sb.w}`);
const longText = 'This is the only figure on the page with a currency. Is it per month or for the whole pilot, and does it include the research incentives?';
const long = await command('annotate', { targetId: target, text: longText });
const lb = await bounds(long.id);
const lc = await coveredBy(long.id);
check('a second, longer note covers nothing either', lc.length === 0, lc.map((o) => o.text || o.id).join(' | '));
// A three-line, 420 px note fits no gap near its card on this full grid, so it goes to the
// nearest clear place: below the grid, whose bottom edge is 320 px under the card (before this
// change it went below the first note too, 452 px).
check('a note that fits no gap nearby goes to the nearest clear place, just past the grid', gap(lb, tb) <= 320 + 40, `gap ${Math.round(gap(lb, tb))} px`);
const arrows = await p.evaluate(([note, card]) => window.paired.read().objects.filter((o) => o.type === 'arrow' && o.meta?.relation === 'feedback').length, [shortId, target]);
check('each note keeps its arrow to the card', arrows >= 2, `${arrows} feedback arrows`);
await p.evaluate(([a, b]) => { const e = window.__pairedEditor; e.select(a, b, ...e.getCurrentPageShapes().filter((x) => x.meta?.role === 'annotation').map((x) => x.id)); e.zoomToSelection(); e.selectNone(); }, [target, shortId]);
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/note-beside.png` });
// Text stays inside each note's card, as drawn (item: text never leaves its container).
const spilled = await p.evaluate((ids) => ids.flatMap((id) => {
  const el = document.querySelector(`[data-shape-id="${id}"]`);
  if (!el) return [`${id} not drawn`];
  const box = el.getBoundingClientRect();
  return [...el.querySelectorAll('.tl-rich-text, p')].flatMap((t) => {
    const r = t.getBoundingClientRect();
    if (!r.width || !t.textContent.trim()) return [];
    return r.right > box.right + 2 || r.left < box.left - 2 || r.bottom > box.bottom + 2 || t.scrollWidth > t.clientWidth + 1 ? [`"${t.textContent.slice(0, 24)}" ${Math.round(r.left)}–${Math.round(r.right)} in ${Math.round(box.left)}–${Math.round(box.right)}`] : [];
  });
}), [shortId, long.id]);
check('each note\'s text stays inside its card', spilled.length === 0, spilled.join(' | '));

// Item 140 (a): side: "beside" puts the note to the right of its card, level with it, covering nothing.
await command('page', { name: 'Beside' });
await p.waitForTimeout(300);
const lone = await command('create', { kind: 'note', x: 200, y: 200, text: 'Weekly sign-ups: 140' });
const loneB = await bounds(lone.id);
const side = await command('annotate', { targetId: lone.id, text: 'Up from 120', side: 'beside' });
const sideB = await bounds(side.id);
check('(140 a) a note with side "beside" sits to the right of its card, level with its top', sideB.x >= loneB.x + loneB.w && Math.abs(sideB.y - loneB.y) <= 2 && gap(sideB, loneB) <= 80, `note ${JSON.stringify(sideB)}, card ${JSON.stringify(loneB)}`);
const sideC = await coveredBy(side.id);
check('(140 a) and covers nothing', sideC.length === 0, sideC.map((o) => o.text || o.id).join(' | '));
const under = await command('annotate', { targetId: lone.id, text: 'Where from?' });
const underB = await bounds(under.id);
check('(140 a) without side, a note still goes under its card', underB.y >= loneB.y + loneB.h, JSON.stringify(underB));

// (d), (e) An ask about an agent's note opens a pink card that is a feedback item.
await command('page', { name: 'Asks' });
await p.waitForTimeout(300);
const agentNote = await command('create', { kind: 'note', x: 200, y: 200, text: 'Opening hours: 7am to 3pm, weekdays only' });
async function askAbout(id, question) {
  await p.evaluate((id) => window.paired.select([id]), id);
  await p.waitForTimeout(250);
  await p.getByRole('button', { name: /^Ask/ }).first().click();
  await p.waitForTimeout(300);
  await p.keyboard.type(question, { delay: 2 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  return p.evaluate((q) => window.__pairedEditor.getCurrentPageShapes().find((s) => s.meta.ask?.sent === q)?.id ?? null, question);
}
const askId = await askAbout(agentNote.id, 'Should we open on Saturdays too?');
check('the person\'s ask is made', Boolean(askId));
if (askId) {
  const before = (await command('feedback', { status: 'all' })).items.find((i) => i.id === askId);
  check('the ask is a feedback item, open and waiting', before?.status === 'open' && before?.ask === 'waiting', JSON.stringify(before && { status: before.status, ask: before.ask }));
  // (e) No ask_status first.
  const answered = await command('answer', { id: askId, text: 'Try Saturdays for a month, 8am to 1pm, and count covers first.' }).then(() => true, (e) => String(e));
  check('a waiting ask can be answered straight away, without "working" first', answered === true, String(answered));
  const after = (await command('feedback', { status: 'all' })).items.find((i) => i.id === askId);
  check('(d) the answer is the item\'s reply in the queue', after?.replies?.some((r) => /Saturdays for a month/.test(r.text)), JSON.stringify(after?.replies));
  check('(d) and the item is resolved, the ask answered', after?.status === 'resolved' && after?.ask === 'answered', JSON.stringify(after && { status: after.status, ask: after.ask }));
}
const askTwo = await askAbout(agentNote.id, 'What should we charge?');
if (askTwo) {
  await command('answer', { id: askTwo, text: 'Per visit or per month?', question: true });
  const item = (await command('feedback', { status: 'all' })).items.find((i) => i.id === askTwo);
  check('(d) a clarifying question back is a reply that leaves the item open', item?.status === 'open' && item?.replies?.some((r) => /Per visit/.test(r.text)), JSON.stringify(item && { status: item.status, ask: item.ask, replies: item.replies?.length }));
} else check('(d) a second ask is made', false);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
