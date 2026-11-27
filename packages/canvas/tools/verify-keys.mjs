// Browser check: key hints name the person's own keys.
//
// Starts its own dev server of this checkout with an empty board store, then opens a fresh
// board twice, as a Windows browser and as a Mac browser. On Windows nothing on the first
// screen, the selection bar, the typing hint, the Ask tooltips or the shortcut sheet may show
// an Apple key symbol (⌘ ⇧ ⌫), and the way to ask must read Ctrl; on a Mac the hints keep ⌘.
// The hinted key must really ask: there is no ask box, so it sends the card being written.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-keys.mjs <screenshot dir>
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
if (!out) throw new Error('Usage: node verify-keys.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

/** A dev server of this checkout on its own port, with a board store nobody else uses. */
async function devServer(port) {
  const boards = mkdtempSync(join(tmpdir(), 'keys-boards-'));
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

const platforms = [
  { tag: 'windows', platform: 'Win32', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', apple: false },
  { tag: 'mac', platform: 'MacIntel', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', apple: true },
];
const browser = await chromium.launch();
let port = 5191;
for (const { tag, platform, ua, apple } of platforms) {
  const server = await devServer(port++);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: ua });
    await ctx.addInitScript((pf) => {
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => pf });
      Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined });
    }, platform);
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
    await p.goto(server.url);
    await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
    await p.waitForTimeout(800);
    const symbols = /[⌘⇧⌫]/;
    const mod = apple ? '⌘' : 'Ctrl';

    const how = await p.evaluate(() => window.paired.read().objects.find((o) => o.meta?.name === 'How to ask')?.text ?? '');
    check(`${tag}: the first board says how to ask in this keyboard's keys`, how.includes(apple ? '⌘↵' : 'Ctrl+↵') && (apple || !symbols.test(how)), how.slice(0, 60));
    const screen = await p.evaluate(() => document.body.innerText);
    check(`${tag}: first screen ${apple ? 'keeps ⌘' : 'shows no Apple key symbol'}`, apple ? true : !symbols.test(screen), (screen.match(/.{0,30}[⌘⇧⌫].{0,20}/u) ?? [''])[0]);
    const askTitle = await p.getAttribute('.tool-button.ask', 'title');
    check(`${tag}: the toolbar's Ask names ${mod}`, askTitle.includes(mod) && (apple || !symbols.test(askTitle)), askTitle);
    await p.screenshot({ path: `${out}/${tag}-1-first-screen.png` });

    // Select the first card: the selection bar.
    const card = await p.evaluate(() => window.paired.read().objects.find((o) => o.type === 'card')?.id);
    await p.evaluate((id) => window.paired.select([id]), card);
    await p.waitForTimeout(300);
    const bar = await p.locator('.selection-bar').innerText();
    const barTitle = await p.getAttribute('.selection-bar > button.primary', 'title');
    check(`${tag}: selection bar's Ask names ${mod}`, bar.includes(mod) && barTitle.includes(mod) && (apple || !symbols.test(bar + barTitle)), bar.replace(/\s+/g, ' '));
    await p.screenshot({ path: `${out}/${tag}-2-selection-bar.png` });

    // Write a new card: the typing hint.
    await p.mouse.dblclick(300, 760);
    await p.waitForTimeout(400);
    await p.keyboard.type('Charge per seat', { delay: 0 });
    await p.waitForTimeout(300);
    const hint = await p.locator('.selection-bar.hint').innerText().catch(() => '');
    check(`${tag}: typing hint names ${mod}`, hint.includes(mod) && (apple || !symbols.test(hint)), hint.replace(/\s+/g, ' '));
    // The hinted key really asks: Ctrl+Enter on Windows, ⌘+Enter on a Mac. The card is the
    // question, so the key sends the card being written (no agent is needed for it to be sent).
    const writing = await p.evaluate(() => window.__pairedEditor.getEditingShapeId());
    await p.keyboard.press(apple ? 'Meta+Enter' : 'Control+Enter');
    await p.waitForTimeout(400);
    const sent = await p.evaluate((id) => ({ ask: window.paired.read().objects.find((o) => o.id === id)?.meta.ask?.state ?? null, editing: Boolean(window.__pairedEditor.getEditingShapeId()) }), writing);
    check(`${tag}: the hinted key sends the card as the ask`, Boolean(writing) && Boolean(sent.ask) && !sent.editing, JSON.stringify(sent));
    await p.keyboard.press('Escape');
    await p.keyboard.press('Escape');
    await p.evaluate(() => { window.__pairedEditor.selectNone(); });
    await p.waitForTimeout(200);

    // The shortcut sheet.
    await p.mouse.click(700, 120);
    await p.keyboard.press('?');
    await p.waitForTimeout(400);
    const sheet = await p.evaluate(() => document.querySelector('[role=dialog]')?.innerText ?? '');
    check(`${tag}: shortcut sheet ${apple ? 'keeps ⌘' : 'shows Ctrl and no Apple key symbol'}`, sheet.length > 0 && sheet.includes(mod) && (apple || !symbols.test(sheet)), (sheet.match(/.{0,30}[⌘⇧⌫].{0,10}/u) ?? [sheet.slice(0, 40)])[0].replace(/\s+/g, ' '));
    await p.screenshot({ path: `${out}/${tag}-3-shortcuts.png` });
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
