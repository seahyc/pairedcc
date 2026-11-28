// Browser check for item 144 (finding 1, working memory holds about four things): at most four
// unfinished threads stay open on a page.
//
// Starts its own dev server with a throwaway board store, opens the canvas at 1440 x 900 and:
//   1. the person asks twelve questions and a stand-in agent answers each with two options; nothing
//      is picked. The four most recently asked stay open; the other eight fold to one line each
//      ("question · 2 options, none picked yet"); nothing moved and nothing was deleted;
//   2. an agent's read and overview report the eight as folded and undecided, the four as open;
//   3. the person goes to a folded thread (selects its question): it opens while they are on it
//      and no other thread changes; moving on folds it again;
//   4. a thirteenth question waiting for its answer stays open and counts as one of the four;
//   5. pressing a folded line unfolds it for good (saved; one undo folds it back);
//   6. picking an answer on an open thread finishes it, so it folds by P1's rule and the most
//      recent folded undecided thread comes back;
//   7. everything survives a reload.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-thread-limit.mjs <screenshot dir>
//
// No model is needed. Exits non-zero if any check fails.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-thread-limit.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.THREAD_LIMIT_PORT ?? 5237), ORIGIN = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const boards = mkdtempSync(join(tmpdir(), 'thread-limit-boards-'));
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
const profile = mkdtempSync(join(tmpdir(), 'thread-limit-profile-'));
const ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 1440, height: 900 } });
try {
  const p = ctx.pages()[0] ?? await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  const open = async () => {
    await p.goto(`${ORIGIN}/canvas/`);
    await p.waitForFunction(() => window.paired?.read().objects.length >= 1, null, { timeout: 30000 });
    await p.waitForTimeout(1200);
  };
  await open();
  await p.screenshot({ path: `${out}/0-first-screen.png` });
  check('the first screen has no fold line', (await p.locator('.fold-line, .fold-button').count()) === 0);
  await p.evaluate(() => { const ed = window.__pairedEditor; ed.deleteShapes([...ed.getCurrentPageShapeIds()]); ed.setCamera({ x: 0, y: 0, z: 1 }); });

  const command = async (op, input, sessionId) => {
    const sid = sessionId ?? await p.evaluate(() => document.documentElement.dataset.pairedSession);
    const body = await post('/command', { requestId: randomUUID(), sessionId: sid, actor: 'Check agent', command: { op, input } });
    if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body).slice(0, 300)}`);
    return body.result;
  };
  /** The person writes a question card at (x, y) page and sends it; a stand-in agent answers with options. */
  const thread = async (x, y, question, options, answer = true) => {
    const id = await p.evaluate(([x, y, question]) => {
      const made = window.paired.create({ kind: 'note', x, y, width: 300, text: question });
      return typeof made === 'string' ? made : made.id;
    }, [x, y, question]);
    await p.evaluate((id) => window.paired.select([id]), id);
    await p.waitForTimeout(150);
    const waiting = post('/asks/wait', { agent: 'Check agent', waitMs: 10000 });
    await p.keyboard.press('Control+Enter');
    const got = await waiting;
    if (!got.ask) throw new Error(`no ask arrived for ${question}: ${JSON.stringify(got).slice(0, 200)}`);
    if (!answer) return { ask: got.ask.id, sessionId: got.sessionId, answers: [] };
    const answered = await command('answer', { id: got.ask.id, alternatives: options }, got.sessionId);
    await p.waitForTimeout(200);
    return { ask: got.ask.id, answers: answered.answers.map((a) => a.id) };
  };
  const state = () => p.evaluate(() => {
    const ed = window.__pairedEditor;
    const shapes = ed.getCurrentPageShapes();
    return {
      hidden: Object.fromEntries(shapes.map((s) => [s.id, ed.isShapeHidden(s)])),
      bounds: Object.fromEntries(shapes.map((s) => { const b = ed.getShapePageBounds(s); return [s.id, [Math.round(b.x), Math.round(b.y), Math.round(b.w)]]; })),
      lines: [...document.querySelectorAll('.fold-line')].map((el) => {
        const r = el.getBoundingClientRect();
        const inside = [...el.children].every((c) => { const k = c.getBoundingClientRect(); return k.right <= r.right + 1 && k.left >= r.left - 1 && k.bottom <= r.bottom + 1; });
        return { id: el.dataset.foldLine, text: el.textContent, inside, h: Math.round(r.height), undecided: el.dataset.foldUndecided !== undefined };
      }),
      fold: Object.fromEntries(shapes.filter((s) => s.meta.ask).map((s) => [s.id, s.meta.fold ?? null])),
    };
  });

  const shapeCount = () => p.evaluate(() => window.__pairedEditor.getCurrentPageShapes().length);
  const openAsks = (s, ts) => ts.filter((th) => !s.hidden[th.ask]).map((th) => ts.indexOf(th) + 1);

  // 1. Twelve answered, undecided threads.
  const threads = [];
  for (let i = 0; i < 12; i++) {
    const x = 120 + (i % 4) * 980, y = 80 + Math.floor(i / 4) * 520;
    threads.push(await thread(x, y, `Question ${i + 1}: which way?`, [`Way one for ${i + 1}`, `Way two for ${i + 1}`]));
    await p.evaluate(() => { window.__pairedEditor.selectNone(); });
  }
  await p.waitForTimeout(400);
  const view = () => p.evaluate(() => { window.__pairedEditor.setCamera({ x: 260, y: 40, z: 0.34 }); });
  await view();
  await p.waitForTimeout(400);
  let s = await state();
  const bounds = s.bounds, count = await shapeCount();
  await p.screenshot({ path: `${out}/1-twelve-unfinished.png` });
  check('the four most recently asked threads stay open', JSON.stringify(openAsks(s, threads)) === JSON.stringify([9, 10, 11, 12]), `open: ${openAsks(s, threads).join(', ')}`);
  check('the eight older ones fold to one line each', s.lines.length === 8 && s.lines.every((l) => l.undecided), `${s.lines.length} lines`);
  const l1 = s.lines.find((l) => l.id === threads[0].ask);
  check('a line says the question and that nothing is picked yet', Boolean(l1) && l1.text.includes('Question 1: which way?') && l1.text.includes('2 options, none picked yet'), l1?.text);
  check('the line\'s text stays inside it, on one line', s.lines.every((l) => l.inside && l.h <= 42));
  check('an open thread\'s answers stay in view', threads.slice(8).every((th) => th.answers.every((id) => !s.hidden[id])));

  // 2. Agents.
  const read = await command('read', {});
  const r = Object.fromEntries(read.objects.map((o) => [o.id, o]));
  check('read reports the eight as folded and undecided, with their answers',
    threads.slice(0, 8).every((th) => r[th.ask]?.folded === true && r[th.ask]?.undecided === true && th.answers.every((id) => r[id]?.folded === true && r[id]?.undecided === true)));
  check('read reports the four as open', threads.slice(8).every((th) => !r[th.ask]?.folded && !r[th.ask]?.undecided));
  check('an undecided fold has no pick', threads.slice(0, 8).every((th) => r[th.ask]?.pick === undefined));
  const overview = await command('overview', {});
  const o = Object.fromEntries(overview.objects.map((x) => [x.id, x]));
  check('overview reports the same', threads.every((th, i) => (i < 8) === (o[th.ask]?.folded === true && o[th.ask]?.undecided === true)));

  // 3. The person goes to an old thread.
  await p.evaluate((id) => window.paired.select([id]), threads[2].ask);
  await p.waitForTimeout(400);
  s = await state();
  check('a folded thread opens while the person is on it, and no other thread changes',
    JSON.stringify(openAsks(s, threads)) === JSON.stringify([3, 9, 10, 11, 12]) && s.lines.length === 7, `open: ${openAsks(s, threads).join(', ')}`);
  await p.screenshot({ path: `${out}/2-on-an-old-thread.png` });
  await p.evaluate(() => { window.__pairedEditor.selectNone(); });
  await p.waitForTimeout(400);
  s = await state();
  check('moving on folds it again', s.hidden[threads[2].ask] && s.lines.length === 8);

  // 4. A thirteenth question, still waiting for its answer.
  await p.evaluate(() => { window.__pairedEditor.setCamera({ x: 0, y: 0, z: 1 }); });
  const pending = await thread(220, 1640, 'Question 13: and this one?', [], false);
  await p.evaluate(() => { window.__pairedEditor.selectNone(); });
  await view();
  await p.waitForTimeout(400);
  s = await state();
  const all = [...threads, pending];
  check('an ask waiting for its answer stays open and is one of the four', JSON.stringify(openAsks(s, all)) === JSON.stringify([10, 11, 12, 13]) && s.lines.length === 9, `open: ${openAsks(s, all).join(', ')}`);
  const answered = await command('answer', { id: pending.ask, alternatives: ['Way one for 13', 'Way two for 13'] }, pending.sessionId);
  pending.answers = answered.answers.map((a) => a.id);
  await p.waitForTimeout(400);
  s = await state();
  check('once answered it stays open, the newest of the four', JSON.stringify(openAsks(s, all)) === JSON.stringify([10, 11, 12, 13]));

  // 5. Press a folded line.
  await p.locator(`[data-fold-line="${threads[0].ask}"]`).click();
  await p.waitForTimeout(300);
  await p.evaluate(() => { window.__pairedEditor.selectNone(); });
  await p.waitForTimeout(400);
  s = await state();
  check('pressing a folded line unfolds it for good, saved on the ask', !s.hidden[threads[0].ask] && s.fold[threads[0].ask] === 'open' && JSON.stringify(openAsks(s, all)) === JSON.stringify([1, 10, 11, 12, 13]), `open: ${openAsks(s, all).join(', ')}`);
  await p.screenshot({ path: `${out}/3-one-unfolded.png` });
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(400);
  s = await state();
  check('one undo folds it back', s.hidden[threads[0].ask] && s.fold[threads[0].ask] === null);
  await p.keyboard.press('Control+Shift+z');
  await p.waitForTimeout(400);
  s = await state();
  check('redo unfolds it again', !s.hidden[threads[0].ask] && s.fold[threads[0].ask] === 'open');

  // 6. Pick an answer on an open thread.
  await p.evaluate((id) => window.paired.select([id]), threads[10].answers[1]);
  await p.waitForTimeout(150);
  await p.keyboard.press('p');
  await p.waitForTimeout(200);
  await p.evaluate(() => { window.__pairedEditor.selectNone(); });
  await p.waitForTimeout(400);
  s = await state();
  const pickedLine = s.lines.find((l) => l.id === threads[10].ask);
  check('a picked thread folds to its pick', Boolean(pickedLine) && !pickedLine.undecided && pickedLine.text.includes('Way two for 11'), pickedLine?.text);
  check('and the most recent folded undecided thread comes back', JSON.stringify(openAsks(s, all)) === JSON.stringify([1, 9, 10, 12, 13]), `open: ${openAsks(s, all).join(', ')}`);
  check('nothing moved and nothing was deleted', JSON.stringify(Object.fromEntries(Object.keys(bounds).map((k) => [k, s.bounds[k]]))) === JSON.stringify(bounds) && (await shapeCount()) === count + 3, `${await shapeCount()} shapes, was ${count} + 3`);
  await p.screenshot({ path: `${out}/4-after-a-pick.png` });

  // 7. Reload.
  const beforeReload = JSON.stringify(openAsks(s, all));
  await p.waitForTimeout(1500);
  await open();
  await view();
  await p.waitForTimeout(400);
  s = await state();
  check('after a reload the same threads are open and folded', JSON.stringify(openAsks(s, all)) === beforeReload && s.lines.length === 8, `open: ${openAsks(s, all).join(', ')}`);
  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await ctx.close();
  await browser.close();
  server.kill();
  rmSync(boards, { recursive: true, force: true });
  rmSync(profile, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
