// Browser check: each answer stays with its own ask.
//
// Starts its own dev server of this checkout with an empty board store. The person asks three
// questions about one card (the asks stack under each other); an agent answers them out of
// order with three options each. Every answer row must sit right next to its own ask, directly
// under it or beside it, and no cards may overlap. A lone ask still gets its answer underneath.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-answer-beside.mjs <screenshot dir>
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
if (!out) throw new Error('Usage: node verify-answer-beside.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5207, ORIGIN = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const boards = mkdtempSync(join(tmpdir(), 'answer-beside-boards-'));
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
  await p.evaluate(() => { const ed = window.__pairedEditor; ed.deleteShapes([...ed.getCurrentPageShapeIds()]); ed.setCamera({ x: 0, y: 0, z: 1 }); });

  const write = async (x, y, text) => {
    await p.mouse.dblclick(x, y);
    await p.waitForTimeout(300);
    await p.keyboard.type(text, { delay: 0 });
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    return p.evaluate(() => window.paired.read().objects.filter((o) => o.type === 'card').at(-1).id);
  };
  const ask = async (cardId, question) => {
    await p.evaluate((id) => window.paired.select([id]), cardId);
    await p.waitForTimeout(200);
    await p.keyboard.press('Control+Enter');
    await p.waitForSelector('.selection-bar.asking input');
    await p.fill('.selection-bar.asking input', question);
    const waiting = post('/asks/wait', { agent: 'Check agent', waitMs: 10000 });
    await p.press('.selection-bar.asking input', 'Enter');
    const got = await waiting;
    await p.waitForTimeout(300);
    return got;
  };
  const answer = (got, input) => post('/command', { requestId: randomUUID(), sessionId: got.sessionId, actor: 'Check agent', command: { op: 'answer', input: { id: got.ask.id, ...input } } });
  const layout = () => p.evaluate(() => {
    const ed = window.__pairedEditor;
    const box = (s) => { const b = ed.getShapePageBounds(s); return { x: Math.round(b.x), y: Math.round(b.y), r: Math.round(b.maxX), b: Math.round(b.maxY) }; };
    const cards = ed.getCurrentPageShapes().filter((s) => s.type === 'card');
    return {
      all: cards.map((s) => ({ id: s.id, name: s.meta.name, replyTo: s.meta.replyTo, ...box(s) })),
    };
  });
  /** Directly under its ask (left edges aligned, just below) or beside it (just right, level). */
  const nextTo = (row, a) => {
    const under = Math.abs(row.x - a.x) <= 4 && row.y >= a.b && row.y <= a.b + 90;
    const beside = row.x >= a.r && row.x <= a.r + 90 && Math.abs(row.y - a.y) <= 30;
    return under ? 'under' : beside ? 'beside' : null;
  };
  const overlaps = (cards) => cards.flatMap((a, i) => cards.slice(i + 1).filter((c) => a.x < c.r && c.x < a.r && a.y < c.b && c.y < a.b).map((c) => `${a.name} × ${c.name}`));

  // 1. Three asks about one card, answered out of order.
  const card = await write(300, 300, 'Charge per seat or per workspace?');
  const asks = [];
  for (const q of ['Which is simpler?', 'Which earns more?', 'Which do teams prefer?']) asks.push(await ask(card, q));
  for (const g of [asks[1], asks[2], asks[0]]) await answer(g, { alternatives: ['Option one is short', 'Option two is a little longer than one', 'Three'] });
  await p.waitForTimeout(1000);
  let l = await layout();
  for (const [i, g] of asks.entries()) {
    const a = l.all.find((c) => c.id === g.ask.id);
    const row = l.all.filter((c) => c.replyTo === g.ask.id);
    const first = row.reduce((m, c) => (c.x < m.x || (c.x === m.x && c.y < m.y) ? c : m), row[0]);
    const where = first && nextTo(first, a);
    check(`answer to ask ${i + 1} sits next to its own ask`, row.length === 3 && Boolean(where), first ? `${where ?? 'elsewhere'}: ask ${a.x}–${a.r}×${a.y}–${a.b}, row starts at ${first.x},${first.y}` : 'no answer');
  }
  const o1 = overlaps(l.all);
  check('no cards overlap', o1.length === 0, o1.join('; '));
  await p.evaluate(() => { window.__pairedEditor.zoomToFit({ animation: { duration: 0 } }); });
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/1-three-asks.png` });

  // 2. A lone ask on a fresh stretch of board: its answer goes underneath, as before.
  await p.evaluate(() => { const ed = window.__pairedEditor; ed.selectNone(); ed.setCamera({ x: -3000, y: 0, z: 1 }); });
  await p.waitForTimeout(300);
  const lone = await write(300, 300, 'Who pays: the team or the company?');
  const g = await ask(lone, 'Which is more common?');
  await answer(g, { text: 'The team, at first: whoever made the board.' });
  await p.waitForTimeout(800);
  l = await layout();
  const a = l.all.find((c) => c.id === g.ask.id), row = l.all.filter((c) => c.replyTo === g.ask.id);
  check('a lone ask still gets its answer underneath', row.length === 1 && nextTo(row[0], a) === 'under', row[0] ? `${nextTo(row[0], a)}: ask ${a.x},${a.b}; answer ${row[0].x},${row[0].y}` : 'no answer');
  await p.screenshot({ path: `${out}/2-lone-ask.png` });
  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await browser.close();
  server.kill();
  rmSync(boards, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
