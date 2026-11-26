// Browser check for item 82: what a screen reader hears when the selection moves.
//
// On a fresh profile at 1440 x 900, keyboard only: write a thought (N, Enter, type, Esc), send it
// with Ctrl/⌘+Enter (the card is the question), let an agent answer with three over HTTP, Tab
// through the answer, pick one and comment on another. After each step one polite live region,
// never seen, must say who made the selected object, its text, its kind (thought, ask with its
// state, comment, answer), its mark and its place in the Tab order.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-heard.mjs <screenshot dir>
//
// Needs a dev server for this checkout with an empty board store (packages/canvas/.local/boards).
// No model is needed. Playwright is loaded from the directory you run this in. Exits non-zero
// if any check fails.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-heard.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'heard-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await p.waitForTimeout(1500);
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

let n = 0;
async function command(op, input) {
  const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
  const list = sessions.sessions ?? sessions;
  const sessionId = list[0]?.id ?? list[0]?.sessionId;
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `heard-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
const press = async (key, wait = 350) => { await p.keyboard.press(key); await p.waitForTimeout(wait); };
/** The selection's live region: its text, politeness and whether it can be seen. */
const heard = () => p.evaluate(() => {
  const el = document.querySelector('[data-stop-announcer]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { text: el.textContent.trim(), live: el.getAttribute('aria-live'), seen: r.width > 2 && r.height > 2 };
});
const selectedId = () => p.evaluate(() => window.__pairedEditor.getOnlySelectedShapeId());

const first = await heard();
check('a polite live region for the selection is on the page, unseen and silent at first', Boolean(first) && first.live === 'polite' && !first.seen && first.text === '', JSON.stringify(first));

// The person's thought.
await press('n');
await press('Enter', 500);
// No question mark: finishing a question sends it at once, and this step is about a thought.
await p.keyboard.type('How should we price the team plan', { delay: 0 });
await p.waitForTimeout(300);
let h = await heard();
check('nothing is said while typing', h?.text === '', h?.text);
await press('Escape', 500);
h = await heard();
check("the person's selected thought is said as theirs, with its place in the order", /^You wrote: How should we price the team plan\. \d+ of \d+\.$/.test(h?.text ?? ''), h?.text);

// Ask (the card is the question: Ctrl/⌘+Enter sends it), and the agent answers with three options.
const thoughtId = await selectedId();
await press(`${mod}+Enter`, 800);
const ask = (await command('asks', {})).asks.find((a) => a.id === thoughtId);
check('the ask was sent', Boolean(ask));
// Something else stays selected while the answer lands: what is said counts the new stops.
const other = await p.evaluate((ask) => window.paired.read().objects.find((o) => o.type === 'card' && o.id !== ask)?.id, thoughtId);
await p.evaluate((id) => { window.paired.select([id]); window.__pairedEditor.focus(); }, other);
await p.waitForTimeout(400);
const totalOf = (text) => Number(/ of (\d+)\.$/.exec(text ?? '')?.[1] ?? NaN);
const totalBefore = totalOf((await heard())?.text);
const options = ask ? (await command('answer', { id: ask.id, alternatives: ['Per seat, so cost tracks team size', 'Per post, so cost tracks use', 'One flat price for any team'] })).answers.map((o) => o.id) : [];
await p.waitForTimeout(800);
const totalAfter = totalOf((await heard())?.text);
check('an answer landing while another card is selected updates the count said', totalAfter === totalBefore + 3, `${totalBefore} → ${totalAfter}`);
await p.evaluate(() => { window.__pairedEditor.selectNone(); });

// Tab to the ask, then to option A.
let askSaid = '', optionSaid = '';
for (let i = 0; i < 12 && (await selectedId()) !== options[0]; i++) {
  await press('Tab', 300);
  const id = await selectedId();
  if (id === ask?.id) askSaid = (await heard())?.text ?? '';
}
optionSaid = (await heard())?.text ?? '';
check('an ask is said as the person\'s, with who answered it', /^Your ask: How should we price the team plan\. Answered by Verifier\. \d+ of \d+\.$/.test(askSaid), askSaid);
check("an answer is said as the agent's, with its text", /^Verifier answered: A · Per seat, so cost tracks team size\. \d+ of \d+\.$/.test(optionSaid), optionSaid);
await press('p');
h = await heard();
check('picking it is said', /Per seat, so cost tracks team size\. Picked\. \d+ of \d+\.$/.test(h?.text ?? ''), h?.text);
await press('Tab');
await press('x');
h = await heard();
check('crossing out the next is said', /^Verifier answered: B · Per post, so cost tracks use\. Crossed out\. \d+ of \d+\.$/.test(h?.text ?? ''), h?.text);

// A comment on it.
await press('c', 500);
await p.keyboard.type('Too unpredictable for a budget', { delay: 0 });
await press('Escape', 500);
h = await heard();
check('the person\'s comment is said as theirs', /^Your comment: Too unpredictable for a budget\./.test(h?.text ?? ''), h?.text);
await p.screenshot({ path: `${out}/heard-board.png` });

// Several at once, and nothing.
await press(`${mod}+a`);
h = await heard();
check('selecting several says how many', /^\d+ objects selected\.$/.test(h?.text ?? ''), h?.text);
await press('Escape');
h = await heard();
check('nothing selected says nothing', h?.text === '', h?.text);
const region = await heard();
check('the region is never seen', region && !region.seen, JSON.stringify(region));
check('no page errors', errors.length === 0, errors.join(' | '));

await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
