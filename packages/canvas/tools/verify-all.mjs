// Runs every browser check in tools/ that needs no model, paid API or external service, one
// after another, and prints a pass/fail table.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-all.mjs <out dir> [--only=calm,runs]
//
// It starts a dev server of this checkout on :5183 (the port most checks expect) with a throwaway
// board store that is emptied before each check, opens a headless canvas tab for checks that
// drive an already-open tab, and starts the resident agent with a stand-in for the model (a
// script that waits 3 s and returns a fixed reply; no model is called) for the calm loop check.
// Checks that start their own dev server run as they are. Each check's output goes to
// <out dir>/<name>.log and its screenshots to <out dir>/<name>/; the table is also written to
// <out dir>/summary.json. Exits non-zero if any check fails.
//
// Left out, with the reason shown in the table: the real-server sync check (needs Postgres and
// Redis) and the two-step legacy image modes. A check marked `log` only logs what it sees and
// exits 0 unless it crashes; the table would mark it "ran" rather than "pass" (none does now).
import { createRequire } from 'node:module';
import { chmodSync, existsSync, mkdirSync, renameSync, mkdtempSync, readdirSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2] && resolve(process.argv[2]);
if (!out || out.startsWith('--')) throw new Error('Usage: node verify-all.mjs <out dir> [--only=name,name]');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const runDir = process.cwd();
const { chromium } = createRequire(`${runDir}/`)('playwright');
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const tools = join(pkg, 'tools');
const ORIGIN = 'http://localhost:5183';
mkdirSync(out, { recursive: true });

