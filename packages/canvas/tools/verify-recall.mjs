// Browser check for P5, part 2: Check me on a settled thought, and its spaced return.
//
// Starts its own dev server with a throwaway board store, opens the canvas at 1440 x 900 and:
//   1. the first screen shows no recall line and no cover;
//   2. the person writes a thought and settles it (S): nothing comes back while they never
//      checked themselves on it; rough writing offers no Check me;
//   3. Check me (E) on the settled thought: a prompt asks why, the thought is covered (face
//      down), not hidden: an agent still reads it; explain → "Show me" uncovers it beside the
//      explanation to compare (predict/explain → reveal → compare);
//   4. it is scheduled to come back in a day; a day later (the due time moved back) one quiet
//      line at the board's edge asks to recall it; Later puts it off a day;
//   5. due again: Check me on the line opens the check on it; one undo takes it back;
//      committing schedules 3 days.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-recall.mjs <screenshot dir>
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
if (!out) throw new Error('Usage: node verify-recall.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.RECALL_PORT ?? 5214), ORIGIN = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const boards = mkdtempSync(join(tmpdir(), 'recall-boards-'));
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
const DAY = 24 * 60 * 60 * 1000;
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  await p.goto(`${ORIGIN}/canvas/`);
  await p.waitForFunction(() => window.paired?.read().objects.length >= 1, null, { timeout: 30000 });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/0-first-screen.png` });
  check('the first screen shows no recall line and no cover', (await p.locator('.recall-line, .check-cover').count()) === 0);
  const command = async (op, input) => {
    const sid = await p.evaluate(() => document.documentElement.dataset.pairedSession);
    const body = await post('/command', { requestId: randomUUID(), sessionId: sid, actor: 'Check agent', command: { op, input } });
    if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body).slice(0, 300)}`);
    return body.result;
  };
  const text = 'Charge per seat, with a floor of five seats';
  const card = await p.evaluate((text) => {
    const ed = window.__pairedEditor;
    ed.deleteShapes([...ed.getCurrentPageShapeIds()]);
    ed.setCamera({ x: 0, y: 0, z: 1 });
    ed.createShape({ type: 'card', x: 260, y: 240, props: { w: 300, tone: 'human', richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } } });
    return { id: ed.getCurrentPageShapes().find((s) => s.type === 'card').id };
  }, text);
  await p.evaluate((id) => window.paired.select([id]), card.id);
  await p.waitForTimeout(200);
  check('rough writing of the person\'s offers no Check me', (await p.getByRole('button', { name: /Check me/ }).count()) === 0);
  await p.keyboard.press('s');
  await p.waitForTimeout(300);
  const meta = () => p.evaluate((id) => window.__pairedEditor.getShape(id).meta, card.id);
  check('S settles it', (await meta()).settled === true);
  await p.evaluate(() => { window.__pairedEditor.selectNone(); });
  await p.waitForTimeout(200);
  check('a settled thought never checked does not come back', (await p.locator('.recall-line').count()) === 0 && !(await meta()).recall);

  // 3. Check me on the settled thought.
  await p.evaluate((id) => window.paired.select([id]), card.id);
  await p.waitForTimeout(200);
  check('the selection bar offers Check me on a settled thought', (await p.getByRole('button', { name: /Check me/ }).count()) === 1);
  await p.screenshot({ path: `${out}/1-settled-selected.png` });
  await p.keyboard.press('e');
  await p.waitForTimeout(500);
  const prompt = p.locator('[data-prompt]');
  const q = await prompt.locator('.learn-question').textContent().catch(() => '');
  check('E opens a check that asks why they settled on it', q.includes('what did you settle on here, and why?'), q);
  const cover = await p.evaluate((id) => {
    const ed = window.__pairedEditor, el = document.querySelector(`[data-check-cover="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect(), b = ed.getShapePageBounds(id);
    const a = ed.pageToScreen({ x: b.x, y: b.y }), z = ed.pageToScreen({ x: b.maxX, y: b.maxY });
    return { covers: r.left <= a.x + 1 && r.top <= a.y + 1 && r.right >= z.x - 1 && r.bottom >= z.y - 1, hidden: ed.isShapeHidden(id) };
  }, card.id);
  check('the thought is covered face down, not hidden', Boolean(cover?.covers) && cover.hidden === false, JSON.stringify(cover));
  const read = await command('read', { ids: [card.id] });
  check('an agent still reads it while it is covered', (read.objects[0]?.text ?? '').includes('floor of five'));
  check('the cursor is in the explanation box', await p.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'));
  await p.screenshot({ path: `${out}/2-check-open.png` });
  await p.keyboard.type('Per seat scales with the team; the floor covers small teams.');
  await prompt.getByRole('button', { name: 'Show me the answer' }).click();
  await p.waitForTimeout(400);
  const compare = await prompt.locator('.learn-compare').textContent().catch(() => '');
  check('Show me uncovers it beside the explanation, to compare', (await p.locator('.check-cover').count()) === 0 && compare.includes('Your thought is uncovered beside this'), compare);
  await p.screenshot({ path: `${out}/3-compare.png` });
  let m = await meta();
  const inDays = (due) => Math.round(((due - Date.now()) / DAY) * 10) / 10;
  check('it is scheduled to come back in a day', m.recall?.step === 0 && inDays(m.recall.due) === 1, JSON.stringify(m.recall));
  check('not due yet: no line', (await p.locator('.recall-line').count()) === 0);

  // 4. A day later (the due time moved back; the page's clock rechecks each minute, so reload).
  const dueNow = async () => {
    await p.evaluate((id) => {
      const ed = window.__pairedEditor, s = ed.getShape(id);
      ed.updateShape({ id, type: s.type, meta: { ...s.meta, recall: { ...s.meta.recall, due: Date.now() - 1000 } } });
    }, card.id);
    await p.waitForTimeout(300);
  };
  await dueNow();
  const line = p.locator('.recall-line');
  const lineText = await line.locator('.recall-text').textContent().catch(() => '');
  check('a day later one quiet line asks to recall it', (await line.count()) === 1 && lineText.includes('Charge per seat') && lineText.includes('checked yesterday'), lineText);
  const box = await line.boundingBox();
  check('the line sits at the board\'s bottom edge, inside the window', Boolean(box) && box.y + box.height <= 900 && box.y > 800 && box.x >= 0 && box.x + box.width <= 1440, JSON.stringify(box));
  check('it is not a modal', (await p.locator('[role=dialog], .modal-backdrop').count()) === 0);
  await p.screenshot({ path: `${out}/4-recall-line.png` });
  await line.getByRole('button', { name: 'Later' }).click();
  await p.waitForTimeout(300);
  m = await meta();
  check('Later puts it off a day at the same step', (await p.locator('.recall-line').count()) === 0 && m.recall.step === 0 && inDays(m.recall.due) === 1, JSON.stringify(m.recall));

  // 5. Due again: Check me on the line.
  await dueNow();
  await p.locator('.recall-line').getByRole('button', { name: 'Check me' }).click();
  await p.waitForTimeout(500);
  check('Check me on the line opens the check on that thought, covered', (await p.locator('[data-prompt]').count()) === 2 && (await p.locator(`[data-check-cover="${card.id}"]`).count()) === 1);
  check('the line waits while the check is open', (await p.locator('.recall-line').count()) === 0);
  const prompts = () => p.evaluate(() => window.__pairedEditor.getCurrentPageShapes().filter((s) => s.type === 'prompt').length);
  const before = await prompts();
  await p.evaluate(() => { window.__pairedEditor.undo(); });
  await p.waitForTimeout(300);
  const after = await prompts();
  check('one undo takes the check back', after === before - 1 && (await p.locator('.check-cover').count()) === 0, `${before} → ${after}`);
  await p.locator('.recall-line').getByRole('button', { name: 'Check me' }).click();
  await p.waitForTimeout(500);
  await p.keyboard.type('Seats grow with the team.');
  await p.locator('.learn-prompt.is-open').getByRole('button', { name: 'Show me the answer' }).click();
  await p.waitForTimeout(400);
  m = await meta();
  check('recalling it again schedules the next return in 3 days', m.recall?.step === 1 && inDays(m.recall.due) === 3, JSON.stringify(m.recall));
  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await browser.close();
  server.kill();
  rmSync(boards, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
