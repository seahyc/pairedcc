// Browser check for P5 part 1 (principles finding 9, understanding needs effort): Check me.
//
// On a fresh profile at 1440 x 900: the first board shows no Check me and no prompt. The person
// writes a question and sends it; an agent answers over HTTP. With the person's own card
// selected there is no Check me; with the answer selected the bar offers Check me (E). E puts
// the answer away behind a prompt beside it (on nothing else, in view, cursor in its box), and
// an agent read no longer gives the answer's text. One undo brings everything back. Checked
// again, the person explains from memory and commits: the answer is back beside what they
// wrote, top aligned, nothing overlapping, the prompt's text inside it; a reload keeps it all.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-check-me.mjs <screenshot dir>
//
// Needs a dev server for this checkout with an empty board store (packages/canvas/.local/boards).
// No model is needed. Playwright is loaded from the directory you run this in. Exits non-zero
// if any check fails.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-check-me.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'check-me-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await p.waitForTimeout(1500);
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function finish() {
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

let n = 0;
async function command(op, input) {
  const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
  const list = sessions.sessions ?? sessions;
  const sessionId = list[0]?.id ?? list[0]?.sessionId;
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `check-me-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
const barButtons = () => p.evaluate(() => [...document.querySelectorAll('.selection-bar > button')].map((b) => b.textContent.trim()));
const select = async (id) => { await p.evaluate((id) => { window.paired.select([id]); window.__pairedEditor.focus(); }, id); await p.waitForTimeout(300); };
const prompts = () => p.evaluate(() => window.__pairedEditor.getCurrentPageShapes().filter((s) => s.type === 'prompt').map((s) => ({ id: s.id, status: s.props.status, check: s.meta.check, createdBy: s.meta.createdBy })));
const hidden = (id) => p.evaluate((id) => window.__pairedEditor.isShapeHidden(id), id);
const bounds = (id) => p.evaluate((id) => { const b = window.__pairedEditor.getShapePageBounds(id); return b && { x: b.x, y: b.y, w: b.w, h: b.h }; }, id);
const overlapsAny = (id) => p.evaluate((id) => {
  const e = window.__pairedEditor, a = e.getShapePageBounds(id);
  return e.getCurrentPageShapes().filter((s) => s.id !== id && s.type !== 'frame' && s.type !== 'arrow' && !e.isShapeHidden(s))
    .filter((s) => { const b = e.getShapePageBounds(s); return b && a.x < b.maxX && b.x < a.maxX && a.y < b.maxY && b.y < a.maxY; })
    .map((s) => s.id);
}, id);
const inView = (id) => p.evaluate((id) => {
  const e = window.__pairedEditor, b = e.getShapePageBounds(id), v = e.getViewportPageBounds();
  return b.x >= v.x && b.y >= v.y && b.maxX <= v.maxX && b.maxY <= v.maxY;
}, id);

// The first board: nothing of this is shown until it applies.
const first = await p.evaluate(() => ({ text: document.body.innerText.includes('Check me'), prompts: window.__pairedEditor.getCurrentPageShapes().filter((s) => s.type === 'prompt').length }));
check('the first board shows no Check me and no prompt', !first.text && first.prompts === 0, JSON.stringify(first));
await p.screenshot({ path: `${out}/check-me-first-screen.png` });

// The person writes a question and sends it; the agent answers.
const card = await p.evaluate(() => window.paired.create({ kind: 'note', x: 120, y: 560, width: 300, text: 'How should we price the team plan?' }));
const cardId = typeof card === 'string' ? card : card.id;
await select(cardId);
await p.keyboard.press(`${mod}+Enter`);
await p.waitForTimeout(500);
const ask = (await command('asks', {})).asks.find((a) => a.question === 'How should we price the team plan?');
check('the question was sent', Boolean(ask));
const ANSWER = 'Charge per seat with a five-seat floor, so small teams pay little and big ones scale.';
const answered = await command('answer', { id: ask.id, text: ANSWER });
const answerId = answered.answers[0].id;
await p.waitForTimeout(500);

await select(cardId);
check("the person's own card offers no Check me", !(await barButtons()).some((t) => /Check me/.test(t)), (await barButtons()).join(' | '));
await p.keyboard.press('e');
await p.waitForTimeout(300);
check("E on the person's own card makes no prompt", (await prompts()).length === 0);

await select(answerId);
const buttons = await barButtons();
const checkButton = buttons.find((t) => /Check me/.test(t));
check("the agent's answer offers Check me with its key", Boolean(checkButton) && /E$/.test(checkButton), buttons.join(' | '));
await p.screenshot({ path: `${out}/check-me-bar.png` });

// E puts the answer away behind a prompt beside it.
await p.keyboard.press('e');
await p.waitForTimeout(600);
let made = await prompts();
check('E makes one check prompt, by the person, about this answer', made.length === 1 && made[0].check === answerId && made[0].createdBy === 'Human' && made[0].status === 'open', JSON.stringify(made));
const promptId = made[0]?.id;
if (!promptId) {
  check('the rest of the check needs a prompt; not run', false);
  await finish();
}
check('the answer is put away while the prompt is open', await hidden(answerId));
check('the prompt covers nothing on the board', (await overlapsAny(promptId)).length === 0, JSON.stringify(await overlapsAny(promptId)));
check('the prompt is in view', await inView(promptId));
const focused = await p.evaluate(() => document.activeElement?.closest('[data-prompt]')?.getAttribute('data-prompt') ?? null);
check('the cursor is in the prompt, ready to write', focused === promptId, String(focused));
const question = await p.evaluate((id) => window.__pairedEditor.getShape(id).props.question, promptId);
check('the prompt quotes the ask', question.includes('How should we price the team plan?'), question);
// The agent made the answer and may still read it; the read says it is put away behind the check.
const readAnswer = (await command('read', {})).objects.find((o) => o.id === answerId);
check('an agent read reports the answer as waiting behind the check', readAnswer?.meta?.revealAfter === promptId, JSON.stringify(readAnswer?.meta));
await p.screenshot({ path: `${out}/check-me-open.png` });

// One undo brings it all back, from the empty box the cursor is in.
await p.keyboard.press(`${mod}+z`);
await p.waitForTimeout(400);
check('Ctrl/⌘+Z in the empty box takes the check back in one step', (await prompts()).length === 0 && !(await hidden(answerId)), JSON.stringify(await prompts()));

// Again, and this time the person explains from memory and commits.
await select(answerId);
await p.keyboard.press('e');
await p.waitForTimeout(600);
made = await prompts();
const id2 = made[0]?.id;
await p.keyboard.type('Per seat, with a minimum, so small teams pay less');
await p.click(`[data-prompt="${id2}"] .learn-commit`);
await p.waitForTimeout(500);
made = await prompts();
check('the explanation is committed', made[0]?.status === 'committed', JSON.stringify(made));
check('the answer is back', !(await hidden(answerId)));
const a = await bounds(answerId), b = await bounds(id2);
check('the answer and the explanation sit side by side, top aligned, apart', Math.abs(a.y - b.y) < 1 && (b.x >= a.x + a.w || b.x + b.w <= a.x), JSON.stringify({ a, b }));
check('nothing overlaps the prompt', (await overlapsAny(id2)).length === 0);
const spill = await p.evaluate((id) => {
  const box = document.querySelector(`[data-prompt="${id}"]`).getBoundingClientRect();
  return [...document.querySelectorAll(`[data-prompt="${id}"] *`)].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width && (r.right > box.right + 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1);
  }).length;
}, id2);
check("the prompt's text stays inside it", spill === 0, `${spill} elements outside`);
const shown = await p.evaluate((id) => document.querySelector(`[data-prompt="${id}"]`).innerText, id2);
check('it says what was written and to compare', /Per seat, with a minimum/.test(shown) && /compare/.test(shown), shown.replace(/\s+/g, ' '));
await p.screenshot({ path: `${out}/check-me-compare.png` });

// A reload keeps it.
await p.waitForTimeout(1500);
await p.reload();
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await p.waitForTimeout(1500);
made = await prompts();
check('after a reload the check is still committed and the answer shown', made.length === 1 && made[0].status === 'committed' && !(await hidden(answerId)), JSON.stringify(made));

await finish();
