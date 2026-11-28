// Browser check for item 144 (finding 1, working memory holds about four things; P1's "a board
// with 12 threads shows at most 4 unfolded by the person's choice"): at most four undecided
// threads open on a page.
//
// Starts its own dev server with a throwaway board store, opens the canvas at 1440 x 900 and:
//   1. the first screen has no fold line;
//   2. the person writes and sends twelve questions; a stand-in agent answers each with options and
//      nothing is picked: the four most recently asked stay open, the eight older ones are one line
//      each that says nothing was picked yet; nothing moved and nothing was deleted;
//   3. an agent's read and overview give the folded ones `folded` and `undecided`, with no pick;
//   4. a question still waiting for its answer is never folded and does not count; once answered,
//      the oldest open undecided thread folds;
//   5. picking an answer in an open thread finishes it (it folds as before) and the most recent
//      folded undecided thread comes back, so four undecided threads stay open;
//   6. pressing a folded line opens it and keeps it open (the person's choice wins); one undo folds
//      it back;
//   7. a reload shows the same.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-open-threads.mjs <screenshot dir>
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
if (!out) throw new Error('Usage: node verify-open-threads.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.OPEN_THREADS_PORT ?? 5232), ORIGIN = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const boards = mkdtempSync(join(tmpdir(), 'open-threads-boards-'));
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
const profile = mkdtempSync(join(tmpdir(), 'open-threads-profile-'));
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
  const thread = async (x, y, question, options) => {
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
        return { id: el.dataset.foldLine, text: el.textContent, inside, h: Math.round(r.height) };
      }),
      fold: Object.fromEntries(shapes.filter((s) => s.meta.ask).map((s) => [s.id, s.meta.fold ?? null])),
    };
  });

  const sendOnly = async (x, y, question) => {
    const id = await p.evaluate(([x, y, question]) => {
      const made = window.paired.create({ kind: 'note', x, y, width: 260, text: question });
      return typeof made === 'string' ? made : made.id;
    }, [x, y, question]);
    await p.evaluate((id) => window.paired.select([id]), id);
    await p.waitForTimeout(150);
    const waiting = post('/asks/wait', { agent: 'Check agent', waitMs: 10000 });
    await p.keyboard.press('Control+Enter');
    const got = await waiting;
    if (!got.ask) throw new Error(`no ask arrived for ${question}`);
    return got;
  };
  const openAsks = (s, list) => list.filter((th) => !s.hidden[th.ask]);
  const view = async () => { await p.evaluate(() => { const ed = window.__pairedEditor; ed.selectNone(); ed.setCamera({ x: 40, y: 20, z: 0.42 }); }); await p.waitForTimeout(400); };

  // 2. Twelve undecided threads, asked one after another, laid out four to a row.
  const topics = ['pricing', 'onboarding', 'the launch date', 'hiring', 'the name', 'support hours', 'the free tier', 'docs', 'the roadmap', 'partners', 'the beta list', 'metrics'];
  const threads = [];
  for (let i = 0; i < 12; i++) {
    const x = 40 + (i % 4) * 820, y = 40 + Math.floor(i / 4) * 640;
    threads.push(await thread(x, y, `What should we do about ${topics[i]}?`, [`Keep ${topics[i]} as it is`, `Change ${topics[i]} now`, `Ask users about ${topics[i]}`]));
    await p.waitForTimeout(60);
  }
  const all = (await state()).bounds;
  await view();
  let s = await state();
  const open1 = openAsks(s, threads).map((th) => threads.indexOf(th));
  check('twelve undecided threads: only the four most recently asked are open', JSON.stringify(open1) === JSON.stringify([8, 9, 10, 11]), `open: ${open1.join(', ')}`);
  check('their answers are open with them, the older answers are out of view', threads.every((th, i) => th.answers.every((id) => s.hidden[id] === (i < 8))));
  check('eight folded lines, each saying nothing was picked yet, text inside the line', s.lines.length === 8 && s.lines.every((l) => /none picked yet/.test(l.text) && !/settled|✓/.test(l.text) && l.inside), JSON.stringify(s.lines.slice(0, 2)));
  check('nothing moved and nothing was deleted', Object.keys(all).every((id) => JSON.stringify(s.bounds[id]) === JSON.stringify(all[id])) && Object.keys(s.bounds).length === Object.keys(all).length);
  check('the rule saves no choice on the asks', Object.values(s.fold).every((f) => f === null));
  await p.screenshot({ path: `${out}/1-twelve-undecided.png` });

  // 3. An agent is told which are folded and that they are undecided.
  const read = await command('read', { ids: [threads[0].ask, threads[11].ask] });
  const r0 = read.objects.find((o) => o.id === threads[0].ask), r11 = read.objects.find((o) => o.id === threads[11].ask);
  check('read: an old one is folded and undecided, with no pick', r0?.folded === true && r0?.undecided === true && !r0?.pick, JSON.stringify({ folded: r0?.folded, undecided: r0?.undecided }));
  check('read: an open one is neither', !r11?.folded && !r11?.undecided);
  const ov = await command('overview', {});
  const o0 = ov.objects.find((o) => o.id === threads[0].ask);
  check('overview: the same', o0?.folded === true && o0?.undecided === true);

  // 4. A question still waiting never folds and does not count; answered, the oldest open folds.
  const got = await sendOnly(40, 40 + 3 * 640, 'What should we do about the office?');
  await view();
  s = await state();
  check('while a question waits, it is shown and the four open threads stay open', !s.hidden[got.ask.id] && JSON.stringify(openAsks(s, threads).map((th) => threads.indexOf(th))) === JSON.stringify([8, 9, 10, 11]));
  const answered = await command('answer', { id: got.ask.id, alternatives: ['Keep the office', 'Go remote'] }, got.sessionId);
  threads.push({ ask: got.ask.id, answers: answered.answers.map((a) => a.id) });
  await view();
  s = await state();
  const open2 = openAsks(s, threads).map((th) => threads.indexOf(th));
  check('once it is answered, the oldest open undecided thread folds', JSON.stringify(open2) === JSON.stringify([9, 10, 11, 12]), `open: ${open2.join(', ')}`);

  // 5. Pick an answer in an open thread: it is finished and folds as before, and the most recent
  // folded undecided thread comes back.
  await p.evaluate((id) => window.paired.select([id]), threads[10].answers[1]);
  await p.waitForTimeout(150);
  await p.keyboard.press('p');
  await p.waitForTimeout(300);
  await view();
  s = await state();
  const open3 = openAsks(s, threads).map((th) => threads.indexOf(th));
  check('a picked thread folds and the most recent undecided one comes back: four undecided open', JSON.stringify(open3) === JSON.stringify([8, 9, 11, 12]), `open: ${open3.join(', ')}`);
  const line10 = s.lines.find((l) => l.id === threads[10].ask);
  check('the picked thread\'s line names its pick', /Change the beta list now/.test(line10?.text ?? ''), line10?.text);
  await p.screenshot({ path: `${out}/2-after-pick.png` });

  // 6. The person opens the oldest: it stays open (their choice); one undo folds it back.
  await p.locator(`[data-fold-line="${threads[0].ask}"]`).click();
  await p.waitForTimeout(300);
  await view();
  s = await state();
  check('pressing a folded line opens it and it stays open', !s.hidden[threads[0].ask] && s.fold[threads[0].ask] === 'open' && openAsks(s, threads).length === 5);
  await p.keyboard.press('Control+z');
  await view();
  s = await state();
  check('one undo folds it back', s.hidden[threads[0].ask] && s.fold[threads[0].ask] === null);
  await p.locator(`[data-fold-line="${threads[0].ask}"]`).click();
  await p.waitForTimeout(1500);

  // 7. Reload.
  await open();
  await view();
  s = await state();
  const open4 = openAsks(s, threads).map((th) => threads.indexOf(th));
  check('after a reload, the same threads are open', JSON.stringify(open4) === JSON.stringify([0, 8, 9, 11, 12]), `open: ${open4.join(', ')}`);
  await p.screenshot({ path: `${out}/3-after-reload.png` });
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
