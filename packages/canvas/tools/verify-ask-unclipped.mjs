// Browser check for items 80 and 96: an ask (and comments, replies, answers and agent notes) about
// something in a frame is never clipped by the frame. Two cards are grouped into a frame; the
// person asks about one, comments on the other; an agent answers the ask, replies to the comment
// and annotates a card. None may be clipped (tldraw gives a clipped shape a mask), each sits on
// the page, and when the person drags the frame they all come along.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-ask-unclipped.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`) with an empty board store (PAIRED_BOARDS_DIR
// set to a new folder).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-ask-unclipped.mjs <screenshot dir>');
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
  const res = await fetch(`${BASE}/api/canvas/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: `unclipped-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }) });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
const objects = () => p.evaluate(() => window.paired.read().objects);
const select = async (ids) => { await p.evaluate((ids) => window.paired.select(ids), ids); await p.waitForTimeout(250); };
const state = (id) => p.evaluate((id) => {
  const e = window.__pairedEditor, s = e.getShape(id), b = e.getShapePageBounds(id);
  return s ? { onPage: s.parentId === e.getCurrentPageId(), clipped: Boolean(e.getShapeMask(id)), x: b.x, y: b.y } : null;
}, id);
const make = async (x, text) => { const r = await p.evaluate(([x, text]) => window.paired.create({ kind: 'note', x, y: 820, width: 240, text }), [x, text]); return typeof r === 'string' ? r : r.id; };

const seat = await make(120, 'Charge per seat');
const usage = await make(400, 'Usage based');
const revs = await p.evaluate((ids) => ids.map((id) => ({ id, expectedRevision: window.paired.read().objects.find((o) => o.id === id).revision })), [seat, usage]);
const frame = (await command('group', { objects: revs, name: 'Pricing', padding: 160 })).frame.id;

// The person asks about one card and comments on the other.
await select([seat]);
await p.locator('.selection-bar button.primary').click();
await p.locator('.selection-bar.asking input').fill('What is missing here?');
await p.keyboard.press('Enter');
await p.waitForTimeout(500);
await select([usage]);
await p.keyboard.press('c');
await p.waitForTimeout(300);
await p.keyboard.type('Too vague');
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
let objs = await objects();
const ask = objs.find((o) => o.text === 'What is missing here?');
const comment = objs.find((o) => o.text === 'Too vague');

// An agent answers, replies and annotates.
const answer = (await command('answer', { id: ask.id, text: 'Who pays when a team shrinks mid-month?' })).answers[0].id;
const reply = (await command('reply', { id: comment.id, text: 'Say per what: seat, post or team.' })).reply.id;
const note = (await command('annotate', { targetId: seat, text: 'A worked example would help here.' })).id ?? null;
objs = await objects();
const noteId = note ?? objs.find((o) => o.text === 'A worked example would help here.')?.id;

