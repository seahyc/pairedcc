// Browser check for P4: suggestions on the board, not in a box.
//
// On a fresh profile at 1440 x 900: the person writes a thought. While typing nothing is
// suggested; after a short pause on the finished card, at most two faint suggestions appear under
// it, chosen by what is selected, inside their own box and clear of every object and of the
// selection bar. Any other action makes them go, and they are not offered again for that
// selection. Clicking one writes it as the person's own pink card under the selection, which is
// sent as an ask; one undo takes it back. Two thoughts get "Compare these"; an agent's card, an
// untouched first-board card and an ask get nothing; a card with something right under it gets
// suggestions placed clear of that thing. The first screen shows nothing new.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-p4-suggest.mjs <screenshot dir>
//
// Needs a dev server for this checkout with an empty board store. No model is needed.
// Playwright is loaded from the directory you run this in. Exits non-zero if any check fails.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-p4-suggest.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'suggest-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await p.waitForTimeout(1500);
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const press = async (key, wait = 350) => { await p.keyboard.press(key); await p.waitForTimeout(wait); };
const PAUSE = 1900;

async function command(op, input) {
  const sessionId = await p.evaluate(() => document.documentElement.dataset.pairedSession);
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `suggest-${Date.now()}-${Math.random()}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}

/** What is suggested now, and whether it is clear of every object other than the selection. */
const seen = () => p.evaluate(() => {
  const ed = window.__pairedEditor;
  const box = document.querySelector('.suggestions');
  if (!box) return { shown: false, texts: [] };
  const r = box.getBoundingClientRect();
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const selected = new Set(ed.getSelectedShapeIds());
  const covered = [...document.querySelectorAll('.tl-shape[data-shape-id]')]
    .filter((el) => !selected.has(el.dataset.shapeId) && ed.getShape(el.dataset.shapeId)?.type !== 'arrow' && ed.getShape(el.dataset.shapeId)?.type !== 'frame')
    .filter((el) => hit(r, el.getBoundingClientRect()))
    .map((el) => el.dataset.shapeId);
  const bar = document.querySelector('.selection-bar')?.getBoundingClientRect();
  const sel = ed.getSelectionScreenBounds?.() ?? null;
  const buttons = [...box.querySelectorAll('button')];
  return {
    shown: true,
    texts: buttons.map((b) => b.textContent),
    covered,
    underBar: Boolean(bar && hit(r, bar)),
    inside: buttons.every((b) => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().right <= r.right + 1 && b.getBoundingClientRect().bottom <= r.bottom + 1),
    belowSelection: sel ? r.top >= sel.maxY - 1 || r.left >= sel.maxX - 1 : null,
    opacity: Number(getComputedStyle(buttons[0]).opacity),
  };
});

const shot0 = `${out}/1-first-screen.png`;
await p.screenshot({ path: shot0 });
check('the first screen shows no suggestions', !(await seen()).shown);

// The person writes a thought: nothing is suggested while typing, even after a pause.
await press('n');
await press('Enter', 500);
await p.keyboard.type('Per-seat pricing, because cost should follow team size', { delay: 0 });
await p.waitForTimeout(PAUSE);
check('nothing is suggested while typing', !(await seen()).shown);
await press('Escape', 300);
const card = await p.evaluate(() => window.__pairedEditor.getOnlySelectedShapeId());
check('nothing is suggested at once: only after a pause', !(await seen()).shown);
await p.waitForTimeout(PAUSE);
let s = await seen();
check('after a pause, at most two suggestions appear', s.shown && s.texts.length >= 1 && s.texts.length <= 2, JSON.stringify(s.texts));
// The thought gives a reason, so the first follows its words (item 120), the second is the usual next step.
check('they follow what the thought says, then the usual next step', s.texts[0] === "What's the strongest objection?" && s.texts[1] === "What's missing?", JSON.stringify(s.texts));
check('they are faint', s.opacity > 0 && s.opacity < 0.8, String(s.opacity));
check('they sit under (or beside) the selection, clear of every object', s.belowSelection === true && s.covered.length === 0, JSON.stringify(s));
check('they never sit under the selection bar', !s.underBar);
check('their text stays inside their box', s.inside);
await p.screenshot({ path: `${out}/2-suggested.png` });

// Any other action makes them go, and they are not offered again for the same selection.
await press('Shift', 200);
check('any other action makes them go', !(await seen()).shown);
await p.waitForTimeout(PAUSE);
check('they are not offered again for the same selection', !(await seen()).shown);
const centre = await p.evaluate((id) => { const ed = window.__pairedEditor, b = ed.getShapePageBounds(id); return ed.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 }); }, card);
await p.mouse.click(centre.x, centre.y);
await p.waitForTimeout(PAUSE);
check('clicking the selected card again does not bring them back', !(await seen()).shown && (await p.evaluate(() => window.__pairedEditor.getSelectedShapeIds().length)) === 1);

// A new selection gets a new chance; clicking one writes the person's own card, sent as an ask.
await p.evaluate(() => { window.paired.select([]); });
await p.waitForTimeout(200);
await p.evaluate((id) => { window.paired.select([id]); window.__pairedEditor.focus(); }, card);
await p.waitForTimeout(PAUSE);
s = await seen();
check('selecting again offers them again', s.shown, JSON.stringify(s.texts));
const before = await p.evaluate(() => window.__pairedEditor.getCurrentPageShapes().length);
await p.locator('.suggestions button', { hasText: "What's missing?" }).click();
await p.waitForTimeout(600);
const made = await p.evaluate((cardId) => {
  const ed = window.__pairedEditor, shape = ed.getCurrentPageShapes().find((s) => s.meta.ask && (s.meta.targetIds ?? []).includes(cardId)), id = shape?.id;
  const text = shape && 'richText' in shape.props ? shape.props.richText.content.map((b) => (b.content ?? []).map((t) => t.text).join('')).join('\n') : '';
  const a = ed.getShapePageBounds(cardId), b = shape && ed.getShapePageBounds(shape);
  const others = ed.getCurrentPageShapes().filter((o) => o.id !== id && o.type !== 'arrow' && o.type !== 'frame').map((o) => ed.getShapePageBounds(o));
  const overlaps = b ? others.filter((o) => o.x < b.maxX && b.x < o.maxX && o.y < b.maxY && b.y < o.maxY).length : -1;
  return { id, text, author: shape?.meta.author, ask: shape?.meta.ask?.state, targets: shape?.meta.targetIds ?? [], under: Boolean(a && b && (b.y >= a.maxY || b.x >= a.maxX)), overlaps, count: ed.getCurrentPageShapes().length };
}, card);
check('clicking one writes it as the person\'s own card', made.text === "What's missing?" && made.author === 'Human', JSON.stringify(made));
check('the card is an ask about the selection', made.ask === 'waiting' && made.targets.includes(card), JSON.stringify(made));
check('the card is under (or, when that is taken, beside) the selection and on top of nothing', made.under && made.overlaps === 0, JSON.stringify(made));
check('the suggestions are gone, and nothing stays selected to cover the thought', !(await seen()).shown && (await p.evaluate(() => window.__pairedEditor.getSelectedShapeIds().length)) === 0);
await p.screenshot({ path: `${out}/3-chosen.png` });
await p.evaluate((id) => { window.paired.select([id]); window.__pairedEditor.focus(); }, made.id);
await p.waitForTimeout(PAUSE);
check('an ask gets no suggestions of its own', !(await seen()).shown);
await press(`${mod}+z`, 500);
const after = await p.evaluate((id) => ({ gone: !window.__pairedEditor.getShape(id), count: window.__pairedEditor.getCurrentPageShapes().length }), made.id);
check('one undo takes the card (and its arrow) back', after.gone && after.count === before, JSON.stringify({ before, ...after }));

// Two of the person's thoughts: comparison. Move the first out of the way of the first board.
await p.evaluate((id) => { window.__pairedEditor.updateShape({ id, type: 'card', x: 200, y: 1400 }); }, card);
await p.evaluate(() => window.paired.select([]));
await press('n');
await press('Enter', 500);
await p.keyboard.type('Flat price, because it is simple to explain', { delay: 0 });
await press('Escape', 300);
const second = await p.evaluate(() => window.__pairedEditor.getOnlySelectedShapeId());
await p.evaluate((id) => { window.__pairedEditor.updateShape({ id, type: 'card', x: 600, y: 1400 }); }, second);
await p.evaluate(([a, b]) => { const ed = window.__pairedEditor; ed.select(a, b); ed.centerOnPoint(ed.getSelectionPageBounds().center, { animation: { duration: 0 } }); ed.focus(); }, [card, second]);
await p.waitForTimeout(PAUSE);
s = await seen();
check('two thoughts are offered comparison', s.shown && s.texts[0] === 'Compare these' && s.texts.length <= 2, JSON.stringify(s.texts));
check('placed clear of every object', s.covered.length === 0, JSON.stringify(s.covered));
await p.screenshot({ path: `${out}/4-two.png` });

// Something right under the card: the suggestions go around it, never on top.
const below = await command('create', { kind: 'note', x: 200, y: 1530, width: 300, text: 'An agent note right under it' });
await p.evaluate((id) => { window.paired.select([id]); window.__pairedEditor.focus(); }, card);
await p.waitForTimeout(PAUSE);
s = await seen();
check('with a note right under the card, suggestions are clear of it (or not shown)', !s.shown || s.covered.length === 0, JSON.stringify(s));
await p.screenshot({ path: `${out}/5-crowded.png` });

// Never on an agent's card.
await p.evaluate((id) => { window.paired.select([id]); window.__pairedEditor.focus(); }, below.id);
await p.waitForTimeout(PAUSE);
check('an agent\'s card gets no suggestions', !(await seen()).shown);
await p.evaluate(([a, b]) => { window.__pairedEditor.select(a, b); window.__pairedEditor.focus(); }, [card, below.id]);
await p.waitForTimeout(PAUSE);
check('a selection with an agent\'s card in it gets none', !(await seen()).shown);

// Never on a first-board card the person has not written over.
const seed = await p.evaluate(() => window.__pairedEditor.getCurrentPageShapes().find((s) => s.meta.seed === true && typeof s.meta.updatedAt !== 'number' && s.type !== 'arrow')?.id);
if (seed) {
  await p.evaluate((id) => { window.paired.select([id]); window.__pairedEditor.focus(); }, seed);
  await p.waitForTimeout(PAUSE);
  check('an untouched first-board card gets none', !(await seen()).shown);
}
check('no page errors', errors.length === 0, errors.join(' | '));

await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
