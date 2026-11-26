// Browser check for item 95: before sending, the person sees what an ask will give.
// Three cards sit in a frame "Pricing"; one is left out, and a goal card outside the frame is
// pinned (?prototype=context). With the Ask box open on one card, the box must say what the ask
// would give (the card, the frame, "+ 1 pinned", "· 1 left out") and the board must outline the
// card, the frame and the goal. Once sent, the ask's own line and outline must say and show the
// same. Closing the box clears the preview. A plain tab says what a plain ask gives, and on a
// 390 px phone the line stays inside the box.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-ask-preview.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`), with an empty board store (PAIRED_BOARDS_DIR
// set to a new folder). Playwright is not a dependency of this repository; it is loaded from the
// directory you run this in.
import { createRequire } from 'node:module';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-ask-preview.mjs <screenshot dir>');
const BASE = 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const browser = await chromium.launch();

async function open(query, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
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
    body: JSON.stringify({ requestId: `preview-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}

const select = (p, ids) => p.evaluate((ids) => window.paired.select(ids), ids).then(() => p.waitForTimeout(200));
const gives = (p) => p.locator('[data-ask-gives]').innerText({ timeout: 1500 }).catch(() => '');
/** Which of these shapes have an outline drawn around them (selector picks preview or sent outlines). */
const outlinedIds = (p, ids, selector) => p.evaluate(([ids, selector]) => {
  const ed = window.__pairedEditor;
  const boxes = [...document.querySelectorAll(selector)].map((el) => el.getBoundingClientRect());
  return ids.filter((id) => {
    const b = ed.getShapePageBounds(id), at = ed.pageToScreen({ x: b.x, y: b.y });
    return boxes.some((r) => Math.abs(r.x + 6 * ed.getZoomLevel() - at.x) < 4 && Math.abs(r.y + 6 * ed.getZoomLevel() - at.y) < 4);
  });
}, [ids, selector]);

// --- Flagged tab ---
const { ctx, p, errors } = await open('?prototype=context');
const make = (x, y, text) => p.evaluate(([x, y, text]) => window.paired.create({ kind: 'note', x, y, width: 220, text }), [x, y, text]).then((r) => (typeof r === 'string' ? r : r.id));
const goal = await make(120, 560, 'Goal: keep churn under 3% this year');
const seat = await make(480, 600, 'Charge per seat');
const aside = await make(740, 600, 'Draft: not sure I trust these numbers yet');
const usage = await make(1000, 600, 'Usage based, per post');
const revs = await p.evaluate((ids) => ids.map((id) => ({ id, expectedRevision: window.paired.read().objects.find((o) => o.id === id).revision })), [seat, aside, usage]);
const grouped = await command('group', { objects: revs, name: 'Pricing' });
const frame = grouped?.frame?.id ?? grouped?.frameId;
await select(p, [aside]);
await p.keyboard.press('l');
await select(p, [goal]);
await p.keyboard.press('i');
await p.waitForTimeout(200);

await select(p, [seat]);
await p.locator('.selection-bar button.primary').click();
await p.waitForTimeout(300);
const said = await gives(p);
check('the Ask box says what the ask would give', /^Gives “Charge per seat”/.test(said), said);
check('it names the frame', /frame “Pricing”/.test(said), said);
check('it counts the pinned card', /\+ 1 pinned/.test(said), said);
check('it counts the left-out card', /· 1 left out/.test(said), said);
const previewed = await outlinedIds(p, [seat, frame, goal, aside, usage], '.ask-given.preview');
check('the board outlines the card, the frame and the pinned card', [seat, frame, goal].every((id) => previewed.includes(id)), JSON.stringify(previewed));
check('and not the left-out card or the frame\'s other card', !previewed.includes(aside) && !previewed.includes(usage), JSON.stringify(previewed));
await p.screenshot({ path: `${out}/ask-preview-box.png` });

await p.locator('.selection-bar.asking input').fill('Which would you try first?');
await p.keyboard.press('Enter');
await p.waitForTimeout(400);
check('sending clears the preview', await p.locator('.ask-given.preview').count() === 0);
const sent = (await command('asks', {})).asks.find((a) => a.question === 'Which would you try first?');
check('the sent ask gives what the preview said', sent?.targets?.[0]?.id === seat && sent?.frame?.id === frame && sent?.pinned?.length === 1 && sent?.pinned[0].id === goal && sent?.leftOut === 1, JSON.stringify({ frame: sent?.frame?.id, pinned: sent?.pinned?.map((x) => x.id), leftOut: sent?.leftOut }));
await command('ask_status', { id: sent.id, state: 'working' });
await select(p, [sent.id]);
await p.waitForTimeout(200);
const line = await p.locator('.ask-status').last().innerText();
const givenPart = line.replace(/^.*· given /s, '');
check('the ask\'s line says the same as the preview', givenPart === said.replace(/^Gives /, ''), JSON.stringify({ line: givenPart, preview: said }));
const sentOutlined = await outlinedIds(p, [seat, frame, goal, aside, usage], '.ask-given:not(.preview)');
check('the ask\'s outline is the preview\'s', JSON.stringify([...sentOutlined].sort()) === JSON.stringify([...previewed].sort()), JSON.stringify({ sent: sentOutlined, previewed }));

// Esc closes the box and its preview.
await select(p, [usage]);
await p.locator('.selection-bar button.primary').click();
await p.waitForTimeout(200);
check('a box opened on another card previews that card', /^Gives “Usage based/.test(await gives(p)));
await p.keyboard.press('Escape');
await p.waitForTimeout(200);
check('Esc clears the preview', await p.locator('.ask-given.preview').count() === 0);
check('no page errors', errors.length === 0, errors.join(' | '));
await p.waitForTimeout(2000);
await ctx.close();

// --- Plain tab, on a 390 px phone ---
const phone = await open('', { width: 390, height: 844 });
const card = await phone.p.evaluate(() => window.paired.create({ kind: 'note', x: 40, y: 1400, width: 260, text: 'A long thought about whether usage pricing scares away the smallest teams before they ever see value' })).then((r) => (typeof r === 'string' ? r : r.id));
await phone.p.evaluate((id) => void window.__pairedEditor.zoomToBounds(window.__pairedEditor.getShapePageBounds(id), { inset: 40 }), card);
await select(phone.p, [card]);
await phone.p.locator('.selection-bar button.primary').click();
await phone.p.waitForTimeout(300);
const plainSaid = await gives(phone.p);
check('a plain tab says what a plain ask gives', /^Gives “A long thought/.test(plainSaid), plainSaid);
const fits = await phone.p.evaluate(() => {
  const el = document.querySelector('[data-ask-gives]'), box = document.querySelector('.selection-bar.asking');
  if (!el || !box) return false;
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  return r.left >= b.left && r.right <= b.right + 0.5 && b.left >= 0 && b.right <= window.innerWidth;
});
check('on a 390 px phone the line stays inside the box and the window', fits);
await phone.p.screenshot({ path: `${out}/ask-preview-phone.png` });
check('no page errors on the phone', phone.errors.length === 0, phone.errors.join(' | '));
await phone.ctx.close();
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
