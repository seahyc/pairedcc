// Browser check: the first board never moves the view away from work done in the first seconds.
//
// Starts its own dev server of this checkout with an empty board store. In one tab an agent
// acts as soon as the tab connects, before the calm first board is laid out (it waits for
// fonts): it makes a page and a scene over HTTP. Four seconds later the agent's page must still
// be open, its objects readable, and the calm first board must exist on its own page. In a
// second, untouched tab the calm board must open on the first page as before.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-early-agent.mjs <screenshot dir>
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
if (!out) throw new Error('Usage: node verify-early-agent.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

async function devServer(port) {
  const boards = mkdtempSync(join(tmpdir(), 'early-boards-'));
  const child = spawn(process.execPath, [join(pkg, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], {
    cwd: pkg, env: { ...process.env, PAIRED_BOARDS_DIR: boards }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dev server did not start')), 30000);
    child.stdout.on('data', (d) => { if (/Local:/.test(String(d))) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => reject(new Error(`dev server exited ${code}`)));
  });
  return { origin: `http://localhost:${port}`, stop: () => { child.kill(); rmSync(boards, { recursive: true, force: true }); } };
}

const browser = await chromium.launch();
try {
  // 1. An agent acts before the first board is laid out.
  {
    const server = await devServer(5201);
    try {
      const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
      await p.goto(`${server.origin}/canvas/`);
      await p.waitForFunction(() => Boolean(window.paired && document.documentElement.dataset.pairedSession), null, { timeout: 30000 });
      const sessionId = await p.evaluate(() => document.documentElement.dataset.pairedSession);
      const op = async (name, input) => {
        const r = await fetch(`${server.origin}/api/canvas/command`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestId: randomUUID(), sessionId, actor: 'Early agent', command: { op: name, input } }),
        });
        return r.json();
      };
      const laidOut = await p.evaluate(() => window.paired.read().objects.some((o) => o.meta?.seed));
      const page = await op('page', { name: 'Agent work' });
      const scene = await op('scene', { nodes: [
        { key: 'f', shape: { kind: 'frame', x: 0, y: 0, width: 600, height: 300, name: 'Options' } },
        { key: 'a', parentKey: 'f', shape: { kind: 'note', x: 40, y: 80, text: 'Option A' } },
      ] });
      check('the agent acted before the first board was laid out', !laidOut && page.ok && scene.ok, `laid out already: ${laidOut}`);
      const a = scene.result?.objects?.a?.id;
      await p.waitForTimeout(4000);
      const state = await p.evaluate(() => {
        const ed = window.__pairedEditor;
        return { current: ed.getCurrentPage().name, pages: ed.getPages().map((pg) => ({ name: pg.name, seeded: ed.getSortedChildIdsForParent(pg.id).some((id) => ed.getShape(id)?.meta?.seed) })) };
      });
      check("the agent's page is still the one open", state.current === 'Agent work', `open: ${state.current}; pages: ${state.pages.map((pg) => pg.name).join(', ')}`);
      const read = await op('read', { ids: [a] });
      check("the agent can still read what it made", read.ok && read.result.objects.length === 1, read.ok ? `${read.result.objects.length} objects` : read.error);
      check('the calm first board was still laid out, on a page of its own', state.pages.some((pg) => pg.seeded && pg.name !== 'Agent work'), JSON.stringify(state.pages));
      await p.screenshot({ path: `${out}/1-agent-acted-early.png` });
      check('no page errors (early agent)', errs.length === 0, errs.join(' | '));
      await p.close();
    } finally {
      server.stop();
    }
  }
  // 2. Nobody acts: the calm board opens on the first page, as before.
  {
    const server = await devServer(5202);
    try {
      const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await p.goto(`${server.origin}/canvas/`);
      await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
      await p.waitForTimeout(1000);
      const state = await p.evaluate(() => {
        const ed = window.__pairedEditor;
        return { current: ed.getCurrentPage().name, pages: ed.getPages().length, seeded: ed.getCurrentPageShapes().filter((s) => s.meta?.seed).length };
      });
      check('an untouched new board opens the calm board on its only page', state.pages === 1 && state.seeded >= 3, JSON.stringify(state));
      await p.screenshot({ path: `${out}/2-untouched.png` });
      await p.close();
    } finally {
      server.stop();
    }
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
