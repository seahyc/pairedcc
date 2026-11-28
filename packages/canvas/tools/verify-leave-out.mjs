// Browser check for item 67: the person chooses what an ask leaves out (?prototype=context).
// Three cards sit in a frame. The person leaves one out with L and asks another (the card is the
// question, sent as it stands); the agent's view of that ask (the `asks` operation) must hold
// the frame's other card but not the left-out one, and say one was left out; the board shows it
// as left out and the ask's line says "1 left out". Selecting the left-out card with a question
// card and asking still gives it (choosing it is sharing it).
// "Bring back" on the bar undoes the choice, and one undo takes a leave-out back. A tab without
// the flag shows no Leave out button and L does nothing.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-leave-out.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`; CANVAS_BASE overrides the origin), with an empty board store (for example
// PAIRED_BOARDS_DIR set to a new folder), so earlier runs' cards are not where the frame goes. Playwright is not a dependency of this
// repository; it is loaded from the directory you run this in.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-leave-out.mjs <screenshot dir>');
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const browser = await chromium.launch();

async function open(query) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await p.goto(`${BASE}/canvas/${query}`);
  await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 20000 });
  await p.waitForTimeout(800);
  return { ctx, p, errors };
}

let n = 0;
async function command(op, input) {
  const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
  const list = sessions.sessions ?? sessions;
  const sessionId = list[list.length - 1]?.id ?? list[list.length - 1]?.sessionId;
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `leave-out-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}

const select = (p, ids) => p.evaluate((ids) => window.paired.select(ids), ids).then(() => p.waitForTimeout(200));
const meta = (p, id) => p.evaluate((id) => window.__pairedEditor.getShape(id)?.meta ?? null, id);
// The card is the question; there is no question box. A card the person wrote is sent as it
// stands with Ask (Ctrl/⌘+Enter, or the bar's first button).
async function send(p, id) {
  await select(p, [id]);
  await p.locator('.selection-bar button.primary').click();
  await p.waitForTimeout(600);
  return (await command('asks', {})).asks.find((a) => a.id === id);
}
// Asking about something the person did not write (a frame) opens a pink card beside it in
// typing mode: the question is typed there and sent when they finish writing (Escape).
async function ask(p, ids, question) {
  await select(p, ids);
  await p.locator('.selection-bar button.primary').click();
  await p.waitForFunction(() => Boolean(window.__pairedEditor.getEditingShapeId()), null, { timeout: 5000 });
  await p.keyboard.type(question, { delay: 0 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(600);
  return (await command('asks', {})).asks.find((a) => a.question === question);
}

// --- Flagged tab ---
const { ctx, p, errors } = await open('?prototype=context');
const make = (x, text) => p.evaluate(([x, text]) => window.paired.create({ kind: 'note', x, y: 560, width: 240, text }), [x, text]).then((r) => (typeof r === 'string' ? r : r.id));
const seat = await make(120, 'Charge per seat');
const aside = await make(400, 'Draft: not sure I trust these numbers yet');
const usage = await make(680, 'Usage based, per post');
const revs = await p.evaluate((ids) => ids.map((id) => ({ id, expectedRevision: window.paired.read().objects.find((o) => o.id === id).revision })), [seat, aside, usage]);
const grouped = await command('group', { objects: revs, name: 'Pricing' });
check('the three cards sit in a frame', Boolean(grouped?.frame?.id ?? grouped?.frameId), JSON.stringify(Object.keys(grouped ?? {})));

await select(p, [aside]);
check('the selection bar offers Leave out', await p.locator('.selection-bar button', { hasText: 'Leave out' }).count() === 1);
await p.keyboard.press('l');
await p.waitForTimeout(200);
check('L leaves the selection out', (await meta(p, aside))?.leftOut === true);
check('the bar now offers Bring back', await p.locator('.selection-bar button.on', { hasText: 'Bring back' }).count() === 1);
await select(p, []);
await p.waitForTimeout(200);
check('the board shows it as left out', await p.locator('.scratch-left-out', { hasText: 'left out of asks' }).count() === 1);

// The person asks another of the cards: that card is the question.
const first = await send(p, seat);
check('the card is sent as the ask', first?.question === 'Charge per seat', first?.question);
const frameTexts = first?.frame?.objects?.map((o) => o.text) ?? [];
console.log(JSON.stringify({ targets: first?.targets?.map((t) => t.text), frame: first?.frame, history: first?.history, leftOut: first?.leftOut }, null, 2));
check('the frame still gives its other card', frameTexts.includes('Usage based, per post'), frameTexts.join(' | '));
check('the left-out card is not given', !JSON.stringify(first ?? {}).includes('not sure I trust'));
check('the ask says one was left out', first?.leftOut === 1);
await command('ask_status', { id: first.id, state: 'working' });
await p.evaluate((id) => window.paired.select([id]), first.id);
await p.waitForTimeout(300);
const line = await p.locator('.ask-status').last().innerText();
check('the ask line says 1 left out', line.includes('1 left out'), line);
await p.screenshot({ path: `${out}/leave-out-ask.png` });

const frameId = grouped.frame?.id ?? grouped.frameId;
const aboutFrame = await ask(p, [frameId], 'What does this group add up to?');
const held = aboutFrame?.targets?.[0]?.inside?.map((o) => o.text) ?? [];
check('an ask about the frame lists what it holds, without the left-out card', held.includes('Usage based, per post') && !JSON.stringify(aboutFrame ?? {}).includes('not sure I trust') && aboutFrame?.leftOut === 1, held.join(' | '));

// The person writes a question card of their own, away from the frame, selects it with the
// left-out card and asks: the question card is sent, and the left-out card it was selected with
// is still given as context (choosing it is sharing it).
const worry = await p.evaluate(() => window.paired.create({ kind: 'note', x: 120, y: 1100, width: 240, text: 'Is this worry fair?' })).then((r) => (typeof r === 'string' ? r : r.id));
// Selected in that order, as a click on the question card and a Shift+click on the left-out one
// would (window.paired.select orders by the page, which would put the left-out card first).
await p.evaluate(([a, b]) => { window.__pairedEditor.setCurrentTool('select'); window.__pairedEditor.select(a, b); }, [worry, aside]);
await p.waitForTimeout(200);
await p.locator('.selection-bar button.primary').click();
await p.waitForTimeout(600);
const directSent = (await command('asks', {})).asks.find((a) => a.id === worry);
const direct = directSent?.question === 'Is this worry fair?' ? directSent : undefined;
check('an object the person selects is still given', direct?.targets?.[0]?.text?.includes('not sure I trust'), direct?.targets?.[0]?.text);

await select(p, [aside]);
await p.locator('.selection-bar button', { hasText: 'Bring back' }).click();
await p.waitForTimeout(200);
check('Bring back clears the mark', (await meta(p, aside))?.leftOut === undefined);
await select(p, [aside]);
await p.keyboard.press('l');
await p.waitForTimeout(150);
await p.keyboard.press('Control+z');
await p.waitForTimeout(200);
check('one undo takes a leave-out back', (await meta(p, aside))?.leftOut === undefined);
// The first ask is answered, and the person asks that card again: it is sent afresh.
await command('answer', { id: first.id, text: 'Nothing about usage yet.' });
await p.waitForTimeout(400);
const again = await send(p, seat);
// Given again wherever it now belongs: in the frame's list, or as a target when it sits right beside the card.
check('brought back, it is given again', again?.attempt > first.attempt && JSON.stringify({ frame: again?.frame ?? {}, targets: again?.targets ?? [] }).includes('not sure I trust') && again?.leftOut === undefined, `attempt ${again?.attempt}, state ${again?.state}`);
check('no page errors (flagged tab)', errors.length === 0, errors.join(' | '));
await ctx.close();

// --- A phone with the flag: the bar, Leave out included, stays inside the window ---
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const phone = await phoneCtx.newPage();
await phone.goto(`${BASE}/canvas/?prototype=context`);
await phone.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 20000 });
await phone.waitForTimeout(800);
const thought = await phone.evaluate(() => window.paired.create({ kind: 'note', x: 40, y: 500, width: 240, text: 'A thought' })).then((r) => (typeof r === 'string' ? r : r.id));
await phone.evaluate((id) => { window.paired.select([id]); window.__pairedEditor.zoomToSelection(); }, thought);
await phone.waitForTimeout(500);
const edges = await phone.locator('.selection-bar button').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [e.textContent.trim(), Math.round(r.left), Math.round(r.right)]; }));
check('on a 390 px phone every bar button, Leave out included, is inside the window', edges.some(([t]) => t.startsWith('Leave out')) && edges.every(([, l, r]) => l >= 0 && r <= 390), JSON.stringify(edges));
await phone.screenshot({ path: `${out}/leave-out-phone.png` });
await phoneCtx.close();

// --- Default tab: nothing new ---
const plain = await open('');
await plain.p.screenshot({ path: `${out}/leave-out-first-screen.png` });
const card = await plain.p.evaluate(() => window.paired.create({ kind: 'note', x: 120, y: 560, width: 240, text: 'A plain thought' })).then((r) => (typeof r === 'string' ? r : r.id));
await select(plain.p, [card]);
check('a tab without the flag has no Leave out button', await plain.p.locator('.selection-bar button', { hasText: 'Leave out' }).count() === 0);
await plain.p.keyboard.press('l');
await plain.p.waitForTimeout(200);
check('L does nothing without the flag', (await meta(plain.p, card))?.leftOut === undefined);
check('no page errors (default tab)', plain.errors.length === 0, plain.errors.join(' | '));
await plain.ctx.close();
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
