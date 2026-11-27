// Browser check for item 85: an answer on another page is one step away.
// The person asks about a card, opens another page while waiting, and the agent answers over
// HTTP. The notice must offer Show (a button and the G key), stay up long enough to press it,
// and leave the view alone until it is pressed. Show must open the ask's page, select the
// answer and bring it into view. A failed ask's Show selects the ask, so Retry is on it.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-answer-show.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`; set CANVAS_BASE for another). Playwright is not a dependency of this
// repository; it is loaded from the directory you run this in.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-answer-show.mjs <screenshot dir>');
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'answer-show-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 20000 });
await p.waitForTimeout(800);
const sessionId = await p.evaluate(() => window.paired.sessionId ?? null);

let n = 0;
async function command(op, input) {
  const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
  const list = sessions.sessions ?? sessions;
  const id = sessionId ?? list[list.length - 1]?.id ?? list[list.length - 1]?.sessionId;
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `answer-show-${Date.now()}-${++n}`, sessionId: id, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}

// The card is the question: the person writes the question on a card of their own right under
// what it is about, selects it and sends it with Ask (there is no question box). The card becomes
// the ask; what sits beside it is given with it.
async function ask(ids, question) {
  const id = await p.evaluate(([ids, question]) => {
    const ed = window.__pairedEditor, bs = ids.map((id) => ed.getShapePageBounds(id));
    const x = Math.min(...bs.map((b) => b.x)), r = Math.max(...bs.map((b) => b.maxX));
    const below = ed.getCurrentPageShapes().filter((s) => s.type !== 'arrow' && s.type !== 'frame').map((s) => ed.getShapePageBounds(s)).filter((b) => b.x < r && b.maxX > x);
    const made = window.paired.create({ kind: 'note', x, y: Math.max(...below.map((b) => b.maxY)) + 24, width: 300, text: question });
    return typeof made === 'string' ? made : made.id;
  }, [ids, question]);
  await p.evaluate((id) => window.paired.select([id]), id);
  await p.waitForTimeout(200);
  await p.locator('.selection-bar button.primary').click();
  await p.waitForTimeout(400);
  const sent = (await command('asks', {})).asks.find((a) => a.question === question);
  if (sent?.id !== id) throw new Error(`the card was not sent as the ask: ${JSON.stringify(sent)}`);
  return id;
}
const state = () => p.evaluate(() => {
  const ed = window.__pairedEditor;
  return { page: ed.getCurrentPageId(), camera: ed.getCamera(), selected: ed.getSelectedShapeIds() };
});
/** Whether a shape's whole box is inside the window, clear of the top bar and the tool strip. */
const inView = (id) => p.evaluate((id) => {
  const ed = window.__pairedEditor, b = ed.getShapePageBounds(id);
  if (!b) return false;
  const a = ed.pageToScreen({ x: b.x, y: b.y }), z = ed.pageToScreen({ x: b.maxX, y: b.maxY });
  return a.x >= 60 && a.y >= 60 && z.x <= window.innerWidth && z.y <= window.innerHeight - 40;
}, id);

const card = await p.evaluate(() => window.paired.create({ kind: 'note', x: 120, y: 520, width: 300, text: 'Is the team plan priced per seat?' }));
const cardId = typeof card === 'string' ? card : card.id;
const firstPage = await p.evaluate(() => window.paired.read().page.id);
const askId = await ask([cardId], 'What would change if it were flat?');
// The person had scrolled far away on this page before leaving it, so the answer is off screen there.
await p.evaluate(() => { const ed = window.__pairedEditor; void ed.setCamera({ x: -4000, y: -3000, z: 1 }); });
await command('page', { name: 'Elsewhere' });
await p.waitForTimeout(300);
await p.evaluate(() => window.paired.create({ kind: 'note', x: 200, y: 200, width: 260, text: 'My work here' }));
await p.evaluate(() => void window.__pairedEditor.selectNone());
const before = await state();
const answered = await command('answer', { id: askId, text: 'Take a ten-person team: flat price is the same as five seats today.' });
const answerId = answered.answers[0].id;
await p.waitForTimeout(300);
const toast = p.locator('.toast');
check('the person is told who answered and where', /Verifier answered .* on the page/.test((await toast.textContent({ timeout: 2000 }).catch(() => '')) ?? ''));
const show = toast.getByRole('button', { name: /^Show/ });
check('the notice offers Show', await show.count() === 1);
check('Show names its key', /G/.test((await show.textContent().catch(() => '')) ?? ''));
await p.screenshot({ path: `${out}/answer-show-notice.png` });
const during = await state();
check('the view does not move by itself', during.page === before.page && JSON.stringify(during.camera) === JSON.stringify(before.camera), JSON.stringify({ before: before.camera, during: during.camera }));
await p.waitForTimeout(5000);
check('the notice is still up 5 s later, long enough to press Show', await show.isVisible().catch(() => false));
await p.keyboard.press('g');
await p.waitForTimeout(500);
const after = await state();
check('G opens the ask\'s page', after.page === firstPage, after.page);
check('and selects the answer', after.selected.length === 1 && after.selected[0] === answerId, JSON.stringify(after.selected));
check('and brings it into view', await inView(answerId));
check('the notice is gone once used', await toast.count() === 0);
await p.screenshot({ path: `${out}/answer-show-shown.png` });