// tab: open a canvas tab at this path first. agent: run the resident agent with the stand-in.
// comment: leave an open comment on the board first. log: the check logs and exits 0 unless it crashes.
const CHECKS = [
  { name: 'contain', file: 'verify-contain.mjs', args: (d) => [d] },
  { name: 'keys', file: 'verify-keys.mjs', args: (d) => [d] },
  { name: 'calm', file: 'verify-calm.mjs', args: (d) => [d], agent: true },
  { name: 'import', file: 'verify-import.mjs', args: (d) => [d, ORIGIN] },
  { name: 'import-faithful', file: 'verify-import-faithful.mjs', args: (d) => [d, ORIGIN] },
  { name: 'webpage', file: 'verify-webpage.mjs', args: (d) => [d, ORIGIN] },
  { name: 'pdf', file: 'verify-pdf.mjs', args: (d) => [d, ORIGIN] },
  { name: 'cite', file: 'verify-cite.mjs', args: (d) => [d, ORIGIN] },
  { name: 'compare', file: 'verify-compare.mjs', args: (d) => [d, ORIGIN] },
  { name: 'csv-faithful', file: 'verify-csv-faithful.mjs', args: (d) => [d, ORIGIN] },
  { name: 'image-size', file: 'verify-image-size.mjs', args: (d) => [d] },
  { name: 'board-images', file: 'verify-board-images.mjs', args: (d) => ['fresh', d] },
  { name: 'ask-frame', file: 'verify-ask-frame.mjs', args: (d) => [d] },
  { name: 'ask-marks', file: 'verify-ask-marks.mjs', args: (d) => [d] },
  { name: 'ask-chart', file: 'verify-ask-chart.mjs', args: (d) => [d] },
  { name: 'answer-page', file: 'verify-answer-page.mjs', args: (d) => [d] },
  { name: 'ask-record', file: 'verify-ask-record.mjs', args: (d) => [d, ORIGIN] },
  { name: 'leave-out', file: 'verify-leave-out.mjs', args: (d) => [d] },
  { name: 'stale-flag', file: 'verify-stale-flag.mjs', args: (d) => [d] },
  { name: 'stale-linear', file: 'verify-stale-linear.cjs', args: (d) => ['20', ORIGIN, join(d, 'stale-linear.png')] },
  { name: 'board-sync', file: 'verify-board-sync.cjs', args: () => [] },
  { name: 'data-agent', file: 'verify-data-agent.cjs', args: () => [] },
  { name: 'data-prototype', file: 'verify-data-prototype.cjs', args: () => [] },
  { name: 'group', file: 'verify-group.cjs', args: () => [] },
  { name: 'learning', file: 'verify-learning.cjs', args: () => [] },
  { name: 'runs', file: 'verify-runs.ts', args: () => [] },
  { name: 'api', file: 'verify-api.ts', args: () => [], tab: '/canvas/' },
  { name: 'mcp', file: 'verify-mcp.ts', args: () => [], tab: '/canvas/' },
  { name: 'composition', file: 'verify-composition.ts', args: () => [], tab: '/canvas/' },
  { name: 'converge', file: 'verify-converge.ts', args: () => [], tab: '/canvas/?prototype=converge' },
  { name: 'feedback-mcp', file: 'verify-feedback-mcp.ts', args: () => [], tab: '/canvas/', comment: true },
  { name: 'connector-follow', file: 'verify-connector-follow.ts', args: (d) => [join(d, 'connector')] },
  { name: 'answer-show', file: 'verify-answer-show.mjs', args: (d) => [d] },
  { name: 'retry-key', file: 'verify-retry-key.mjs', args: (d) => [d] },
  { name: 'check-me', file: 'verify-check-me.mjs', args: (d) => [d] },
  { name: 'p4-suggest', file: 'verify-p4-suggest.mjs', args: (d) => [d] },
  { name: 'menu-keys', file: 'verify-menu-keys.mjs', args: (d) => [d] },
  { name: 'import-follow', file: 'verify-import-follow.mjs', args: (d) => [d, ORIGIN] },
  { name: 'stale-edges', file: 'verify-stale-edges.mjs', args: (d) => [d] },
  // Listed ahead of their merge; a check whose file is not in tools/ yet is passed over.
  { name: 'keyboard', file: 'verify-keyboard.mjs', args: (d) => [d] },
  { name: 'heard', file: 'verify-heard.mjs', args: (d) => [d] },
  { name: 'pin-context', file: 'verify-pin-context.mjs', args: (d) => [d] },
  { name: 'ask-image', file: 'verify-ask-image.mjs', args: (d) => [d] },
  { name: 'ask-unclipped', file: 'verify-ask-unclipped.mjs', args: (d) => [d] },
  { name: 'annotate-clear', file: 'verify-annotate-clear.mjs', args: (d) => [d] },
  { name: 'phone-margin', file: 'verify-phone-margin.mjs', args: (d) => [d] },
  // These start their own dev servers on other ports.
  { name: 'answer-view', file: 'verify-answer-view.mjs', args: (d) => [d] },
  { name: 'touch', file: 'verify-touch.mjs', args: (d) => [d] },
  { name: 'early-agent', file: 'verify-early-agent.mjs', args: (d) => [d] },
  { name: 'ask-live', file: 'verify-ask-live.mjs', args: (d) => [d] },
  { name: 'answer-beside', file: 'verify-answer-beside.mjs', args: (d) => [d] },
  { name: 'import-author', file: 'verify-import-author.mjs', args: () => [] },
  { name: 'frame-edge', file: 'verify-frame-edge.mjs', args: (d) => [d] },
  { name: 'recall', file: 'verify-recall.mjs', args: (d) => [d] },
  { name: 'overview', file: 'verify-overview.mjs', args: (d) => [d] },
  { name: 'fold', file: 'verify-fold.mjs', args: (d) => [d] },
  { name: 'focus', file: 'verify-focus.mjs', args: (d) => [d] },
].filter((c) => existsSync(join(dirname(fileURLToPath(import.meta.url)), c.file)));
const SKIPPED = [
  { name: 'board-sync-server', reason: 'needs Postgres and Redis; run `pnpm --filter @pairedcc/canvas verify:sync-server`' },
  { name: 'board-images legacy', reason: 'two-step profile modes (legacy-add, legacy-open) are run by hand' },
];
// Checks added to tools/ later that this list does not know yet are reported, never silently missed.
const known = new Set([...CHECKS.map((c) => c.file), 'verify-board-sync-server.ts', 'verify-all.mjs']);
const unknown = readdirSync(tools).filter((f) => f.startsWith('verify-') && !known.has(f));

async function isUp() {
  try { await fetch(`${ORIGIN}/canvas/`); return true; } catch { return false; }
}
if (await isUp()) throw new Error(`Something is already serving ${ORIGIN}. Stop it first: the checks need a dev server of this checkout with an empty board store.`);

const boards = mkdtempSync(join(tmpdir(), 'verify-all-boards-'));
const scratch = mkdtempSync(join(tmpdir(), 'verify-all-'));
const stub = join(scratch, 'model-stand-in');
writeFileSync(stub, '#!/bin/sh\n# Stand-in for the model CLI: a fixed short reply after 3 s, no network.\nsleep 3\nprintf \'%s\' \'{"result":"A team of three at ten a seat pays thirty a month; check what happens at twelve.","is_error":false}\'\n');
chmodSync(stub, 0o755);
const children = new Set();
const track = (child) => { children.add(child); child.on('exit', () => children.delete(child)); return child; };
const cleanup = () => { for (const c of children) c.kill(); rmSync(boards, { recursive: true, force: true }); rmSync(scratch, { recursive: true, force: true }); };
process.on('SIGINT', () => { cleanup(); process.exit(130); });

