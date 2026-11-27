// Browser check for P1, part 1: a finished thread folds to one line.
//
// Starts its own dev server with a throwaway board store, opens the canvas at 1440 x 900 and:
//   1. writes a question card, sends it (Ctrl+Enter), and a stand-in agent answers it over HTTP
//      with three options; nothing is folded yet;
//   2. the person picks option B (P): the thread stays open while they are on it, and folds to one
//      line (the question and the pick) when they move on; nothing moved;
//   3. an agent's read and overview report the thread as folded, and an ask written beside the
//      folded line is still given the picked answer;
//   4. pressing the line unfolds it (one undo step folds it back); Fold on its state line folds it;
//      the line is reachable by Tab-free keyboard activation (Enter on the focused line);
//   5. the fold survives a reload;
//   6. twelve finished threads: the board shows only the ones the person unfolded (three here).
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-fold.mjs <screenshot dir>
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
if (!out) throw new Error('Usage: node verify-fold.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.FOLD_PORT ?? 5211), ORIGIN = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const boards = mkdtempSync(join(tmpdir(), 'fold-boards-'));
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
const profile = mkdtempSync(join(tmpdir(), 'fold-profile-'));
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

  // 1. An answered ask: nothing is folded.
  const t = await thread(200, 160, 'How should we charge for teams?', ['Per seat, like everyone', 'A flat fee per workspace', 'By usage of boards']);
  let s = await state();
  check('an answered thread with no pick is not folded', !s.hidden[t.ask] && t.answers.every((id) => !s.hidden[id]) && s.lines.length === 0);
  const before = s.bounds;
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/1-before-pick.png` });

  // 2. Pick B with P: open while the person is on it, folded once they move on.
  await p.evaluate((id) => window.paired.select([id]), t.answers[1]);
  await p.waitForTimeout(150);
  await p.keyboard.press('p');
  await p.waitForTimeout(400);
  s = await state();
  check('just after the pick, the thread stays open under the person\'s hand', !s.hidden[t.ask] && !s.hidden[t.answers[1]] && s.lines.length === 0);
  await p.screenshot({ path: `${out}/2-picked-still-open.png` });
  await p.mouse.click(1100, 700);
  await p.waitForTimeout(400);
  s = await state();
  check('when they move on, the ask and its answers fold away', s.hidden[t.ask] && t.answers.every((id) => s.hidden[id]));
  const line = s.lines.find((l) => l.id === t.ask);
  check('one line shows the question and the picked answer', Boolean(line) && line.text.includes('How should we charge for teams?') && line.text.includes('B · A flat fee per workspace'), line?.text);
  check('the line\'s text stays inside it, on one line', Boolean(line?.inside) && line.h <= 42, line ? `inside ${line.inside}, ${line.h} px tall` : '');
  check('folding moved nothing', JSON.stringify(Object.fromEntries(Object.keys(before).map((k) => [k, s.bounds[k]]))) === JSON.stringify(before));
  await p.screenshot({ path: `${out}/3-folded.png` });

  // 3. Agents are told it is folded, and an ask beside it still gets the pick.
  const read = await command('read', {});
  const r = Object.fromEntries(read.objects.map((o) => [o.id, o]));
  check('read reports the ask and its answers as folded', r[t.ask]?.folded === true && t.answers.every((id) => r[id]?.folded === true));
  const overview = await command('overview', {});
  check('overview reports the folded thread', overview.objects.some((o) => o.id === t.ask && o.folded === true));
  const near = await p.evaluate(() => {
    const ed = window.__pairedEditor, ask = ed.getCurrentPageShapes().find((s) => s.meta.ask);
    const b = ed.getShapePageBounds(ask);
    const made = window.paired.create({ kind: 'note', x: b.x, y: b.y + 60, width: 300, text: 'Take the picked one further?' });
    return typeof made === 'string' ? made : made.id;
  });
  await p.evaluate((id) => window.paired.select([id]), near);
  await p.waitForTimeout(150);
  const waiting = post('/asks/wait', { agent: 'Check agent', waitMs: 10000 });
  await p.keyboard.press('Control+Enter');
  const follow = await waiting;
  const given = JSON.stringify(follow.ask ?? {});
  check('an ask written beside the folded line is still given the picked answer', given.includes('A flat fee per workspace'), given.slice(0, 160));
  await command('ask_status', { id: follow.ask.id, state: 'failed', error: 'not needed for this check' }, follow.sessionId).catch(() => {});
  await p.evaluate((id) => { window.__pairedEditor.deleteShapes([id]); }, near);
  await p.waitForTimeout(200);

  // 4. Press the line: unfolded for good; undo folds it back; Fold folds it again.
  await p.locator(`[data-fold-line="${t.ask}"]`).click();
  await p.waitForTimeout(400);
  s = await state();
  check('pressing the line unfolds the thread and saves the choice', !s.hidden[t.ask] && t.answers.every((id) => !s.hidden[id]) && s.fold[t.ask] === 'open');
  await p.mouse.click(1100, 700);
  await p.waitForTimeout(300);
  s = await state();
  check('an unfolded thread stays open after the person moves on', !s.hidden[t.ask] && s.lines.length === 0);
  check('its state line offers Fold', (await p.locator(`[data-fold="${t.ask}"]`).count()) === 1);
  await p.screenshot({ path: `${out}/4-unfolded.png` });
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(400);
  s = await state();
  check('one undo folds it back', s.hidden[t.ask] && s.lines.length === 1);
  await p.locator(`[data-fold-line="${t.ask}"]`).focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  s = await state();
  check('Enter on the focused line unfolds it', !s.hidden[t.ask] && s.fold[t.ask] === 'open');
  await p.locator(`[data-fold="${t.ask}"]`).click();
  await p.waitForTimeout(400);
  s = await state();
  check('Fold folds it to one line again', s.hidden[t.ask] && s.lines.length === 1 && s.fold[t.ask] === null);

  // 5. Saved with the board.
  await p.waitForTimeout(1500);
  await open();
  s = await state();
  check('still folded after a reload', s.hidden[t.ask] && s.lines.some((l) => l.id === t.ask));

  // 5b. From the keyboard: Tab lands on the folded thread's question and opens it while the
  // person is on it; the next Tab reaches its answers; moving on folds it again.
  await p.evaluate(() => { window.__pairedEditor.selectNone(); document.querySelector('.tl-container')?.focus(); });
  await p.locator('.tl-container').focus();
  await p.keyboard.press('Tab');
  await p.waitForTimeout(400);
  s = await state();
  const sel1 = await p.evaluate(() => window.__pairedEditor.getSelectedShapeIds());
  check('Tab lands on the folded thread and opens it while the person is on it', sel1[0] === t.ask && !s.hidden[t.ask] && t.answers.every((id) => !s.hidden[id]), JSON.stringify(sel1));
  await p.keyboard.press('Tab');
  await p.waitForTimeout(300);
  const sel2 = await p.evaluate(() => window.__pairedEditor.getSelectedShapeIds());
  check('the next Tab reaches its answers', t.answers.includes(sel2[0]), JSON.stringify(sel2));
  await p.keyboard.press('Escape');
  await p.evaluate(() => { window.__pairedEditor.selectNone(); });
  await p.waitForTimeout(300);
  s = await state();
  check('moving on folds it again', s.hidden[t.ask] && s.lines.some((l) => l.id === t.ask));

  // 5c. Something else between the question and its answer in reading order: Tab still visits
  // the answers before moving on (the thread would fold away otherwise).
  const between = await p.evaluate((askId) => {
    const ed = window.__pairedEditor, b = ed.getShapePageBounds(askId);
    const r = window.paired.create({ kind: 'note', x: b.maxX + 40, y: b.y + 10, width: 200, text: 'A note to its right' });
    ed.selectNone();
    return typeof r === 'string' ? r : r.id;
  }, t.ask);
  await p.waitForTimeout(300);
  await p.evaluate((id) => { window.paired.select([id]); }, t.ask);
  await p.waitForTimeout(200);
  await p.locator('.tl-container').focus();
  const visited = [];
  for (let i = 0; i < 4; i++) {
    await p.keyboard.press('Tab');
    await p.waitForTimeout(250);
    visited.push((await p.evaluate(() => window.__pairedEditor.getSelectedShapeIds()))[0]);
  }
  const firstAnswers = visited.slice(0, 3);
  check('with a note between the question and its answers, Tab visits every answer first', t.answers.every((id) => firstAnswers.includes(id)) && visited[3] === between, JSON.stringify(visited.map((v) => (v === between ? 'note' : t.answers.indexOf(v)))));
  await p.evaluate((id) => { window.__pairedEditor.deleteShapes([id]); window.__pairedEditor.selectNone(); }, between);
  await p.waitForTimeout(300);

  // 6. Twelve finished threads; the person unfolds three.
  await p.evaluate(() => { const ed = window.__pairedEditor; ed.deleteShapes([...ed.getCurrentPageShapeIds()]); ed.setCamera({ x: 0, y: 0, z: 1 }); });
  const threads = [];
  for (let i = 0; i < 12; i++) {
    const x = 400 + (i % 3) * 1250, y = 80 + Math.floor(i / 3) * 420;
    threads.push(await thread(x, y, `Question ${i + 1}: which way?`, [`Way one for ${i + 1}`, `Way two for ${i + 1}`]));
  }
  for (const th of threads) {
    await p.evaluate((id) => window.paired.select([id]), th.answers[0]);
    await p.keyboard.press('p');
    await p.waitForTimeout(80);
  }
  await p.evaluate(() => { window.__pairedEditor.selectNone(); });
  await p.waitForTimeout(300);
  // The whole board in view: folded threads are out of view, so frame it by hand.
  await p.evaluate(() => { window.__pairedEditor.setCamera({ x: 0, y: 0, z: 0.36 }); });
  await p.waitForTimeout(300);
  for (const th of threads.slice(0, 3)) {
    await p.locator(`[data-fold-line="${th.ask}"]`).click();
    await p.waitForTimeout(200);
  }
  await p.evaluate(() => { window.__pairedEditor.selectNone(); });
  await p.waitForTimeout(400);
  s = await state();
  const unfolded = threads.filter((th) => !s.hidden[th.ask]).length;
  check('twelve finished threads show only the three the person unfolded', unfolded === 3 && s.lines.length === 9, `${unfolded} unfolded, ${s.lines.length} folded lines`);
  await p.screenshot({ path: `${out}/5-twelve-threads.png` });
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
