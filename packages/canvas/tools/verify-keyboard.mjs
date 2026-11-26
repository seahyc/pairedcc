// Browser check for item 7 (keyboard accessibility): the whole loop works without a pointer.
//
// On a fresh profile at 1440 x 900, using only the keyboard (no clicks, no page-side
// selection): press N and Enter to write a thought, type it, press Ctrl/⌘+Enter to ask and
// Enter to send; an agent answers with three options over HTTP; Tab reaches the answer
// options, P picks one, Tab and X cross out another, C comments on it; Escape clears the
// selection and Tab comes back to the board. Every step must leave the person somewhere
// visible: what Tab selects is on screen and has the selection bar beside it.
// The menu, agent chip and tools stay reachable: Shift+Tab with nothing selected, or Tab past
// the last object, leaves the board for them.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-keyboard.mjs <screenshot dir>
//
// Needs a dev server for this checkout with an empty board store (packages/canvas/.local/boards).
// No model is needed: the check answers the
// ask itself through the dev relay. Playwright is loaded from the directory you run this in.
// Exits non-zero if any check fails.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-keyboard.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'keyboard-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await p.waitForTimeout(1500);
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

let n = 0;
async function command(op, input) {
  const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
  const list = sessions.sessions ?? sessions;
  const sessionId = list[0]?.id ?? list[0]?.sessionId;
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `keyboard-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
const press = async (key, wait = 350) => { await p.keyboard.press(key); await p.waitForTimeout(wait); };
/** What the person sees: the selection, what is being written, and whether both are on screen. */
const state = () => p.evaluate(() => {
  const ed = window.__pairedEditor;
  const view = ed.getViewportPageBounds();
  const sel = ed.getSelectedShapes();
  const onScreen = sel.every((s) => {
    const b = ed.getShapePageBounds(s);
    return b && b.x >= view.x && b.y >= view.y && b.maxX <= view.maxX && b.maxY <= view.maxY;
  });
  const bar = document.querySelector('.selection-bar');
  const text = (s) => (s.props.richText ? JSON.stringify(s.props.richText).match(/"text":"([^"]*)"/g)?.map((t) => t.slice(8, -1)).join(' ') ?? '' : '');
  return {
    ids: sel.map((s) => s.id),
    types: sel.map((s) => s.type + (s.meta.ask ? ':ask' : '')),
    texts: sel.map(text),
    editing: ed.getEditingShapeId(),
    editingText: ed.getEditingShapeId() ? text(ed.getShape(ed.getEditingShapeId())) : '',
    onScreen,
    bar: Boolean(bar && !bar.classList.contains('hint')),
    tool: ed.getCurrentToolId(),
  };
});
const marks = () => p.evaluate(() => Object.fromEntries(window.__pairedEditor.getCurrentPageShapes().filter((o) => o.meta.mark).map((o) => [o.id, o.meta.mark])));

// 1. Write a thought: N, then Enter, then type.
await p.screenshot({ path: `${out}/1-first-screen.png` });
const before = await p.evaluate(() => window.paired.read().objects.length);
await press('n');
await press('Enter', 500);
let s = await state();
check('N then Enter starts writing a new card', Boolean(s.editing), `tool ${s.tool}, editing ${s.editing}`);
const thought = 'How should we price the team plan';
await p.keyboard.type(thought, { delay: 0 });
await p.waitForTimeout(300);
s = await state();
check('what is typed goes into that card', s.editingText.includes(thought), JSON.stringify(s.editingText));
const card = s.editing;
const placed = await p.evaluate((id) => {
  const ed = window.__pairedEditor;
  if (!id) return { overlaps: [], inView: false };
  const b = ed.getShapePageBounds(id), view = ed.getViewportPageBounds();
  const overlaps = ed.getCurrentPageShapes().filter((o) => o.id !== id && o.type !== 'arrow').filter((o) => {
    const c = ed.getShapePageBounds(o);
    return c && b.x < c.maxX && c.x < b.maxX && b.y < c.maxY && c.y < b.maxY;
  }).map((o) => o.id);
  return { overlaps, inView: b.x >= view.x && b.y >= view.y && b.maxX <= view.maxX && b.maxY <= view.maxY };
}, card);
check('the new card is on screen and covers nothing', placed.inView && placed.overlaps.length === 0, JSON.stringify(placed));
await p.screenshot({ path: `${out}/2-writing.png` });

// 2. Ask about it while writing, and send the suggested question.
await press(`${mod}+Enter`, 500);
const asking = await p.evaluate(() => document.activeElement?.getAttribute('aria-label'));
check('⌘/Ctrl+Enter opens the Ask box with the keyboard in it', asking === 'Your question', String(asking));
await p.keyboard.press(`${mod}+a`);
await p.keyboard.type('Give me options', { delay: 0 });
await press('Enter', 800);
let asks = card ? (await command('asks', {})).asks : [];
const ask = asks.find((a) => a.question === 'Give me options');
check('Enter sends the ask', Boolean(ask), `${asks.length} asks`);

// 3. The agent answers with three options.
let options = [];
if (ask) {
  const answered = await command('answer', { id: ask.id, alternatives: ['Per seat, so cost tracks team size', 'Per post, so cost tracks use', 'One flat price for any team'] });
  options = answered.answers.map((o) => o.id);
}
await p.waitForTimeout(800);
await p.screenshot({ path: `${out}/3-answered.png` });

// 4. Tab reaches the options; every stop is on screen with the selection bar.
const visited = [];
let lost = '';
for (let i = 0; i < 12 && !visited.includes(options[0]); i++) {
  await press('Tab', 300);
  s = await state();
  visited.push(s.ids.length === 1 ? s.ids[0] : `(${s.ids.length} selected)`);
  if (s.ids.length !== 1 || !s.onScreen || !s.bar) lost ||= `stop ${i + 1} (${s.types.join(',')}): ${s.ids.length} selected, on screen ${s.onScreen}, bar ${s.bar}`;
}
check('Tab from the board reaches option A, one object at a time', options.length > 0 && visited.includes(options[0]), `${visited.length} presses: ${visited.join(' ')}; options ${options.join(' ')}`);
check('every Tab stop is on screen with its next steps beside it', !lost && visited.length > 0, lost);
await p.screenshot({ path: `${out}/4-tab-to-option.png` });

// 5. Judge by key: P picks A; Tab to B and X crosses it out; C comments on B.
await press('p');
await press('Tab');
s = await state();
check('Tab moves from option A to option B', s.ids[0] === options[1], s.ids.join(','));
await press('x');
const m = await marks();
check('P picked A and X crossed out B', m[options[0]] === 'picked' && m[options[1]] === 'rejected', JSON.stringify(m));
await press('c', 500);
s = await state();
check('C starts a comment on B, ready to type', Boolean(s.editing), `editing ${s.editing}`);
await p.keyboard.type('Too unpredictable for a budget', { delay: 0 });
await press('Escape', 400);
await p.screenshot({ path: `${out}/5-judged.png` });

// 6. Escape clears; Tab comes back to the board instead of being lost.
await press('Escape');
s = await state();
check('Escape leaves nothing selected', s.ids.length === 0, s.ids.join(','));
await press('Tab');
s = await state();
check('Tab after Escape selects something on screen again', s.ids.length === 1 && s.onScreen, JSON.stringify(s.ids));

// 7. The controls stay reachable: with nothing selected Shift+Tab leaves the board for them,
// and Tab past the last object on the board does too.
const focused = () => p.evaluate(() => {
  const a = document.activeElement;
  return { tag: a?.tagName ?? '', label: (a?.getAttribute('aria-label') || a?.textContent || '').trim().slice(0, 30), inChrome: Boolean(a && a !== document.body && a.matches('button, a[href], input, select, [tabindex]') && !a.classList.contains('tl-container') && !a.closest('.tl-shape, .tl-html-layer, [contenteditable=true]')) };
});
await press('Escape');
await press('Shift+Tab');
let f = await focused();
s = await state();
check('Shift+Tab with nothing selected reaches the controls', f.inChrome && s.ids.length === 0, `${f.tag} "${f.label}", ${s.ids.length} selected`);
await press('Escape');
await p.evaluate(() => { const ed = window.__pairedEditor; ed.selectNone(); document.activeElement?.blur?.(); });
const stops = await p.evaluate(() => window.__pairedEditor.getCurrentPageShapes().filter((x) => x.type !== 'arrow' && !x.parentId.startsWith('shape:')).length);
let left = false;
for (let i = 0; i < stops + 2 && !left; i++) {
  await press('Tab', 200);
  f = await focused();
  left = f.inChrome;
}
s = await state();
check('Tab past the last object leaves the board for the controls', left && s.ids.length === 0, `${f.tag} "${f.label}" after up to ${stops + 2} presses, ${s.ids.length} selected`);

const after = await p.evaluate(() => window.paired.read().objects.length);
check('the board grew only by what was made here', after > before, `${before} → ${after}`);
check('no page errors', errors.length === 0, errors.join(' | '));

await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
