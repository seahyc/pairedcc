// Browser check for item 113 and its review: a card the person writes across a frame's edge.
//
// Starts its own dev server with a throwaway board store, opens the canvas at 1440 x 900 and:
//   1. the person writes a long card at the bottom of a frame (N, click, type, Esc): it is lifted
//      onto the page, nothing of it cut off, and it goes with the frame (`meta.within`);
//   2. undo, then redo: the card comes back as the person left it, not clipped;
//   3. a question written across the edge is sent when finished, and the frame it sat in is
//      still given as its context;
//   4. with ?prototype=context: a lifted card the person left out keeps its comment out of an
//      ask about the frame.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-frame-edge.mjs <screenshot dir>
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
if (!out) throw new Error('Usage: node verify-frame-edge.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.FRAME_EDGE_PORT ?? 5217), ORIGIN = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const boards = mkdtempSync(join(tmpdir(), 'frame-edge-boards-'));
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
  const open = async (path) => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
    await p.goto(`${ORIGIN}${path}`);
    await p.waitForFunction(() => window.paired?.read().objects.length >= 1, null, { timeout: 30000 });
    await p.waitForTimeout(1200);
    return p;
  };
  const errs = [];
  const p = await open('/canvas/');
  const frame = await p.evaluate(() => {
    const ed = window.__pairedEditor;
    ed.deleteShapes([...ed.getCurrentPageShapeIds()]);
    ed.setCamera({ x: 0, y: 0, z: 1 });
    const r = window.paired.create({ kind: 'frame', x: 200, y: 150, width: 520, height: 300, name: 'Pricing' });
    return typeof r === 'string' ? r : r.id;
  });
  const state = (id) => p.evaluate(([id, frame]) => {
    const e = window.__pairedEditor, s = e.getShape(id);
    return s ? { onPage: s.parentId === e.getCurrentPageId(), masked: Boolean(e.getShapeMask(id)), within: s.meta.within ?? null, inFrame: s.parentId === frame } : null;
  }, [id, frame]);
  /** The person writes a card by hand: N, click at a page point, type, Esc. */
  const write = async (x, y, text) => {
    const at = await p.evaluate(([x, y]) => window.__pairedEditor.pageToScreen({ x, y }), [x, y]);
    await p.keyboard.press('Escape');
    await p.keyboard.press('n');
    await p.mouse.click(at.x, at.y);
    await p.waitForFunction(() => document.activeElement?.closest?.('[contenteditable=true]'), null, { timeout: 3000 });
    await p.keyboard.type(text, { delay: 0 });
    await p.keyboard.press('Escape');
    await p.waitForTimeout(500);
    return p.evaluate(() => window.__pairedEditor.getCurrentPageShapes().filter((s) => s.type === 'card').at(-1).id);
  };

  // 1. Across the edge.
  const long = 'A long thought at the bottom of the frame that keeps going over several lines until it runs past the edge';
  const card = await write(460, 400, long);
  let s = await state(card);
  check('a card written across the frame\'s edge is lifted onto the page, nothing cut off', s?.onPage && !s.masked, JSON.stringify(s));
  check('it goes with the frame', s?.within === frame);
  await p.screenshot({ path: `${out}/1-written-across.png` });
  const inner = await write(460, 220, 'Short');
  const innerState = await state(inner);
  check('a card wholly inside the frame stays in it', innerState?.inFrame === true, JSON.stringify(innerState));

  // 2. Undo the writing until the card is gone, then redo as many steps.
  await p.evaluate(() => { window.__pairedEditor.selectNone(); });
  let undos = 0;
  while ((await state(card)) && undos < 8) {
    await p.evaluate(() => { window.__pairedEditor.undo(); });
    await p.waitForTimeout(150);
    undos++;
  }
  const gone = (await state(card)) === null;
  for (let i = 0; i < undos; i++) {
    await p.evaluate(() => { window.__pairedEditor.redo(); });
    await p.waitForTimeout(150);
  }
  await p.waitForTimeout(300);
  s = await state(card);
  check('after undo and redo the card is back as the person left it, not clipped', gone && s && s.onPage && !s.masked && s.within === frame, `gone after ${undos} undos: ${gone}; after redo: ${JSON.stringify(s)}`);

  // 3. A question written across the edge keeps its frame as context.
  const waiting = post('/asks/wait', { agent: 'Check agent', waitMs: 15000 });
  const q = await write(470, 400, 'Which of these pricing ideas would a five-person team actually pick first, and why?');
  const got = await waiting;
  const said = JSON.stringify(got.ask ?? {});
  s = await state(q);
  check('a question written across the edge is sent when finished', got.ask?.id === q, said.slice(0, 120));
  check('the frame it sat in is still given as its context', said.includes('Pricing'), said.slice(0, 200));
  check('and the question itself is not cut off', s?.onPage && !s.masked, JSON.stringify(s));
  await p.screenshot({ path: `${out}/2-question-across.png` });

  // 4. Leave out, with the context prototype.
  const c = await open('/canvas/?prototype=context');
  const ids = await c.evaluate(() => {
    const ed = window.__pairedEditor;
    ed.deleteShapes([...ed.getCurrentPageShapeIds()]);
    ed.setCamera({ x: 0, y: 0, z: 1 });
    const f = window.paired.create({ kind: 'frame', x: 200, y: 150, width: 520, height: 300, name: 'Pricing' });
    return { frame: typeof f === 'string' ? f : f.id };
  });
  const atC = await c.evaluate(() => window.__pairedEditor.pageToScreen({ x: 460, y: 400 }));
  await c.keyboard.press('n');
  await c.mouse.click(atC.x, atC.y);
  await c.waitForFunction(() => document.activeElement?.closest?.('[contenteditable=true]'), null, { timeout: 3000 });
  await c.keyboard.type('A private aside that runs on past the bottom edge of the frame for a few lines', { delay: 0 });
  await c.keyboard.press('Escape');
  await c.waitForTimeout(500);
  const aside = await c.evaluate(() => window.__pairedEditor.getCurrentPageShapes().filter((s) => s.type === 'card').at(-1).id);
  await c.evaluate((id) => window.paired.select([id]), aside);
  await c.keyboard.press('l');
  await c.waitForTimeout(200);
  await c.keyboard.press('c');
  await c.waitForTimeout(300);
  await c.keyboard.type('secret note on the aside', { delay: 0 });
  await c.keyboard.press('Escape');
  await c.waitForTimeout(400);
  const lifted = await c.evaluate(([id, f]) => { const e = window.__pairedEditor, s = e.getShape(id); return { within: s.meta.within === f, leftOut: s.meta.leftOut === true }; }, [aside, ids.frame]);
  await c.evaluate((id) => window.paired.select([id]), ids.frame);
  await c.waitForTimeout(200);
  const waitingC = post('/asks/wait', { agent: 'Check agent', waitMs: 15000 });
  await c.keyboard.press('Control+Enter');
  await c.waitForFunction(() => document.activeElement?.closest?.('[contenteditable=true]'), null, { timeout: 3000 });
  await c.keyboard.type('What is in here?', { delay: 0 });
  await c.keyboard.press('Escape');
  const gotC = await waitingC;
  const saidC = JSON.stringify(gotC.ask ?? {});
  check('a lifted card the person left out keeps its comment out of an ask about the frame', lifted.within && lifted.leftOut && gotC.ask && !saidC.includes('secret note') && !saidC.includes('private aside'), `${JSON.stringify(lifted)} ${saidC.slice(0, 160)}`);
  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await browser.close();
  server.kill();
  rmSync(boards, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
