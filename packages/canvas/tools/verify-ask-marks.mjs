// Browser check for item 44: an ask carries the person's picks and cross-outs.
// A person writes a card and asks it (the card is the question); an agent answers with three
// options over HTTP; the person picks A and crosses out B with the selection bar, then asks
// about A (on the pink card Ask opens beside it). The agent's view of that ask (the `asks`
// operation) must say A was picked, give B and C as the other options with B crossed out, and
// name each object once.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-ask-marks.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`; CANVAS_BASE overrides the origin). Playwright is not a dependency of this
// repository; it is loaded from the directory you run this in.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-ask-marks.mjs <screenshot dir>');
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ask-marks-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 20000 });
await p.waitForTimeout(800);

let n = 0;
async function command(op, input) {
  const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
  const sessionId = (sessions.sessions ?? sessions)[0]?.id ?? (sessions.sessions ?? sessions)[0]?.sessionId;
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `ask-marks-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}

// The card is the question; there is no question box. Asking about something the person did
// not write (an agent's answer) opens a pink card beside it in typing mode: the
// question is typed there and sent when they finish writing (Escape).
async function ask(ids, question) {
  await p.evaluate((ids) => window.paired.select(ids), ids);
  await p.waitForTimeout(200);
  await p.locator('.selection-bar button.primary').click();
  await p.waitForFunction(() => Boolean(window.__pairedEditor.getEditingShapeId()), null, { timeout: 5000 });
  await p.keyboard.type(question, { delay: 0 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(600);
}

// The person's thought, away from the first board's cards.
const card = await p.evaluate(() => window.paired.create({ kind: 'note', x: 120, y: 520, width: 300, text: 'How should we price the team plan?' }));
const cardId = typeof card === 'string' ? card : card.id;
// The card is the question: with the person's own card selected, Ask sends that card itself.
await p.evaluate((id) => window.paired.select([id]), cardId);
await p.waitForTimeout(200);
await p.locator('.selection-bar button.primary').click();
await p.waitForTimeout(600);
let asks = (await command('asks', {})).asks;
const first = asks.find((a) => a.id === cardId && a.question === 'How should we price the team plan?');
check('the first ask reaches the agent', Boolean(first));
const answered = await command('answer', { id: first.id, alternatives: ['Per seat, so cost tracks team size', 'Per post, so cost tracks use', 'One flat price for any team'] });
const [a, b, c] = answered.answers.map((o) => o.id);

// The person judges with the selection bar, as they would by hand.
await p.evaluate((id) => window.paired.select([id]), a);
await p.locator('.selection-bar button[title^="Pick"]').click();
await p.evaluate((id) => window.paired.select([id]), b);
await p.locator('.selection-bar button[title^="Cross out"]').click();
await p.waitForTimeout(300);
await ask([a], 'Take this further');
await p.evaluate(() => window.paired.select([]));
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/ask-marks-board.png` });

asks = (await command('asks', {})).asks;
const second = asks.find((x) => x.question === 'Take this further');
console.log(JSON.stringify({ targets: second?.targets, history: second?.history }, null, 2));
check('the selected option says it was picked', second?.targets?.[0]?.id === a && second.targets[0].mark === 'picked');
// The question card opens beside A, so the other options can sit right beside it and be given
// as context next to the card (with where they sit) instead of in the thread's history. Either
// way the agent must be told about each of them, with its mark, exactly once.
const others = [...(second?.targets ?? []).slice(1), ...(second?.history ?? [])];
const hb = others.find((h) => h.id === b), hc = others.find((h) => h.id === c);
check('the crossed-out option is given, marked rejected', hb?.mark === 'rejected', hb?.said ?? hb?.text);
check('the option left alone is given with no mark', Boolean(hc) && hc.mark === undefined, hc?.said ?? hc?.text);
check('the picked option is not repeated in the history', !second?.history?.some((h) => h.id === a));
check('the first question is still in the history', second?.history?.some((h) => h.said === 'How should we price the team plan?'));
const ids = [...(second?.targets ?? []), ...(second?.history ?? [])].filter((h) => h.id).map((h) => h.id);
check('every object in the targets and history appears once', new Set(ids).size === ids.length);
check('no page errors', errors.length === 0, errors.join(' | '));
await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
