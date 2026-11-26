// Browser check for item 88: a failed ask is retried from the keyboard.
//
// On a fresh profile at 1440 x 900: the person writes a card and asks; an agent fails the ask
// over HTTP. With the failed ask selected, the selection bar's first button must say Retry with
// its key, and Ctrl/⌘+Enter must send the ask again (a new attempt, waiting) without opening
// the Ask box or making a new ask. The button does the same. An answered ask and a card keep Ask.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-retry-key.mjs <screenshot dir>
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
if (!out) throw new Error('Usage: node verify-retry-key.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'retry-key-')), { viewport: { width: 1440, height: 900 } });
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
    body: JSON.stringify({ requestId: `retry-key-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
const askState = (id) => p.evaluate((id) => window.__pairedEditor.getShape(id)?.meta.ask, id);
const askCount = () => p.evaluate(() => window.__pairedEditor.getCurrentPageShapes().filter((s) => s.meta.ask).length);
const primary = () => p.evaluate(() => document.querySelector('.selection-bar > button.primary')?.textContent?.trim() ?? null);
const select = async (id) => { await p.evaluate((id) => { window.paired.select([id]); window.__pairedEditor.focus(); }, id); await p.waitForTimeout(300); };

// The person's card and an ask about it.
const card = await p.evaluate(() => window.paired.create({ kind: 'note', x: 120, y: 560, width: 300, text: 'How should we price the team plan?' }));
const cardId = typeof card === 'string' ? card : card.id;
await select(cardId);
await p.keyboard.press(`${mod}+Enter`);
await p.waitForSelector('.selection-bar.asking input');
await p.fill('.selection-bar.asking input', 'Give me options');
await p.keyboard.press('Enter');
await p.waitForTimeout(500);
const ask = (await command('asks', {})).asks.find((a) => a.question === 'Give me options');
check('the ask was sent', Boolean(ask));

// The agent fails it.
await command('ask_status', { id: ask.id, state: 'failed', error: 'The model took too long' });
await p.waitForTimeout(500);
await select(ask.id);
const label = await primary();
check("a selected failed ask's first button is Retry, with its key", /Retry/.test(label ?? '') && /(⌘|Ctrl)/.test(label ?? ''), String(label));
await p.screenshot({ path: `${out}/retry-bar.png` });

// Ctrl/⌘+Enter retries.
const before = await askState(ask.id);
const asksBefore = await askCount();
await p.keyboard.press(`${mod}+Enter`);
await p.waitForTimeout(500);
let after = await askState(ask.id);
const boxOpen = await p.evaluate(() => Boolean(document.querySelector('.selection-bar.asking')));
check('Ctrl/⌘+Enter sends it again as a new attempt', after?.state === 'waiting' && after.attempt === (before?.attempt ?? 0) + 1, JSON.stringify({ before: before?.state, after: after?.state, attempt: after?.attempt }));
check('…without opening the Ask box or making a new ask', !boxOpen && (await askCount()) === asksBefore, `box ${boxOpen}, asks ${asksBefore} → ${await askCount()}`);
const again = (await command('asks', {})).asks.find((a) => a.id === ask.id);
check('the agent sees the ask again', Boolean(again) && again.attempt === after?.attempt, JSON.stringify(again && { state: again.state, attempt: again.attempt }));

// The button does the same.
await p.keyboard.press('Escape');
await p.waitForTimeout(200);
await command('ask_status', { id: ask.id, state: 'failed', error: 'Again' });
await p.waitForTimeout(500);
await select(ask.id);
await p.click('.selection-bar > button.primary');
await p.waitForTimeout(500);
after = await askState(ask.id);
check('the Retry button sends it again too', after?.state === 'waiting' && after.attempt === (before?.attempt ?? 0) + 2, JSON.stringify({ state: after?.state, attempt: after?.attempt }));

// An answered ask and a card keep Ask.
await command('answer', { id: ask.id, text: 'Start with one case: a team of five paying per seat.' });
await p.waitForTimeout(500);
await select(ask.id);
check('an answered ask keeps Ask', /Ask/.test((await primary()) ?? '') && !/Retry/.test((await primary()) ?? ''), String(await primary()));
await select(cardId);
check('a card keeps Ask', /Ask/.test((await primary()) ?? ''), String(await primary()));
check('no page errors', errors.length === 0, errors.join(' | '));

await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
