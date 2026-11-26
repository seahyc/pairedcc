// Browser check for item 102: a notice stays while the person is on it.
// A notice disappears on a timer (3.5 s; 12 s when it has Show). While the pointer is over it,
// or keyboard focus is on its Show button, it must stay; once the person leaves it, it goes
// after its full time again.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-notice-hold.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`). Playwright is not a dependency of this
// repository; it is loaded from the directory you run this in.
import { createRequire } from 'node:module';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-notice-hold.mjs <screenshot dir>');
const BASE = 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 20000 });
await p.waitForTimeout(800);

let n = 0;
async function command(op, input) {
  const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
  const list = sessions.sessions ?? sessions;
  const sessionId = list[list.length - 1]?.id ?? list[list.length - 1]?.sessionId;
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `hold-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
const toast = p.locator('.toast');

// 1. A plain notice ("Select what you mean first, then ask"), held by the pointer.
await p.evaluate(() => void window.__pairedEditor.selectNone());
await p.getByRole('button', { name: /^Ask/ }).first().click();
await p.waitForTimeout(200);
check('a plain notice appears', await toast.isVisible(), (await toast.textContent().catch(() => '')) ?? '');
await toast.hover({ timeout: 2000 }).catch(() => {});
await p.waitForTimeout(5000);
check('it is still up 5 s later while the pointer is over it', await toast.isVisible());
await p.screenshot({ path: `${out}/notice-hold-hover.png` });
await p.mouse.move(700, 300);
await p.waitForTimeout(2000);
check('it stays its full time after the pointer leaves', await toast.isVisible());
await p.waitForTimeout(2500);
check('then it goes', await toast.count() === 0);

// 2. An answer on another page: focus on Show holds the notice past its 12 s.
const card = await p.evaluate(() => window.paired.create({ kind: 'note', x: 120, y: 520, width: 300, text: 'Is the team plan priced per seat?' })).then((r) => (typeof r === 'string' ? r : r.id));
await p.evaluate((id) => window.paired.select([id]), card);
await p.waitForTimeout(200);
await p.locator('.selection-bar button.primary').click();
await p.locator('.selection-bar.asking input').fill('What if it were flat?');
await p.keyboard.press('Enter');
await p.waitForTimeout(400);
const askId = (await command('asks', {})).asks.find((a) => a.question === 'What if it were flat?').id;
await command('page', { name: 'Elsewhere' });
await p.waitForTimeout(300);
await p.mouse.move(700, 300);
await command('answer', { id: askId, text: 'A ten-person team pays what five seats cost today.' });
await p.waitForTimeout(300);
const show = toast.getByRole('button', { name: /^Show/ });
check('the answer notice offers Show', await show.count() === 1);
await show.focus({ timeout: 2000 }).catch(() => {});
await p.waitForTimeout(13500);
check('with focus on Show it is still up after 13.5 s', await show.isVisible().catch(() => false));
await p.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
await p.waitForTimeout(6000);
check('after focus leaves it is still there for a while', await toast.isVisible().catch(() => false));
await p.waitForTimeout(7000);
check('then it goes', await toast.count() === 0);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
