// Browser check: an answer lands where the person can see all of it.
//
// Starts its own dev server of this checkout with an empty board store. At 1440 x 900 and
// 390 x 844 the person writes a question on a card and sends it, and an agent answers over HTTP:
// four options must land wholly inside the window without the zoom changing, options must not
// overlap, a one-card answer must land in view too, and an answer that arrives while the
// person is typing elsewhere must not move their view.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-answer-view.mjs <screenshot dir>
//
// Playwright is not a dependency of this repository; it is loaded from the directory you run
// this in. Exits non-zero if any check fails.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');

const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-answer-view.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5195;
const ORIGIN = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const boards = mkdtempSync(join(tmpdir(), 'answer-view-boards-'));
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
let n = 0;

/**
 * The person writes `text` at a screen point and asks it; returns the waiting agent's ask. The card
 * is the question: Ctrl+Enter while writing sends the card itself (there is no question box).
 */
async function ask(p, x, y, text) {
  await p.mouse.dblclick(x, y);
  await p.waitForTimeout(300);
  await p.keyboard.type(text, { delay: 0 });
  const waiting = post('/asks/wait', { agent: 'Check agent', waitMs: 10000 });
  await p.keyboard.press('Control+Enter');
  const got = await waiting;
  if (!got.ask) throw new Error('no ask arrived');
  if (got.ask.question !== text) throw new Error(`the card was not sent as the ask: ${JSON.stringify(got.ask.question)}`);
  await p.waitForTimeout(400);
  return got;
}
const answer = ({ sessionId, ask: a }, input) =>
  post('/command', { requestId: `answer-view-${n++}-${Date.now()}`, sessionId, actor: 'Check agent', command: { op: 'answer', input: { id: a.id, ...input } } });

/** Screen boxes of an ask's answer cards, and the camera. */
const answers = (p, askId) => p.evaluate((id) => {
  const ed = window.__pairedEditor;
  const cards = ed.getCurrentPageShapes().filter((s) => s.meta.replyTo === id).map((s) => {
    const b = ed.getShapePageBounds(s), a = ed.pageToScreen({ x: b.x, y: b.y }), z = ed.pageToScreen({ x: b.maxX, y: b.maxY });
    return { name: s.meta.name, left: Math.round(a.x), top: Math.round(a.y), right: Math.round(z.x), bottom: Math.round(z.y) };
  });
  return { cards, camera: ed.getCamera(), vw: innerWidth, vh: innerHeight };
}, askId);
const allIn = ({ cards, vw, vh }) => cards.length > 0 && cards.every((c) => c.left >= 0 && c.right <= vw && c.top >= 44 && c.bottom <= vh);
const overlap = ({ cards }) => cards.some((a, i) => cards.some((b, j) => j > i && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom));
const describe = ({ cards, vw, vh }) => cards.map((c) => `${c.name} ${c.left}–${c.right}×${c.top}–${c.bottom}`).join(', ') + ` (window ${vw}×${vh})`;

const browser = await chromium.launch();
try {
  for (const [vw, vh] of [[1440, 900], [390, 844]]) {
    const tag = `${vw}px`, phone = vw < 500;
    const p = await browser.newPage({ viewport: { width: vw, height: vh } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
    await p.goto(`${ORIGIN}/canvas/`);
    await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
    await p.waitForTimeout(800);
    await p.evaluate(() => { const ed = window.__pairedEditor; ed.deleteShapes([...ed.getCurrentPageShapeIds()]); ed.setCamera({ x: 0, y: 0, z: 1 }); });

    // 1. Four options, asked from the middle of the window.
    const first = await ask(p, phone ? 110 : Math.round(vw * 0.45), Math.round(vh * 0.45), 'Charge per seat or per workspace?');
    const zoom = (await answers(p, first.ask.id)).camera.z;
    const r1 = await answer(first, { alternatives: ['Per seat: grows with the team', 'Per workspace: one flat price, simple to explain', 'Hybrid: a base fee plus seats over ten', 'Usage: charge for boards made each month'] });
    check(`${tag}: the agent's four options were placed`, r1.ok === true, r1.ok ? '' : String(r1.error).slice(0, 120));
    await p.waitForTimeout(900);
    const a1 = await answers(p, first.ask.id);
    check(`${tag}: all four options land inside the window`, allIn(a1), describe(a1));
    check(`${tag}: the options do not overlap`, !overlap(a1));
    check(`${tag}: the zoom is left as the person set it`, a1.camera.z === zoom, `${zoom} → ${a1.camera.z}`);
    await p.screenshot({ path: `${out}/${tag}-1-four-options.png` });

    // 2. A one-card answer, asked from near the bottom right of an empty stretch of board
    // (on a phone the four options fill the screen, so a double-click would land on one).
    await p.evaluate(() => { const ed = window.__pairedEditor; ed.selectNone(); const c = ed.getCamera(); ed.setCamera({ ...c, y: c.y - 1500 }); });
    await p.waitForTimeout(200);
    const second = await ask(p, phone ? 200 : vw - 420, vh - 150, 'What would a team of three pay?');
    await answer(second, { text: 'About thirty dollars a month at ten a seat. A team that grows to twelve pays four times that, which is the case to test first.' });
    await p.waitForTimeout(900);
    const a2 = await answers(p, second.ask.id);
    check(`${tag}: a one-card answer lands inside the window`, allIn(a2), describe(a2));
    await p.screenshot({ path: `${out}/${tag}-2-one-answer.png` });

    // 3. While the person is typing elsewhere, an answer must not move their view.
    await p.evaluate(() => { window.__pairedEditor.selectNone(); });
    const third = await ask(p, phone ? 120 : 300, 160, 'Who pays: the team or the company?');
    await p.evaluate(() => { const ed = window.__pairedEditor; ed.selectNone(); ed.setCamera({ ...ed.getCamera(), y: ed.getCamera().y - 900 }); });
    await p.waitForTimeout(300);
    await p.mouse.dblclick(phone ? 150 : 700, Math.round(vh * 0.5));
    await p.waitForTimeout(300);
    await p.keyboard.type('Meanwhile, a note of my own', { delay: 0 });
    const before = await p.evaluate(() => window.__pairedEditor.getCamera());
    await answer(third, { text: 'The team, at first: whoever made the board.' });
    await p.waitForTimeout(900);
    const after = await p.evaluate(() => ({ camera: window.__pairedEditor.getCamera(), editing: Boolean(window.__pairedEditor.getEditingShapeId()) }));
    check(`${tag}: an answer arriving while the person types elsewhere leaves the view alone`, after.camera.x === before.x && after.camera.y === before.y && after.camera.z === before.z && after.editing, JSON.stringify({ before, after: after.camera, editing: after.editing }));
    await p.keyboard.press('Escape');
    check(`${tag}: no page errors`, errs.length === 0, errs.join(' | '));
    await p.close();
  }
} finally {
  await browser.close();
  server.kill();
  rmSync(boards, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
