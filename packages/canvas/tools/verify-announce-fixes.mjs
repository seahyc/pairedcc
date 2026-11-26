// Browser check for item 100 (a)-(c), review findings on #101 (ask progress announced).
// (a) Two asks answered with the same words in a row: the polite live region must change both
//     times, so both are said. (b) A working ask whose agent goes quiet past the two-minute
//     timeout must be announced with Retry (time is simulated by back-dating the ask's start).
// (c) A clarifying question and then three options to the same ask: the announcement must say
//     three options, not four.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-announce-fixes.mjs
//
// Needs the dev server on :5183 (`pnpm dev:canvas`), with an empty board store.
import { createRequire } from 'node:module';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const BASE = 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 20000 });
await p.waitForTimeout(800);
// Every text the live region takes, in order.
await p.evaluate(() => {
  window.__said = [];
  const region = document.querySelector('[data-ask-announcer]');
  new MutationObserver(() => window.__said.push(region.textContent)).observe(region, { childList: true, characterData: true, subtree: true });
});
const said = () => p.evaluate(() => window.__said.slice());

let n = 0;
async function command(op, input) {
  const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
  const list = sessions.sessions ?? sessions;
  const sessionId = list[list.length - 1]?.id ?? list[list.length - 1]?.sessionId;
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `announce-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
async function ask(x, text) {
  const card = await p.evaluate(([x, text]) => window.paired.create({ kind: 'note', x, y: 560, width: 220, text }), [x, text]).then((r) => (typeof r === 'string' ? r : r.id));
  await p.evaluate((id) => window.paired.select([id]), card);
  await p.waitForTimeout(200);
  // The card is the question: the person's card is sent as it stands with ⌘↵.
  await p.keyboard.press('ControlOrMeta+Enter');
  await p.waitForTimeout(500);
  return (await command('asks', {})).asks.find((a) => a.question === text).id;
}

// (a)
const a1 = await ask(100, 'Charge per seat: is this fair');
const a2 = await ask(500, 'Usage based: is this fair too');
await p.evaluate(() => void window.__pairedEditor.selectNone());
await p.waitForTimeout(300);
let before = (await said()).length;
await command('answer', { id: a1, text: 'Yes for small teams.' });
await p.waitForTimeout(600);
await command('answer', { id: a2, text: 'Yes for small teams, mostly.' });
await p.waitForTimeout(600);
const answeredSays = (await said()).slice(before).filter((t) => /Verifier answered, under your ask/.test(t));
check('(a) two answers in a row with the same words are both put in the live region', answeredSays.length >= 2 && answeredSays[0] !== answeredSays[1], JSON.stringify(answeredSays));

// (b)
const a3 = await ask(900, 'Flat price: what breaks first');
await command('ask_status', { id: a3, state: 'working', note: 'reading' });
await p.waitForTimeout(600);
before = (await said()).length;
await p.evaluate((id) => {
  const ed = window.__pairedEditor, s = ed.getShape(id);
  ed.run(() => ed.updateShape({ id, type: s.type, meta: { ...s.meta, ask: { ...s.meta.ask, startedAt: Date.now() - 130_000 } } }), { history: 'ignore' });
}, a3);
await p.waitForTimeout(2500);
const quiet = (await said()).slice(before);
check('(b) an agent going quiet past the timeout is announced, with Retry', quiet.some((t) => /went quiet\. Retry is under the ask/.test(t)), JSON.stringify(quiet));

// (c)
const a4 = await ask(1300, 'Annual plan: which discount');
await command('answer', { id: a4, text: 'For which team size?', question: true });
await p.waitForTimeout(800);
// The person replies by asking again on the same ask (a retry hands it back as waiting).
await p.evaluate((id) => {
  const ed = window.__pairedEditor, s = ed.getShape(id);
  ed.run(() => ed.updateShape({ id, type: s.type, meta: { ...s.meta, ask: { ...s.meta.ask, state: 'waiting' } } }), { history: 'ignore' });
}, a4);
await p.waitForTimeout(800);
before = (await said()).length;
await command('answer', { id: a4, alternatives: ['10% off yearly', '2 months free', 'No discount, more seats'] });
await p.waitForTimeout(800);
const options = (await said()).slice(before).filter((t) => /answered/.test(t));
check('(c) a clarifying question and then three options are said as three options', options.some((t) => /with 3 options/.test(t)) && !options.some((t) => /with 4 options/.test(t)), JSON.stringify(options));
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
