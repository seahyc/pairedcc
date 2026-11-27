// Browser check: on a touch screen the canvas says tap, not a key.
//
// Starts its own dev server of this checkout with an empty board store and opens a fresh board
// as an Android phone (touch, no hover) and as a desktop browser. On the phone: the first board
// says to tap Ask and names no key, double-tap and the Write tool both start a card as the
// caption says, the writing hint is a button that asks (the card is the question: tapping it
// sends the card being written; there is no ask box), and the selection bar shows no key caps.
// On the desktop the hints and key caps are as before.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-touch.mjs <screenshot dir>
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
if (!out) throw new Error('Usage: node verify-touch.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

async function devServer(port) {
  const boards = mkdtempSync(join(tmpdir(), 'touch-boards-'));
  const child = spawn(process.execPath, [join(pkg, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], {
    cwd: pkg, env: { ...process.env, PAIRED_BOARDS_DIR: boards }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dev server did not start')), 30000);
    child.stdout.on('data', (d) => { if (/Local:/.test(String(d))) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => reject(new Error(`dev server exited ${code}`)));
  });
  return { url: `http://localhost:${port}/canvas/`, stop: () => { child.kill(); rmSync(boards, { recursive: true, force: true }); } };
}
const keyNames = /[⌘⇧⌫]|Ctrl\+?\s?↵|press N|\([PXC]\)/;
const cards = (p) => p.evaluate(() => window.paired.read().objects.filter((o) => o.type === 'card').length);
const editing = (p) => p.evaluate(() => Boolean(window.__pairedEditor.getEditingShapeId()));
const finish = async (p) => { await p.evaluate(() => { const ed = window.__pairedEditor; ed.complete(); ed.setCurrentTool('select'); ed.selectNone(); }); await p.waitForTimeout(200); };

const browser = await chromium.launch();
let port = 5197;
const phone = {
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
};
const desktop = { viewport: { width: 1440, height: 900 } };
for (const [tag, options] of [['phone', phone], ['desktop', desktop]]) {
  const server = await devServer(port++);
  try {
    const ctx = await browser.newContext(options);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
    await p.goto(server.url);
    await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
    await p.waitForTimeout(1000);
    const touch = tag === 'phone';
    const board = await p.evaluate(() => window.paired.read().objects.filter((o) => o.type === 'card').map((o) => o.text).join(' | '));
    await p.screenshot({ path: `${out}/${tag}-1-first-board.png` });
    if (touch) {
      check('phone: the first board says to tap Ask and names no key', /tap ✦ Ask/.test(board) && !keyNames.test(board), board.slice(0, 160));
      // Double-tap the empty board, as the caption says.
      const before = await cards(p);
      const spot = { x: 300, y: 700 };
      await p.touchscreen.tap(spot.x, spot.y);
      await p.waitForTimeout(60);
      await p.touchscreen.tap(spot.x, spot.y);
      await p.waitForTimeout(500);
      check('phone: double-tap the board starts a card', (await cards(p)) === before + 1 && (await editing(p)));
      await finish(p);
      // Tap Write, then the board.
      const n = await cards(p);
      await p.locator('.tool-strip .tool-button', { hasText: 'Write' }).tap();
      await p.waitForTimeout(200);
      await p.touchscreen.tap(250, 560);
      await p.waitForTimeout(500);
      check('phone: tap Write, then the board, starts a card', (await cards(p)) === n + 1);
      if (!(await editing(p))) {
        const id = await p.evaluate(() => window.paired.read().objects.filter((o) => o.type === 'card').at(-1).id);
        await p.evaluate((i) => { window.__pairedEditor.setEditingShape(i); }, id);
      }
      await p.waitForTimeout(300);
      await p.keyboard.type('Charge per seat', { delay: 0 });
      await p.waitForTimeout(400);
      const hint = p.locator('.selection-bar.hint');
      const hintText = (await hint.innerText().catch(() => '')).replace(/\s+/g, ' ');
      check('phone: while writing, the hint offers Ask and names no key', /Ask/.test(hintText) && !keyNames.test(hintText) && !/Esc/.test(hintText), hintText);
      await p.screenshot({ path: `${out}/phone-2-writing.png` });
      const written = await p.evaluate(() => window.__pairedEditor.getEditingShapeId());
      await hint.tap().catch(() => {});
      await p.waitForTimeout(400);
      const sent = await p.evaluate((id) => ({ ask: window.paired.read().objects.find((o) => o.id === id)?.meta.ask?.state ?? null, editing: Boolean(window.__pairedEditor.getEditingShapeId()) }), written);
      check('phone: tapping it sends the card as the ask', Boolean(written) && Boolean(sent.ask) && !sent.editing && (await p.locator('.selection-bar.asking').count()) === 0, JSON.stringify(sent));
      await p.screenshot({ path: `${out}/phone-3-ask-sent.png` });
      await p.keyboard.press('Escape');
      await p.waitForTimeout(200);
    } else {
      check('desktop: the first board still says how to ask with the keyboard', /press (⌘|Ctrl\+)↵/.test(board), board.slice(0, 120));
      await p.mouse.dblclick(400, 700);
      await p.waitForTimeout(400);
      await p.keyboard.type('Charge per seat', { delay: 0 });
      await p.waitForTimeout(300);
      const hintText = (await p.locator('.selection-bar.hint').innerText().catch(() => '')).replace(/\s+/g, ' ');
      check('desktop: the writing hint still names the keys', /(⌘|Ctrl\+)↵ asks now/.test(hintText), hintText);
      await p.keyboard.press('Escape');
      await p.waitForTimeout(200);
    }
    // The selection bar on a card. On the phone "Charge per seat" was just sent with no agent
    // listening, so its bar offers to send it again; a card that is not an ask offers Ask.
    const id = await p.evaluate((touch) => window.paired.read().objects.find((o) => o.type === 'card' && (touch ? !o.meta.ask : /Charge/.test(o.text ?? '')))?.id, touch);
    await p.evaluate((i) => window.paired.select([i]), id);
    await p.waitForTimeout(300);
    const caps = await p.locator('.selection-bar kbd').count();
    const bar = (await p.locator('.selection-bar').innerText()).replace(/\s+/g, ' ');
    if (touch) check('phone: the selection bar shows no key caps', caps === 0 && /Ask/.test(bar), bar);
    else check('desktop: the selection bar keeps its key caps', caps > 0 && caps === (await p.locator('.selection-bar > button').count()), `${caps} caps: ${bar}`);
    await p.screenshot({ path: `${out}/${tag}-4-selection-bar.png` });
    check(`${tag}: no page errors`, errs.length === 0, errs.join(' | '));
    await ctx.close();
  } finally {
    server.stop();
  }
}
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