const all = { ask: ask.id, comment: comment.id, answer, reply, 'agent note': noteId };
for (const [name, id] of Object.entries(all)) {
  const s = await state(id);
  check(`the ${name} is not clipped by the frame`, s && !s.clipped, JSON.stringify(s));
  check(`the ${name} sits on the page`, s?.onPage === true);
}
await select([]);
await p.evaluate(() => { window.__pairedEditor.zoomToFit(); });
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/ask-in-frame.png` });

// The person drags the frame: everything about its cards comes along.
const before = Object.fromEntries(await Promise.all(Object.entries(all).map(async ([k, id]) => [k, await state(id)])));
await select([frame]);
await p.evaluate((id) => { const e = window.__pairedEditor, f = e.getShape(id); e.markHistoryStoppingPoint('drag'); e.updateShape({ id, type: 'frame', x: f.x + 60, y: f.y + 40 }); }, frame);
await p.waitForTimeout(300);
for (const [name, id] of Object.entries(all)) {
  const s = await state(id), b = before[name];
  check(`the ${name} moves with the frame`, Math.abs(s.x - b.x - 60) < 1 && Math.abs(s.y - b.y - 40) < 1, `${Math.round(s.x - b.x)},${Math.round(s.y - b.y)}`);
}
// Item 96 (follow-ups to #104). (b) An ask about the frame gives the comment and reply about what it holds.
const aboutFrame = await (async () => {
  await select([frame]);
  await p.locator('.selection-bar button.primary').click();
  await p.locator('.selection-bar.asking input').fill('What does this frame add up to?');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  return (await command('asks', { state: 'all' })).asks.find((a) => a.question === 'What does this frame add up to?');
})();
const held = (aboutFrame?.targets?.[0]?.inside ?? []).map((o) => o.text).join(' | ');
check('an ask about the frame gives the comment and the reply on its cards', held.includes('Too vague') && held.includes('Say per what'), held);
// (a) An ask about both cards follows the frame.
await select([seat, usage]);
await p.locator('.selection-bar button.primary').click();
await p.locator('.selection-bar.asking input').fill('Compare these two');
await p.keyboard.press('Enter');
await p.waitForTimeout(500);
const both = (await objects()).find((o) => o.text === 'Compare these two').id;
// (c) An agent arranges the frame while nothing is selected: everything about its cards comes along.
const tracked = { ...all, 'ask about both cards': both };
await select([]);
const pre = Object.fromEntries(await Promise.all(Object.entries(tracked).map(async ([k, id]) => [k, await state(id)])));
const framePre = await state(frame);
const frev = await p.evaluate((id) => window.paired.read().objects.find((o) => o.id === id).revision, frame);
await command('arrange', { objects: [{ id: frame, expectedRevision: frev }], layout: 'row', x: framePre.x + 200, y: framePre.y + 100 });
await p.waitForTimeout(300);
const frameNow = await state(frame), fdx = frameNow.x - framePre.x, fdy = frameNow.y - framePre.y;
for (const [name, id] of Object.entries(tracked)) {
  const s2 = await state(id), b = pre[name];
  check(`the ${name} moves with the frame when an agent arranges it`, Math.abs(s2.x - b.x - fdx) < 1 && Math.abs(s2.y - b.y - fdy) < 1, `${Math.round(s2.x - b.x)},${Math.round(s2.y - b.y)} vs ${Math.round(fdx)},${Math.round(fdy)}`);
}
// One undo takes the agent's arrange back, comments included.
await p.evaluate(() => { window.__pairedEditor.undo(); });
await p.waitForTimeout(300);
const undone = await Promise.all(Object.entries(tracked).map(async ([k, id]) => { const s4 = await state(id), b = pre[k]; return Math.abs(s4.x - b.x) < 1 && Math.abs(s4.y - b.y) < 1; }));
check('one undo puts the frame and everything about it back', undone.every(Boolean) && Math.abs((await state(frame)).x - framePre.x) < 1);
await p.evaluate(() => { window.__pairedEditor.redo(); });
await p.waitForTimeout(300);
// The same with the frame selected moves each of them once, not twice.
await select([frame]);
const pre2 = Object.fromEntries(await Promise.all(Object.entries(tracked).map(async ([k, id]) => [k, await state(id)])));
const frev2 = await p.evaluate((id) => window.paired.read().objects.find((o) => o.id === id).revision, frame);
await command('arrange', { objects: [{ id: frame, expectedRevision: frev2 }], layout: 'row', x: frameNow.x - 100, y: frameNow.y });
await p.waitForTimeout(300);
for (const [name, id] of Object.entries(tracked)) {
  const s3 = await state(id), b = pre2[name];
  check(`the ${name} moves once when the arranged frame is selected`, Math.abs(s3.x - b.x + 100) < 1 && Math.abs(s3.y - b.y) < 1, `${Math.round(s3.x - b.x)},${Math.round(s3.y - b.y)}`);
}
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
