// Browser check for P1, part 2: focus (F).
//
// Starts its own dev server with a throwaway board store, opens the canvas at 1440 x 900 and:
//   1. a frame holding two cards, with a card outside it: select the frame, press F; one clear
//      rectangle covers the frame, the outside card is dimmed; Esc brings everything back;
//   2. a thread (a question and three answers from a stand-in agent): select one answer, press F;
//      the rectangle covers the question and every answer; Esc;
//   3. a plain card selected: F is the Frame tool, as before, and nothing dims;
//   4. focus changes nothing on the board: no revision moves and there is nothing to undo;
//   5. the first screen shows no focus.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-focus.mjs <screenshot dir>
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
if (!out) throw new Error('Usage: node verify-focus.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.FOCUS_PORT ?? 5212), ORIGIN = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const boards = mkdtempSync(join(tmpdir(), 'focus-boards-'));
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
  await p.screenshot({ path: `${out}/0-first-screen.png` });
  check('the first screen shows no focus', (await p.locator('[data-focus-hole]').count()) === 0);
  await p.evaluate(() => { const ed = window.__pairedEditor; ed.deleteShapes([...ed.getCurrentPageShapeIds()]); ed.setCamera({ x: 0, y: 0, z: 1 }); });

  const command = async (op, input, sessionId) => {
    const sid = sessionId ?? await p.evaluate(() => document.documentElement.dataset.pairedSession);
    const body = await post('/command', { requestId: randomUUID(), sessionId: sid, actor: 'Check agent', command: { op, input } });
    if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body).slice(0, 300)}`);
    return body.result;
  };
  const ids = await p.evaluate(() => {
    const ed = window.__pairedEditor, bridge = window.paired;
    const id = (r) => (typeof r === 'string' ? r : r.id);
    const frame = id(bridge.create({ kind: 'frame', x: 160, y: 120, width: 520, height: 300, name: 'Pricing' }));
    const inA = id(bridge.create({ kind: 'note', x: 190, y: 170, width: 200, text: 'Per seat' }));
    const inB = id(bridge.create({ kind: 'note', x: 430, y: 170, width: 200, text: 'Flat fee' }));
    const out = id(bridge.create({ kind: 'note', x: 900, y: 160, width: 260, text: 'Something else entirely' }));
    // The two cards belong to the frame.
    ed.reparentShapes([inA, inB], frame);
    return { frame, inA, inB, out };
  });
  const screenRect = (id) => p.evaluate((id) => {
    const ed = window.__pairedEditor, b = ed.getShapePageBounds(id);
    const a = ed.pageToScreen({ x: b.x, y: b.y }), z = ed.pageToScreen({ x: b.maxX, y: b.maxY });
    return { x: a.x, y: a.y, r: z.x, b: z.y };
  }, id);
  const hole = async () => {
    const el = p.locator('[data-focus-hole]');
    if (!(await el.count())) return null;
    const r = await el.boundingBox();
    return { x: r.x, y: r.y, r: r.x + r.width, b: r.y + r.height };
  };
  const contains = (h, r) => h && h.x <= r.x + 1 && h.y <= r.y + 1 && h.r >= r.r - 1 && h.b >= r.b - 1;
  const outside = (h, r) => h && (r.x >= h.r || r.r <= h.x || r.y >= h.b || r.b <= h.y);
  /**
   * How dark the object's ink is (0..255): the mean of the darkest tenth of its pixels, from a PNG
   * screenshot of its rectangle. Dimming fades the ink, whatever colour the card itself is (a pale
   * pink card barely changes at its middle, its writing does).
   */
  const shade = async (r) => {
    const buf = await p.screenshot({ clip: { x: r.x + 2, y: r.y + 2, width: Math.max(4, r.r - r.x - 4), height: Math.max(4, r.b - r.y - 4) } });
    return p.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const v = [];
      for (let i = 0; i < d.length; i += 4) v.push((d[i] + d[i + 1] + d[i + 2]) / 3);
      v.sort((a, b) => a - b);
      const dark = v.slice(0, Math.max(1, Math.floor(v.length / 10)));
      return dark.reduce((a, b) => a + b, 0) / dark.length;
    }, buf.toString('base64'));
  };
  const revisions = async () => JSON.stringify((await command('read', {})).objects.map((o) => [o.id, o.revision]));
  await p.waitForTimeout(300);
  const outRect = await screenRect(ids.out);
  const brightBefore = await shade(outRect);
  await p.screenshot({ path: `${out}/1-before-focus.png` });
  const revBefore = await revisions();

  // 1. A frame.
  await p.evaluate((id) => window.paired.select([id]), ids.frame);
  await p.waitForTimeout(150);
  await p.keyboard.press('f');
  await p.waitForTimeout(400);
  let h = await hole();
  check('F on a selected frame draws one clear rectangle around it', contains(h, await screenRect(ids.frame)), JSON.stringify(h));
  check('the card outside the frame is outside the rectangle', outside(h, outRect));
  const brightAfter = await shade(outRect);
  check('the card outside is dimmed', Math.abs(brightAfter - brightBefore) > 20, `${brightBefore.toFixed(0)} → ${brightAfter.toFixed(0)}`);
  check('F did not switch to the Frame tool', (await p.evaluate(() => window.__pairedEditor.getCurrentToolId())) === 'select');
  await p.screenshot({ path: `${out}/2-focus-frame.png` });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  check('Esc brings everything back', (await hole()) === null && Math.abs((await shade(outRect)) - brightBefore) < 3);

  // 2. A thread.
  const qid = await p.evaluate(() => { const r = window.paired.create({ kind: 'note', x: 160, y: 520, width: 300, text: 'Which should we try first?' }); return typeof r === 'string' ? r : r.id; });
  await p.evaluate((id) => window.paired.select([id]), qid);
  await p.waitForTimeout(150);
  const waiting = post('/asks/wait', { agent: 'Check agent', waitMs: 10000 });
  await p.keyboard.press('Control+Enter');
  const got = await waiting;
  const answered = await command('answer', { id: got.ask.id, alternatives: ['Per seat first', 'Flat fee first', 'Ask five teams'] }, got.sessionId);
  const answers = answered.answers.map((a) => a.id);
  await p.waitForTimeout(400);
  await p.evaluate(() => { window.__pairedEditor.setCamera({ x: 0, y: -250, z: 0.8 }); });
  await p.evaluate((id) => window.paired.select([id]), answers[1]);
  await p.waitForTimeout(150);
  await p.keyboard.press('f');
  await p.waitForTimeout(400);
  h = await hole();
  const inThread = await Promise.all([got.ask.id, ...answers].map(screenRect));
  check('F on an answer focuses its whole thread: the question and every answer', inThread.every((r) => contains(h, r)), JSON.stringify(h));
  check('the frame is outside the thread\'s rectangle', outside(h, await screenRect(ids.frame)));
  await p.screenshot({ path: `${out}/3-focus-thread.png` });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  check('Esc ends the thread focus', (await hole()) === null);

  // 3. A plain card: F is the Frame tool.
  await p.evaluate((id) => window.paired.select([id]), ids.out);
  await p.waitForTimeout(150);
  await p.keyboard.press('f');
  await p.waitForTimeout(300);
  check('with a plain card selected, F is the Frame tool as before', (await hole()) === null && (await p.evaluate(() => window.__pairedEditor.getCurrentToolId())) === 'frame');
  await p.keyboard.press('Escape');
  await p.keyboard.press('v');

  // 4. Focus is a way of looking: nothing on the board changed and there is nothing new to undo.
  await p.evaluate((id) => window.paired.select([id]), ids.frame);
  await p.waitForTimeout(200);
  const undoMark = await p.evaluate(() => window.__pairedEditor.history.getNumUndos());
  await p.keyboard.press('f');
  await p.waitForTimeout(200);
  const undoAfter = await p.evaluate(() => window.__pairedEditor.history.getNumUndos());
  check('focusing adds nothing to undo', undoMark === undoAfter && (await hole()) !== null, `${undoMark} → ${undoAfter}`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  const before = JSON.parse(revBefore), after = Object.fromEntries(JSON.parse(await revisions()));
  check('focus moved no revision', before.every(([id, rev]) => after[id] === rev));

  // 5. The thread in focus is deleted: focus ends, and undoing the delete does not bring it back.
  await p.evaluate((id) => window.paired.select([id]), qid);
  await p.waitForTimeout(150);
  await p.keyboard.press('f');
  await p.waitForTimeout(300);
  const focusedBeforeDelete = (await hole()) !== null;
  await p.evaluate((id) => { window.__pairedEditor.deleteShapes([id]); }, qid);
  await p.waitForTimeout(300);
  const goneAfterDelete = (await hole()) === null;
  await p.evaluate(() => { window.__pairedEditor.undo(); });
  await p.waitForTimeout(300);
  check('deleting what is in focus ends the focus; undo does not bring it back', focusedBeforeDelete && goneAfterDelete && (await hole()) === null);
  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await browser.close();
  server.kill();
  rmSync(boards, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
