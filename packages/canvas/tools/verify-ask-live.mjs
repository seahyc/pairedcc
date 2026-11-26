// Browser check: an ask's progress is announced to assistive technology.
//
// Starts its own dev server of this checkout with an empty board store. The person asks in a
// real page and an agent takes, answers or fails the ask over HTTP. A polite live region must
// say each change of state once (sent, working with its note, answered with how many options,
// failed with Retry), stay silent while the state line's clock ticks, and never be seen.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-ask-live.mjs <screenshot dir>
//
// Playwright is not a dependency of this repository; it is loaded from the directory you run
// this in. Exits non-zero if any check fails.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');

const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-ask-live.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5205, ORIGIN = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const boards = mkdtempSync(join(tmpdir(), 'ask-live-boards-'));
const server = spawn(process.execPath, [join(pkg, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], {
  cwd: pkg, env: { ...process.env, PAIRED_BOARDS_DIR: boards }, stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('dev server did not start')), 30000);
  server.stdout.on('data', (d) => { if (/Local:/.test(String(d))) { clearTimeout(timer); resolve(); } });
  server.on('exit', (code) => reject(new Error(`dev server exited ${code}`)));
});
const post = (path, body) => fetch(`${ORIGIN}/api/canvas${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body),
}).then((r) => r.json());

const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  await p.goto(`${ORIGIN}/canvas/`);
  await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  const region = () => p.evaluate(() => {
    const el = [...document.querySelectorAll('[aria-live="polite"], [role="status"]')].find((e) => e.closest('[data-ask-announcer]') || e.hasAttribute('data-ask-announcer'));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { text: el.textContent.trim(), live: el.getAttribute('aria-live'), seen: r.width > 2 && r.height > 2 };
  });
  const first = await region();
  check('a polite live region for asks is on the page, unseen and silent at first', Boolean(first) && first.live === 'polite' && !first.seen && first.text === '', JSON.stringify(first));

  /** The person writes and asks; the agent waiting receives it. */
  async function ask(x, y, text, question) {
    await p.mouse.dblclick(x, y);
    await p.waitForTimeout(300);
    await p.keyboard.type(text, { delay: 0 });
    await p.keyboard.press('Control+Enter');
    await p.waitForSelector('.selection-bar.asking input');
    await p.fill('.selection-bar.asking input', question);
    const waiting = post('/asks/wait', { agent: 'Check agent', waitMs: 10000 });
    await p.press('.selection-bar.asking input', 'Enter');
    return waiting;
  }
  const cmd = (got, op, input) => post('/command', { requestId: randomUUID(), sessionId: got.sessionId, actor: 'Check agent', command: { op, input: { id: got.ask.id, ...input } } });

  // The waiting agent takes the ask at once, so "sent" is said first.
  const got = await ask(320, 700, 'Charge per seat or per workspace?', 'Which is simpler to explain?');
  await p.waitForTimeout(500);
  const sent = await region();
  check('sending an ask is said', /Asked “Which is simpler to explain\?”/.test(sent?.text ?? ''), sent?.text);
  await p.waitForTimeout(2500);
  check('the ticking clock on the state line is not read out', (await region())?.text === sent?.text);
  await cmd(got, 'ask_status', { state: 'working', note: 'reading your card' });
  await p.waitForTimeout(500);
  const working = await region();
  check('an agent taking the ask is said, with its note', working?.text === 'Check agent is working on your ask: reading your card.', working?.text);
  await cmd(got, 'answer', { alternatives: ['Per seat', 'Per workspace', 'A base fee plus seats'] });
  await p.waitForTimeout(600);
  const answered = await region();
  check('an answer is said, with how many options and where', answered?.text === 'Check agent answered with 3 options, under your ask.', answered?.text);
  await p.screenshot({ path: `${out}/1-answered.png` });

  await p.evaluate(() => { window.__pairedEditor.selectNone(); });
  const second = await ask(320, 160, 'Who pays?', 'Team or company?');
  await p.waitForTimeout(400);
  await cmd(second, 'ask_status', { state: 'failed', error: 'The model took too long' });
  await p.waitForTimeout(600);
  const failed = await region();
  check('a failed ask is said, with why and that Retry is there', failed?.text === 'Your ask failed: The model took too long. Retry is under the ask.', failed?.text);
  const lines = await p.evaluate(() => [...document.querySelectorAll('.ask-status')].filter((e) => e.closest('[aria-live]')).length);
  check('the state lines themselves are not live regions', lines === 0, `${lines} live`);
  await p.screenshot({ path: `${out}/2-failed.png` });
  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await browser.close();
  server.kill();
  rmSync(boards, { recursive: true, force: true });
}
const failedCount = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failedCount}/${results.length} checks pass`);
process.exit(failedCount ? 1 : 0);
