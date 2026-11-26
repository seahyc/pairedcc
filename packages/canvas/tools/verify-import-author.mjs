// Browser check: an agent may correct what it imported, but never the person's import.
//
// Starts its own dev server of this checkout with an empty board store. An agent imports a short
// document over HTTP and corrects a typo in one of its section cards; the person pastes the same
// spreadsheet tab (the synthetic review fixture) and the agent's attempt to change one of those
// cards is refused.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-import-author.mjs
//
// Playwright is not a dependency of this repository; it is loaded from the directory you run
// this in. Exits non-zero if any check fails.
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5209, ORIGIN = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const boards = mkdtempSync(join(tmpdir(), 'import-author-boards-'));
const server = spawn(process.execPath, [join(pkg, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], {
  cwd: pkg, env: { ...process.env, PAIRED_BOARDS_DIR: boards }, stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('dev server did not start')), 30000);
  server.stdout.on('data', (d) => { if (/Local:/.test(String(d))) { clearTimeout(timer); resolve(); } });
  server.on('exit', (code) => reject(new Error(`dev server exited ${code}`)));
});
const doc = '# Plan\n\n## Next stepps\n\nAsk three teams what they pay today.\n\n## Risks\n\nTeams may not share prices.\n';
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  await p.goto(`${ORIGIN}/canvas/`);
  await p.waitForFunction(() => window.paired?.read().objects.length >= 3 && document.documentElement.dataset.pairedSession, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  const sessionId = await p.evaluate(() => document.documentElement.dataset.pairedSession);
  const op = (name, input) => fetch(`${ORIGIN}/api/canvas/command`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), sessionId, actor: 'Check agent', command: { op: name, input } }),
  }).then((r) => r.json());
  const findCard = async (pattern, importId) => {
    const read = await op('read', {});
    return read.result.objects.find((o) => o.type === 'card' && pattern.test(o.text ?? '') && (!importId || o.meta?.source?.importId === importId));
  };

  // 1. The agent's own import: it may correct its typo.
  const imported = await op('import', { content: doc, format: 'markdown', name: 'plan.md' });
  check('the agent imported the document', imported.ok === true, imported.ok ? imported.result.summary : imported.error);
  const mine = await findCard(/Next stepps/, imported.result?.importId);
  const fixed = mine ? await op('update', { id: mine.id, expectedRevision: mine.revision, text: (mine.text ?? '').replace('stepps', 'steps') }) : { ok: false, error: 'no section card found' };
  check('the agent can correct a card it imported', fixed.ok === true, fixed.ok ? 'corrected' : fixed.error);

  // 2. The person's import (a paste): the agent cannot rewrite it.
  // A spreadsheet tab on the clipboard (the synthetic review fixture), pasted with the keyboard.
  const fixture = (name) => readFileSync(join(pkg, 'test/fixtures', name), 'utf8');
  await p.evaluate(async (d) => {
    const item = {};
    for (const [type, value] of Object.entries(d)) item[type] = new Blob([value], { type });
    await navigator.clipboard.write([new ClipboardItem(item)]);
  }, { 'text/html': fixture('review.html'), 'text/plain': fixture('review.tsv') });
  await p.evaluate(() => { window.__pairedEditor.selectNone(); });
  await p.mouse.click(1000, 620);
  await p.keyboard.press('ControlOrMeta+v');
  await p.waitForTimeout(1500);
  const read = await op('read', {});
  const pasted = read.result.objects.find((o) => o.type === 'card' && o.meta?.source?.from === 'pasted' && (o.text ?? '').trim());
  check("the person's paste was imported as source cards", Boolean(pasted), pasted ? pasted.meta.source.from : 'no pasted section card');
  if (pasted) {
    const refused = await op('update', { id: pasted.id, expectedRevision: pasted.revision, text: 'Rewritten by the agent' });
    check("the agent cannot rewrite the person's import", refused.ok === false && /person's own writing/.test(refused.error ?? ''), refused.ok ? 'accepted' : refused.error);
  }
} finally {
  await browser.close();
  server.kill();
  rmSync(boards, { recursive: true, force: true });
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