const server = track(spawn(process.execPath, [join(pkg, 'node_modules/vite/bin/vite.js'), '--host', '0.0.0.0', '--port', '5183', '--strictPort'], {
  cwd: pkg, env: { ...process.env, PAIRED_BOARDS_DIR: boards }, stdio: ['ignore', 'pipe', 'pipe'],
}));
await new Promise((ok, fail) => {
  const timer = setTimeout(() => fail(new Error('dev server did not start')), 30000);
  server.stdout.on('data', (d) => { if (/Local:/.test(String(d))) { clearTimeout(timer); ok(); } });
  server.on('exit', (code) => fail(new Error(`dev server exited ${code}`)));
});

const emptyStore = () => { for (const f of readdirSync(boards)) rmSync(join(boards, f), { recursive: true, force: true }); };
function run(cmd, args, opts, logFile, timeoutMs) {
  return new Promise((done) => {
    const log = createWriteStream(logFile);
    const child = track(spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] }));
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('exit', (code, signal) => { clearTimeout(timer); log.end(); done(signal === 'SIGKILL' ? 'timeout' : code); });
  });
}

const results = [];
const browser = await chromium.launch();
try {
  for (const c of CHECKS) {
    if (only && !only.includes(c.name)) continue;
    const dir = join(out, c.name);
    mkdirSync(dir, { recursive: true });
    emptyStore();
    const started = Date.now();
    let tab, agent;
    try {
      if (c.tab) {
        tab = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await tab.goto(`${ORIGIN}${c.tab}`);
        await tab.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
        await tab.waitForTimeout(1500);
        if (c.comment) {
          const id = await tab.evaluate(() => window.paired.read().objects.find((o) => o.type === 'card').id);
          await tab.evaluate((i) => window.paired.select([i]), id);
          await tab.keyboard.press('c');
          await tab.waitForTimeout(400);
          await tab.keyboard.type('Is this the right first step?', { delay: 0 });
          await tab.keyboard.press('Escape');
          await tab.waitForTimeout(1500);
        }
      }
      if (c.agent) {
        agent = track(spawn(join(pkg, 'node_modules/.bin/tsx'), [join(tools, 'resident-agent.ts')], {
          cwd: pkg, env: { ...process.env, PAIRED_CLAUDE_BIN: stub, PAIRED_URL: ORIGIN }, stdio: 'ignore',
        }));
        await new Promise((r) => setTimeout(r, 4000));
      }
      const ts = c.file.endsWith('.ts');
      const imagesBefore = new Set(readdirSync(pkg).filter((f) => f.endsWith('.png')));
      const code = await run(
        process.execPath,
        [...(ts ? ['--import', 'tsx'] : []), join(tools, c.file), ...c.args(dir)],
        // .cjs checks require('playwright') from their own folder, so they are pointed at the run
        // directory's; .ts and .mjs checks resolve it themselves.
        { cwd: ts ? pkg : runDir, env: c.file.endsWith('.cjs') ? { ...process.env, NODE_PATH: [join(runDir, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(':') } : process.env },
        join(out, `${c.name}.log`),
        c.name === 'calm' ? 420000 : 300000,
      );
      // Some checks write screenshots to their working folder; keep them with the check's output.
      for (const f of readdirSync(pkg)) if (f.endsWith('.png') && !imagesBefore.has(f)) renameSync(join(pkg, f), join(dir, f));
      const status = code === 0 ? (c.log ? 'ran' : 'pass') : code === 'timeout' ? 'timeout' : 'fail';
      results.push({ name: c.name, file: c.file, status, seconds: Math.round((Date.now() - started) / 1000) });
    } catch (error) {
      results.push({ name: c.name, file: c.file, status: 'fail', seconds: Math.round((Date.now() - started) / 1000), error: String(error).slice(0, 200) });
    } finally {
      agent?.kill();
      await tab?.close();
    }
    const r = results.at(-1);
    console.log(`${r.status.toUpperCase().padEnd(7)} ${r.name.padEnd(17)} ${String(r.seconds).padStart(4)} s${r.error ? `  — ${r.error}` : ''}`);
  }
} finally {
  await browser.close();
  cleanup();
}
for (const s of SKIPPED) console.log(`SKIP    ${s.name.padEnd(17)}        — ${s.reason}`);
for (const f of unknown) console.log(`UNKNOWN ${f.padEnd(17)}        — not in verify-all's list; add it`);
const failed = results.filter((r) => r.status === 'fail' || r.status === 'timeout');
writeFileSync(join(out, 'summary.json'), JSON.stringify({ at: new Date().toISOString(), results, skipped: SKIPPED, unknown }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks pass or ran${failed.length ? `; failing: ${failed.map((r) => r.name).join(', ')}` : ''}${unknown.length ? `; ${unknown.length} unknown` : ''}`);
process.exit(failed.length || unknown.length ? 1 : 0);
