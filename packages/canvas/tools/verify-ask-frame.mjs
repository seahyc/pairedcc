// Browser check for item 45: an ask about a frame is about what it holds.
// Three cards are put in a frame "Pricing", two of them in a nested frame; the person
// crosses one out, selects the outer frame and asks (Ask opens a pink card beside the frame;
// the question is written there and sent when they finish). The agent's view of that ask must
// list the three cards inside the frame, in reading order, with the cross-out, and nothing else.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-ask-frame.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`; CANVAS_BASE overrides the origin). Playwright is not a dependency of this
// repository; it is loaded from the directory you run this in.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-ask-frame.mjs <screenshot dir>');
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ask-frame-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/?prototype=learning`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 20000 });
await p.waitForTimeout(800);

let n = 0;
async function command(op, input) {
  const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
  const sessionId = (sessions.sessions ?? sessions)[0]?.id ?? (sessions.sessions ?? sessions)[0]?.sessionId;
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `ask-frame-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}

// The card is the question; there is no question box. Asking about something the person did
// not write (a frame, an agent's answer) opens a pink card beside it in typing mode: the
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

const made = async (text, x, y) => command('create', { kind: 'note', x, y, width: 220, text });
const seat = await made('Per seat', 140, 620), post = await made('Per post', 420, 620), flat = await made('One flat price', 760, 620);
// A result the person has not yet earned: inside the frame, hidden behind a learning prompt.
const secret = await made('Answer: per seat wins', 760, 760);
const inner = await command('group', { name: 'Seats or posts', objects: [seat, post].map((o) => ({ id: o.id, expectedRevision: o.revision })) });
const outer = await command('group', { name: 'Pricing', objects: [inner.frame, flat, secret].map((o) => ({ id: o.id, expectedRevision: o.revision })) });
await command('learn', { mode: 'predict', question: 'Which plan wins?', x: 1200, y: 620, hideIds: [secret.id] });
await p.evaluate((id) => window.paired.select([id]), post.id);
await p.locator('.selection-bar button[title^="Cross out"]').click();
await ask([outer.frame.id], 'What do these have in common?');
await p.evaluate(() => window.paired.select([]));
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/ask-frame-board.png` });

const asks = (await command('asks', {})).asks;
const mine = asks.find((x) => x.question === 'What do these have in common?');
console.log(JSON.stringify(mine?.targets, null, 2));
const held = mine?.targets?.[0]?.inside ?? [];
// The question card is the person's own card beside the frame, so (as with any card that is
// sent) what sits right beside that card is given too, each with where it sits. The frame is
// the one object the ask is about: first, and the only target without such a place.
const besideCard = (mine?.targets ?? []).slice(1);
check('the ask is about the frame', mine?.targets?.[0]?.id === outer.frame.id && besideCard.every((t) => typeof t.relation === 'string' && t.type !== 'frame'),
  (mine?.targets ?? []).map((t) => `${t.type}${t.relation ? ` (${t.relation})` : ''}`).join(', '));
check('it gives the cards inside, nested frame included, in reading order', held.map((o) => o.text).join(' | ') === 'Per seat | Per post | One flat price', held.map((o) => o.text).join(' | '));
check('the crossed-out card says so', held.find((o) => o.id === post.id)?.mark === 'rejected');
check('the nested frame itself is not listed as an object', !held.some((o) => o.type === 'frame'));
check('nothing is left out', mine?.targets?.[0]?.insideMore === undefined);
check('a result hidden by a learning prompt is not sent', !held.some((o) => o.id === secret.id));
// A follow-up on the answer to the frame ask still says what the frame held.
const answered = await command('answer', { id: mine.id, text: 'Each is a way to charge.' });
await ask([answered.answers[0].id], 'Which is simplest?');
const follow = (await command('asks', {})).asks.find((x) => x.question === 'Which is simplest?');
const framed = follow?.history?.find((h) => h.id === outer.frame.id);
check('a follow-up on that answer says what the frame held', /holding: Per seat; Per post; One flat price/.test(framed?.said ?? ''), framed?.said);
check('no page errors', errors.length === 0, errors.join(' | '));
await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
