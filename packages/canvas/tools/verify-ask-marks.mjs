// Browser check for item 44: an ask carries the person's picks and cross-outs.
// A person writes a card and asks for options; an agent answers with three over HTTP;
// the person picks A and crosses out B with the selection bar, then asks about A. The
// agent's view of that ask (the `asks` operation) must say A was picked, list B and C
// as the other options with B crossed out, and name each object once.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-ask-marks.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`). Playwright is not a dependency of this
// repository; it is loaded from the directory you run this in.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-ask-marks.mjs <screenshot dir>');
const BASE = 'http://localhost:5183';
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

async function ask(ids, question) {
  await p.evaluate((ids) => window.paired.select(ids), ids);
  await p.waitForTimeout(200);
  await p.locator('.selection-bar button.primary').click();
  await p.locator('.selection-bar.asking input').fill(question);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
}

// The person's thought, away from the first board's cards.
const card = await p.evaluate(() => window.paired.create({ kind: 'note', x: 120, y: 520, width: 300, text: 'How should we price the team plan?' }));
const cardId = typeof card === 'string' ? card : card.id;
await ask([cardId], 'Give me options');
let asks = (await command('asks', {})).asks;
const first = asks.find((a) => a.question === 'Give me options');
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
check('the selected option says it was picked', second?.targets?.[0]?.mark === 'picked');
const hb = second?.history?.find((h) => h.id === b), hc = second?.history?.find((h) => h.id === c);
check('the crossed-out option is in the history, marked rejected', hb?.mark === 'rejected', hb?.said);
check('the option left alone is in the history with no mark', Boolean(hc) && hc.mark === undefined, hc?.said);
check('the picked option is not repeated in the history', !second?.history?.some((h) => h.id === a));
check('the first question is still in the history', second?.history?.some((h) => h.said === 'Give me options'));
const ids = second?.history?.filter((h) => h.id).map((h) => h.id) ?? [];
check('every object in the history appears once', new Set(ids).size === ids.length);
check('no page errors', errors.length === 0, errors.join(' | '));
await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
