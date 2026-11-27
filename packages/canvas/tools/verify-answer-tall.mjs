// Browser check for item 100 (g): a tall ask and its answer bring the answer into view.
//
// In a window 600 px tall, the person sends a long thought as a question and an agent answers.
// The ask and its answer together are taller than the room on screen: the answer, which is the
// news, must land wholly in view (before, the view kept the ask's top and cut the answer off).
// A short ask with its answer is still brought into view whole.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-answer-tall.mjs <screenshot dir>
//
// Starts its own dev server with a throwaway board store. No model is needed. Exits non-zero if
// any check fails.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-answer-tall.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.ANSWER_TALL_PORT ?? 5216), ORIGIN = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const boards = mkdtempSync(join(tmpdir(), 'answer-tall-boards-'));
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
  const p = await browser.newPage({ viewport: { width: 1440, height: 600 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  await p.goto(`${ORIGIN}/canvas/`);
  await p.waitForFunction(() => window.paired?.read().objects.length >= 1, null, { timeout: 30000 });
  await p.waitForTimeout(1200);
  const ask = async (x, y, text, answerText) => {
    const id = await p.evaluate(([x, y, text]) => {
      const ed = window.__pairedEditor;
      ed.createShape({ type: 'card', x, y, props: { w: 320, tone: 'human', richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } } });
      const s = ed.getCurrentPageShapes().filter((s) => s.type === 'card').at(-1);
      const b = ed.getShapePageBounds(s.id);
      // The ask's top just under the top bar, as when the person has just written it.
      ed.setCamera({ x: -x + 400, y: -b.y + 120, z: 1 });
      return s.id;
    }, [x, y, text]);
    await p.evaluate((id) => window.paired.select([id]), id);
    await p.waitForTimeout(200);
    const waiting = post('/asks/wait', { agent: 'Check agent', waitMs: 10000 });
    await p.keyboard.press('Control+Enter');
    const got = await waiting;
    await p.evaluate(() => { window.__pairedEditor.selectNone(); });
    await p.mouse.move(1300, 300);
    await p.waitForTimeout(300);
    const res = await post('/command', { requestId: randomUUID(), sessionId: got.sessionId, actor: 'Check agent', command: { op: 'answer', input: { id: got.ask.id, text: answerText } } });
    if (!res.ok) throw new Error(JSON.stringify(res).slice(0, 200));
    await p.waitForTimeout(900);
    return p.evaluate(([askId, answerId]) => {
      const ed = window.__pairedEditor;
      const [a, b] = [askId, answerId].map((id) => { const r = ed.getShapePageBounds(id); const t = ed.pageToScreen({ x: r.x, y: r.y }), u = ed.pageToScreen({ x: r.maxX, y: r.maxY }); return { top: Math.round(t.y), bottom: Math.round(u.y) }; });
      return { ask: a, answer: b, height: window.innerHeight };
    }, [id, res.result.answers[0].id]);
  };
  await p.evaluate(() => { const ed = window.__pairedEditor; ed.deleteShapes([...ed.getCurrentPageShapeIds()]); });
  const long = Array.from({ length: 14 }, (_, i) => `Line ${i + 1} of a long thought about pricing tiers for teams`).join('. ');
  const tall = await ask(200, 200, long, 'Lead with the team tier: it is the one most people will compare, and the seat floor keeps small teams honest.');
  check('the ask and its answer are taller than the room on screen (the case under test)', tall.answer.bottom - tall.ask.top > tall.height - 104 - 90, JSON.stringify(tall));
  check('the answer lands wholly in view', tall.answer.top >= 104 && tall.answer.bottom <= tall.height - 90 + 1, JSON.stringify(tall.answer));
  await p.screenshot({ path: `${out}/tall-ask.png` });
  const short = await ask(3000, 200, 'Which tier first?', 'The team tier.');
  check('a short ask with its answer is still brought into view whole', short.ask.top >= 104 && short.answer.bottom <= short.height - 90 + 1, JSON.stringify(short));
  // The same card asked again after a long first answer: the new answer is what comes into view.
  const again = await p.evaluate(() => {
    const ed = window.__pairedEditor;
    ed.createShape({ type: 'card', x: 6000, y: 200, props: { w: 320, tone: 'human', richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Which tier for schools' }] }] } } });
    return ed.getCurrentPageShapes().filter((s) => s.type === 'card').at(-1).id;
  });
  const sendAndAnswer = async (text) => {
    await p.evaluate((id) => { const ed = window.__pairedEditor, b = ed.getShapePageBounds(id); ed.setCamera({ x: -b.x + 400, y: -b.y + 120, z: 1 }); window.paired.select([id]); }, again);
    await p.waitForTimeout(200);
    const w = post('/asks/wait', { agent: 'Check agent', waitMs: 10000 });
    await p.keyboard.press('Control+Enter');
    const g = await w;
    await p.evaluate(() => { window.__pairedEditor.selectNone(); });
    await p.mouse.move(1300, 300);
    await p.waitForTimeout(300);
    const r = await post('/command', { requestId: randomUUID(), sessionId: g.sessionId, actor: 'Check agent', command: { op: 'answer', input: { id: g.ask.id, text } } });
    await p.waitForTimeout(900);
    return r.result.answers[0].id;
  };
  await sendAndAnswer(Array.from({ length: 12 }, () => 'A long first answer that runs on and on over many lines.').join(' '));
  const second = await sendAndAnswer('Start them on the team tier.');
  const pos = await p.evaluate((id) => { const ed = window.__pairedEditor, r = ed.getShapePageBounds(id); return { top: Math.round(ed.pageToScreen({ x: r.x, y: r.y }).y), bottom: Math.round(ed.pageToScreen({ x: r.maxX, y: r.maxY }).y), height: innerHeight }; }, second);
  check('asked again after a long answer, the new answer lands in view', pos.top >= 104 && pos.bottom <= pos.height - 90 + 1, JSON.stringify(pos));
  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await browser.close();
  server.kill();
  rmSync(boards, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
