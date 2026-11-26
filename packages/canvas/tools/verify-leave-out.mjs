// Browser check for item 67: the person chooses what an ask leaves out (?prototype=context).
// Three cards sit in a frame. The person leaves one out with L, asks about another, and the
// agent's view of that ask (the `asks` operation) must hold the frame's other card but not the
// left-out one, and say one was left out; the board shows it as left out and the ask's line says
// "1 left out". Selecting the left-out card and asking still gives it (choosing it is sharing it).
// "Bring back" on the bar undoes the choice, and one undo takes a leave-out back. A tab without
// the flag shows no Leave out button and L does nothing.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-leave-out.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`). Playwright is not a dependency of this
// repository; it is loaded from the directory you run this in.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-leave-out.mjs <screenshot dir>');
const BASE = 'http://localhost:5183';
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
async function ask(p, ids, question) {
  await select(p, ids);
  await p.locator('.selection-bar button.primary').click();
  await p.locator('.selection-bar.asking input').fill(question);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
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

const first = await ask(p, [seat], 'What is missing here?');
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

const direct = await ask(p, [aside], 'Is this worry fair?');
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
const again = await ask(p, [seat], 'And now?');
check('brought back, it is given again', JSON.stringify(again?.frame ?? {}).includes('not sure I trust') && again?.leftOut === undefined);
check('no page errors (flagged tab)', errors.length === 0, errors.join(' | '));
await ctx.close();

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
