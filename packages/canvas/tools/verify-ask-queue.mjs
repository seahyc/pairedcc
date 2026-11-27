// Browser check for the review of #154: the person's own card sent as a question, in the queue.
//
//   1. the person sends a card (Ctrl+Enter); an agent replies with a clarifying question: the
//      queue row stays open (the turn is the person's);
//   2. the agent answers: the row is resolved; Resolve and Reopen work on it over the API;
//   3. Check me on that answer puts it away: the queue does not show its text until the person
//      answers the check.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-ask-queue.mjs <screenshot dir>
//
// Starts its own dev server with a throwaway board store. No model is needed.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-ask-queue.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.ASK_QUEUE_PORT ?? 5218), ORIGIN = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const boards = mkdtempSync(join(tmpdir(), 'ask-queue-boards-'));
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
  await p.waitForFunction(() => window.paired?.read().objects.length >= 1, null, { timeout: 30000 });
  await p.waitForTimeout(1200);
  let sid;
  const command = async (op, input) => {
    const body = await post('/command', { requestId: randomUUID(), sessionId: sid, actor: 'Check agent', command: { op, input } });
    if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body).slice(0, 300)}`);
    return body.result;
  };
  const card = await p.evaluate(() => {
    const ed = window.__pairedEditor;
    ed.deleteShapes([...ed.getCurrentPageShapeIds()]);
    ed.setCamera({ x: 0, y: 0, z: 1 });
    ed.createShape({ type: 'card', x: 300, y: 200, props: { w: 300, tone: 'human', richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'How much should the team plan cost' }] }] } } });
    return ed.getCurrentPageShapes().find((s) => s.type === 'card').id;
  });
  await p.evaluate((id) => window.paired.select([id]), card);
  const waiting = post('/asks/wait', { agent: 'Check agent', waitMs: 10000 });
  await p.keyboard.press('Control+Enter');
  const got = await waiting;
  sid = got.sessionId;
  const row = async () => (await command('feedback', { status: 'all' })).items.find((i) => i.id === card);
  check('the sent card is in the queue, open', (await row())?.status === 'open');
  await command('answer', { id: card, text: 'For how many seats?', question: true });
  await p.waitForTimeout(300);
  check('a clarifying question leaves it open', (await row())?.status === 'open', JSON.stringify((await row())?.status));
  const answered = await command('answer', { id: card, text: 'Ten a seat, with a floor of five seats.' });
  await p.waitForTimeout(300);
  let r = await row();
  check('the answer resolves it, with the answer as a reply', r?.status === 'resolved' && r.replies.some((x) => x.text.includes('floor of five')), JSON.stringify(r?.replies?.map((x) => x.text)));
  await command('resolve', { id: card, status: 'open', expectedRevision: (await row()).revision });
  check('Reopen works on it', (await row())?.status === 'open');
  await command('resolve', { id: card, status: 'resolved', expectedRevision: (await row()).revision });
  check('and Resolve again', (await row())?.status === 'resolved');

  // 3. Check me on the answer.
  const answerId = answered.answers[0].id;
  await p.evaluate((id) => window.paired.select([id]), answerId);
  await p.waitForTimeout(200);
  await p.keyboard.press('e');
  await p.waitForTimeout(500);
  r = await row();
  check('while the answer is put away behind Check me, the queue does not show it', r && !r.replies.some((x) => x.text.includes('floor of five')), JSON.stringify(r?.replies?.map((x) => x.text)));
  await p.keyboard.type('Per seat, with a minimum.');
  await p.locator('.learn-prompt.is-open').getByRole('button', { name: 'Show me the answer' }).click();
  await p.waitForTimeout(400);
  r = await row();
  check('once the person answers the check, it is back in the queue', r?.replies.some((x) => x.text.includes('floor of five')));
  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await browser.close();
  server.kill();
  rmSync(boards, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