// A failed ask: Show (clicked this time) selects the ask, whose Retry is then on screen.
await p.evaluate((id) => void window.__pairedEditor.setCurrentPage(id), firstPage);
const failId = await ask([cardId], 'Is there a cheaper plan?');
await p.evaluate(() => { const ed = window.__pairedEditor; void ed.setCamera({ x: 3000, y: 3000, z: 1 }); });
await p.evaluate((id) => void window.__pairedEditor.setCurrentPage(id), before.page);
await p.waitForTimeout(300);
await command('ask_status', { id: failId, state: 'failed', error: 'The price list was not on the board' });
await p.waitForTimeout(300);
check('a failed ask says so with Show', /could not be answered/.test((await toast.textContent({ timeout: 2000 }).catch(() => '')) ?? '') && await show.count() === 1);
if (await show.count()) await show.click();
await p.waitForTimeout(500);
const failed = await state();
check('Show opens the failed ask\'s page and selects the ask', failed.page === firstPage && failed.selected.length === 1 && failed.selected[0] === failId, JSON.stringify(failed));
check('the failed ask is in view', await inView(failId));
check('Retry is on screen', await p.getByRole('button', { name: /Retry/ }).first().isVisible().catch(() => false));

// On a 390 px phone the notice and its Show button stay inside the window.
await p.setViewportSize({ width: 390, height: 844 });
await p.evaluate((id) => void window.__pairedEditor.setCurrentPage(id), firstPage);
const phoneId = await ask([cardId], 'Which plan would a two-person team pick, and why would they?');
await p.evaluate((id) => void window.__pairedEditor.setCurrentPage(id), before.page);
await p.waitForTimeout(300);
await command('answer', { id: phoneId, text: 'The solo plan, unless both need to edit at once.' });
await p.waitForTimeout(400);
const box = await toast.boundingBox().catch(() => null), btn = await show.boundingBox().catch(() => null);
check('on a 390 px phone the notice and Show fit the window', Boolean(box && btn && box.x >= 0 && box.x + box.width <= 390 && btn.x + btn.width <= 390), JSON.stringify({ box, btn }));
await p.screenshot({ path: `${out}/answer-show-phone.png` });
if (await show.count()) await show.click();
await p.waitForTimeout(400);
check('Show on the phone brings the answer into view', await p.evaluate(() => {
  const ed = window.__pairedEditor, id = ed.getSelectedShapeIds()[0], b = id && ed.getShapePageBounds(id);
  if (!b) return false;
  const a = ed.pageToScreen({ x: b.x, y: b.y }), z = ed.pageToScreen({ x: b.maxX, y: b.maxY });
  return a.x >= 0 && a.y >= 44 && z.x <= window.innerWidth && z.y <= window.innerHeight;
}));
await p.setViewportSize({ width: 1440, height: 900 });

// G does nothing when no such notice is up (it is not taken from the canvas otherwise).
await p.evaluate(() => void window.__pairedEditor.selectNone());
const quiet = await state();
await p.keyboard.press('g');
await p.waitForTimeout(200);
check('G with no notice up leaves the page alone', (await state()).page === quiet.page);
check('no page errors', errors.length === 0, errors.join(' | '));
await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
