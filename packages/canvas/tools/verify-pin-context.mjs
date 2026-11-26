// Browser check for item 90: the person pins what every ask should see (?prototype=context).
// A goal card sits far from two idea cards. The person pins the goal with I, then asks about one
// idea without selecting the goal. The agent's view of that ask (the `asks` operation) must give
// the goal under `pinned`, the board must fence it as pinned, the ask's line must count "1 pinned"
// and the ask's outline must include it. Pinning a left-out card clears the left-out mark, one
// undo takes a pin back, a pin on another page is not given, and a tab without the flag shows no
// Pin button and I does nothing, while a pin already on the board is still honoured there.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-pin-context.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`), with an empty board store (PAIRED_BOARDS_DIR
// set to a new folder). Playwright is not a dependency of this repository; it is loaded from the
// directory you run this in.
import { createRequire } from 'node:module';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-pin-context.mjs <screenshot dir>');
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
    body: JSON.stringify({ requestId: `pin-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}

const select = (p, ids) => p.evaluate((ids) => window.paired.select(ids), ids).then(() => p.waitForTimeout(200));
const meta = (p, id) => p.evaluate((id) => window.__pairedEditor.getShape(id)?.meta ?? null, id);
// The card is the question: the person's selected card is sent as it stands with ⌘↵ and is
// the ask itself (the second argument is kept only to name the step).
async function ask(p, ids, _label) {
  await select(p, ids);
  await p.keyboard.press('ControlOrMeta+Enter');
  await p.waitForTimeout(500);
  return (await command('asks', { state: 'all' })).asks.find((a) => a.id === ids[0]);
}

// --- Flagged tab ---
const { ctx, p, errors } = await open('?prototype=context');
const make = (x, y, text) => p.evaluate(([x, y, text]) => window.paired.create({ kind: 'note', x, y, width: 240, text }), [x, y, text]).then((r) => (typeof r === 'string' ? r : r.id));
const goal = await make(140, 560, 'Goal: keep churn under 3% this year');
const seat = await make(560, 560, 'Charge per seat');
const usage = await make(860, 560, 'Usage based, per post');

await select(p, [goal]);
check('the selection bar offers Pin', await p.locator('.selection-bar button', { hasText: /^Pin/ }).count() === 1);
await p.keyboard.press('i');
await p.waitForTimeout(200);
check('I pins the selection', (await meta(p, goal))?.pinned === true);
check('the bar now offers Unpin', await p.locator('.selection-bar button.on', { hasText: 'Unpin' }).count() === 1);
await select(p, []);
check('the board fences it as pinned', await p.locator('.scratch-pinned', { hasText: 'given to every ask' }).count() === 1);

const first = await ask(p, [seat], 'Which of these would you try first?');
check('an ask about something else gives the pinned card', first?.pinned?.length === 1 && first.pinned[0].id === goal && /churn under 3%/.test(first.pinned[0].text), JSON.stringify(first?.pinned));
check('the card asked about is the ask, not given twice as pinned', first?.id === seat && !first?.pinned?.some((g) => g.id === seat));
// While an agent works on it, selecting the ask shows what it gave, the pinned card included.
await command('ask_status', { id: first.id, state: 'working' });
await select(p, [first.id]);
await p.waitForTimeout(200);
const line = await p.locator('.ask-status').last().innerText();
check('the ask says it gave 1 pinned', /\b1 pinned\b/.test(line ?? '') && !/with \+/.test(line ?? ''), line ?? '');
const outlined = await p.evaluate((goal) => {
  const ed = window.__pairedEditor, b = ed.getShapePageBounds(goal), at = ed.pageToScreen({ x: b.x, y: b.y });
  return [...document.querySelectorAll('.ask-given')].some((el) => { const r = el.getBoundingClientRect(); return Math.abs(r.x - at.x) < 16 && Math.abs(r.y - at.y) < 16; });
}, goal);
check('the ask outlines the pinned card with its context', outlined);
await p.screenshot({ path: `${out}/pin-context-ask.png` });

// Asking about the pinned card itself gives it once, as the target.
const self = await ask(p, [goal], 'Is this goal realistic?');
check('a pinned card that is itself the ask is not given again as pinned', self?.id === goal && !self?.pinned, JSON.stringify(self?.pinned));

// Pin and leave out exclude each other.
await select(p, [usage]);
await p.keyboard.press('l');
await p.waitForTimeout(150);
await p.keyboard.press('i');
await p.waitForTimeout(150);
const both = await meta(p, usage);
check('pinning a left-out card clears leave out', both?.pinned === true && !both?.leftOut, JSON.stringify(both));
await p.evaluate(() => void window.paired.undo());
await p.waitForTimeout(200);
const undone = await meta(p, usage);
check('one undo takes the pin back (and the leave-out returns)', !undone?.pinned && undone?.leftOut === true, JSON.stringify(undone));

// A pin on another page is not given.
const firstPage = await p.evaluate(() => window.paired.read().page.id);
await command('page', { name: 'Other' });
await p.waitForTimeout(300);
const other = await make(200, 300, 'Another page entirely');
const otherAsk = await ask(p, [other], 'Anything here?');
check('a pin on another page is not given', !otherAsk?.pinned, JSON.stringify(otherAsk?.pinned));
await p.evaluate((id) => void window.__pairedEditor.setCurrentPage(id), firstPage);
await p.waitForTimeout(300);
check('no page errors', errors.length === 0, errors.join(' | '));
// Let the board save before a second tab opens it.
await p.waitForTimeout(2500);
await ctx.close();

// --- Unflagged tab, same board ---
const plain = await open('');
const plainP = plain.p;
await plainP.waitForFunction((id) => Boolean(window.__pairedEditor.getPage(id)), firstPage, { timeout: 10000 }).catch(() => {});
await plainP.evaluate((id) => void window.__pairedEditor.setCurrentPage(id), firstPage);
await plainP.waitForTimeout(800);
await select(plainP, [seat]);
check('without the flag there is no Pin button', await plainP.locator('.selection-bar button', { hasText: /^Pin/ }).count() === 0);
await plainP.keyboard.press('i');
await plainP.waitForTimeout(200);
check('without the flag I does not pin', !(await meta(plainP, seat))?.pinned);
check('a pin already on the board is still drawn', await plainP.locator('.scratch-pinned').count() >= 1);
const later = await ask(plainP, [usage], 'And this one?');
check('and still given, even though the pinned card was itself asked with earlier', later?.pinned?.some((g) => g.id === goal), JSON.stringify(later?.pinned));
await plainP.screenshot({ path: `${out}/pin-context-plain.png` });
check('no page errors without the flag', plain.errors.length === 0, plain.errors.join(' | '));
await plain.ctx.close();
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
