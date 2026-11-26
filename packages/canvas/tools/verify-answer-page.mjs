// Browser check for item 46: an answer lands on its ask's page.
// The person asks about a card, then opens another page while waiting. The agent answers
// over HTTP. The answer must be accepted, the person told who answered and where, and on
// the ask's page the answer must sit under the ask with the ask marked answered.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-answer-page.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`). Playwright is not a dependency of this
// repository; it is loaded from the directory you run this in.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-answer-page.mjs <screenshot dir>');
const BASE = 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'answer-page-')), { viewport: { width: 1440, height: 900 } });
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
    body: JSON.stringify({ requestId: `answer-page-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }),
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

const card = await p.evaluate(() => window.paired.create({ kind: 'note', x: 120, y: 520, width: 300, text: 'Is the team plan priced per seat?' }));
const cardId = typeof card === 'string' ? card : card.id;
await ask([cardId], 'What would change if it were flat?');
const firstPage = await p.evaluate(() => window.paired.read().page.id);
const askId = (await command('asks', {})).asks.find((a) => a.question === 'What would change if it were flat?').id;
await command('page', { name: 'Elsewhere' });
await p.waitForTimeout(300);
let answered, error = '';
try { answered = await command('answer', { id: askId, text: 'Take a ten-person team: flat price is the same as five seats today.' }); } catch (e) { error = String(e.message).slice(0, 160); }
check('the answer is accepted while another page is open', Boolean(answered), error);
const toast = await p.locator('.toast').textContent({ timeout: 2000 }).catch(() => '');
check('the person is told who answered and where', /Verifier answered .* on the page/.test(toast ?? ''), toast ?? '');
await p.screenshot({ path: `${out}/answer-page-elsewhere.png` });
check('nothing was added to the page on screen', (await p.evaluate(() => window.paired.read().objects.length)) === 0);
await p.evaluate((id) => void window.__pairedEditor.setCurrentPage(id), firstPage);
await p.waitForTimeout(500);
const objs = await p.evaluate(() => window.paired.read().objects);
const askObj = objs.find((o) => o.id === askId), reply = objs.find((o) => o.meta.replyTo === askId);
check('the answer is on the ask\'s page', Boolean(reply), reply?.text);
check('it sits under the ask', reply && askObj && reply.bounds.y >= askObj.bounds.y + askObj.bounds.h && Math.abs(reply.bounds.x - askObj.bounds.x) < 400, JSON.stringify({ ask: askObj?.bounds, answer: reply?.bounds }));
check('the ask says answered', askObj?.meta.ask?.state === 'answered', askObj?.meta.ask?.state);
await p.screenshot({ path: `${out}/answer-page-back.png` });
check('no page errors', errors.length === 0, errors.join(' | '));
await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
