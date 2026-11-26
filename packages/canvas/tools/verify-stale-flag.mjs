// Browser check for item 52: a stale flag never names a hidden input, and its full reason
// can be read without a pointer.
//   1. A note derived from an input with a long name goes stale; its flag is cut short on the
//      board, and selecting the note (or focusing the flag from the keyboard) shows the
//      whole reason.
//   2. A note derived from an input that a learning prompt hides goes stale; the flag, its
//      tooltip and its accessible name must not contain the hidden input's name.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-stale-flag.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`). Playwright is not a dependency of this
// repository; it is loaded from the directory you run this in.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-stale-flag.mjs <screenshot dir>');
const BASE = 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'stale-flag-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/?prototype=learning`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 20000 });
await p.waitForTimeout(800);

let n = 0;
// Names unique to this run, so objects left on a reused board never answer for these.
const run = Date.now().toString(36);
const plan = `Hiring plan ${run}`, retention = `Retention note ${run}`;
async function command(op, input) {
  const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
  const list = sessions.sessions ?? sessions;
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `stale-flag-${++n}`, sessionId: list[0]?.id ?? list[0]?.sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
// Found by its accessible name ("<name> is out of date: …"), which every version of the flag has.
const flagOf = (name) => p.evaluate((name) => {
  const el = [...document.querySelectorAll('.stale-flag')].find((f) => (f.getAttribute('aria-label') ?? '').startsWith(`${name} is out of date`));
  if (!el) return null;
  return { text: el.textContent, title: el.getAttribute('title'), label: el.getAttribute('aria-label'), clipped: el.scrollWidth > el.clientWidth + 1, tab: el.tabIndex };
}, name);

// 1. A long reason, cut on the board, read in full by selecting or by keyboard.
const longName = 'Quarterly revenue estimate for the northern sales region, before returns';
const input = await command('create', { kind: 'note', x: 120, y: 560, width: 300, text: 'Revenue: 1.2m', name: longName });
const derived = await command('create', { kind: 'note', x: 520, y: 560, width: 300, text: 'So we can hire two people', name: plan, inputs: [input.id] });
await command('update', { id: input.id, expectedRevision: input.revision, text: 'Revenue: 0.9m' });
await p.waitForTimeout(400);
// Nothing selected: the board view.
await p.evaluate(() => window.paired.select([]));
await p.waitForTimeout(200);
let flag = await flagOf(plan);
check('the derived note is flagged stale with the input named', flag?.text?.includes(longName), flag?.text);
check('on the board the long reason is cut short', flag?.clipped === true);
await p.screenshot({ path: `${out}/stale-flag-board.png` });
await p.evaluate((id) => window.paired.select([id]), derived.id);
await p.waitForTimeout(300);
flag = await flagOf(plan);
check('selecting the note shows the whole reason', flag?.clipped === false);
await p.screenshot({ path: `${out}/stale-flag-selected.png` });
await p.evaluate(() => window.paired.select([]));
await p.waitForTimeout(200);
check('the flag can be reached with the keyboard', flag?.tab === 0);
await p.evaluate((name) => [...document.querySelectorAll('.stale-flag')].find((f) => (f.getAttribute('aria-label') ?? '').startsWith(name))?.focus(), plan);
await p.waitForTimeout(200);
flag = await flagOf(plan);
check('focusing the flag shows the whole reason', flag?.clipped === false);
await p.screenshot({ path: `${out}/stale-flag-focused.png` });

// 2. An input hidden behind a learning prompt is never named.
const secretName = 'Answer to predict: churn is 14 percent';
const hidden = await command('create', { kind: 'note', x: 120, y: 820, width: 300, text: '14%', name: secretName });
const result = await command('create', { kind: 'note', x: 520, y: 820, width: 300, text: 'Retention needs work', name: retention, inputs: [hidden.id] });
await command('update', { id: hidden.id, expectedRevision: hidden.revision, text: '15%' });
await command('learn', { mode: 'predict', question: 'What do you expect churn to be?', x: 900, y: 820, hideIds: [hidden.id] });
await p.waitForTimeout(400);
flag = await flagOf(retention);
const leaked = [flag?.text, flag?.title, flag?.label].some((s) => (s ?? '').includes('churn is 14'));
check('the stale flag on a result of a hidden input is shown', Boolean(flag), flag?.text);
check('nothing about the flag names the hidden input', !leaked, JSON.stringify(flag));
check('no page errors', errors.length === 0, errors.join(' | '));
await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
