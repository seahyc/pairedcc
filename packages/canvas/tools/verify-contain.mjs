// Browser check: text never leaves its container, and the next step stays on screen.
//
// On a fresh profile, at 1440 x 900 and 390 x 844: a long URL and a long unbroken word in the
// person's card, a comment, a note, a code note and plain text must stay inside their shapes;
// the selection bar (Ask, Pick, Cross out, Comment) and the card an ask opens for its question
// must sit wholly inside the window wherever the selection is; and an ask's state line must stay
// on screen.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-contain.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm --filter @pairedcc/canvas dev`). No agent is needed; the
// check makes one note as an agent through the dev relay.
// Playwright is not a dependency of this repository; it is loaded from the directory you run
// this in. Exits non-zero if any check fails.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');

const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-contain.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const URL = process.env.CANVAS_URL ?? 'http://localhost:5183/canvas/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const longUrl = 'https://example.org/research/notes/' + 'a1b2c3d4e5'.repeat(10) + '?ref=board';
const longWord = 'Pneumonoultramicroscopicsilicovolcanoconiosis'.repeat(3);

/** Text elements inside shapes that run past their shape's edge, or scroll sideways unseen. */
const spills = (p) => p.evaluate(() => [...document.querySelectorAll('.tl-shape')].flatMap((el) => {
  const type = el.getAttribute('data-shape-type');
  if (type === 'arrow' || type === 'frame') return [];
  const box = el.getBoundingClientRect();
  return [...el.querySelectorAll('.tl-rich-text, .tl-text-label__inner, p, pre, code')].flatMap((t) => {
    const r = t.getBoundingClientRect();
    if (!r.width || !t.textContent.trim()) return [];
    const scrollsHidden = t.scrollWidth > t.clientWidth + 1 && getComputedStyle(t).overflowX === 'visible';
    const bad = scrollsHidden || r.right > box.right + 2 || r.left < box.left - 2 || r.bottom > box.bottom + 2;
    return bad ? [`${type} "${t.textContent.slice(0, 24)}…" text ${Math.round(r.left)}–${Math.round(r.right)} in shape ${Math.round(box.left)}–${Math.round(box.right)}`] : [];
  });
}));

/** How far an element sits outside the window, and whether its own content is clipped. */
const fit = (p, selector) => p.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const kids = [...el.querySelectorAll('button, input')].map((k) => k.getBoundingClientRect());
  const kidsOut = kids.filter((k) => k.width && (k.right > r.right + 1 || k.left < r.left - 1)).length;
  return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight, kidsOut };
}, selector);
const inWindow = (f) => Boolean(f) && f.left >= 0 && f.right <= f.vw && f.top >= 0 && f.bottom <= f.vh && f.kidsOut === 0;
const where = (f) => (f ? `${f.left}–${f.right} of ${f.vw} px, ${f.kidsOut} controls outside it` : 'not shown');

const BASE = new globalThis.URL(URL).origin;
let n = 0;
/** One operation through the dev relay, as the agent "Verifier", on the page's own session. */
async function command(page, op, input) {
  const sessionId = await page.evaluate(() => document.documentElement.dataset.pairedSession ?? null);
  const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
  const list = sessions.sessions ?? sessions;
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `contain-${Date.now()}-${++n}`, sessionId: sessionId ?? list.at(-1)?.id ?? list.at(-1)?.sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}

const browser = await chromium.launch();
for (const [vw, vh] of [[1440, 900], [390, 844]]) {
  const tag = `${vw}px`;
  const p = await browser.newPage({ viewport: { width: vw, height: vh } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  await p.goto(URL);
  await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 20000 });
  await p.waitForTimeout(800);
  // Clear the first board so every check is about the shapes made here.
  await p.evaluate(() => {
    const ed = window.__pairedEditor;
    ed.deleteShapes([...ed.getCurrentPageShapeIds()]);
    ed.setCamera({ x: 0, y: 0, z: 1 });
  });

  // The person writes a card holding a long URL.
  await p.mouse.dblclick(vw < 500 ? 90 : 200, 160);
  await p.waitForTimeout(400);
  await p.keyboard.type(`Read ${longUrl}`, { delay: 0 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const card = await p.evaluate(() => window.paired.read().objects.find((o) => o.type === 'card')?.id);
  check(`${tag}: the person's card was made`, Boolean(card));

  // A comment on it holding a long unbroken word.
  await p.evaluate((id) => window.paired.select([id]), card);
  await p.waitForTimeout(200);
  await p.keyboard.press('c');
  await p.waitForTimeout(500);
  await p.keyboard.type(`Also ${longWord}`, { delay: 0 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);

  // Agent-made shapes and plain text, placed below.
  await p.evaluate(({ longUrl, longWord }) => {
    const P = window.paired;
    P.create({ kind: 'note', x: 20, y: 700, text: longWord });
    P.create({ kind: 'note', x: 260, y: 700, style: 'code', text: `const x = ${'veryLongIdentifierName'.repeat(8)};` });
    P.create({ kind: 'text', x: 20, y: 980, text: longUrl });
  }, { longUrl, longWord });
  await p.waitForTimeout(600);
  // Look at everything at a scale where it is all on screen, then check containment.
  await p.evaluate(() => { window.__pairedEditor.zoomToFit({ animation: { duration: 0 } }); });
  await p.waitForTimeout(500);
  const spilled = await spills(p);
  check(`${tag}: unbroken text stays inside every card, comment, note and text`, spilled.length === 0, spilled.slice(0, 3).join('; '));
  await p.screenshot({ path: `${out}/${tag}-1-unbroken-text.png` });

  // The selection bar, and the card an ask opens for its question, with the selection at the
  // left, middle and right. (The card is the question: asking about an agent's note opens a pink
  // card beside it, in typing mode, where the question is written.)
  const agentNote = await command(p, 'create', { kind: 'note', x: 0, y: 0, width: 260, text: 'An agent note to ask about' });
  const noteId = agentNote.id ?? agentNote.object?.id ?? agentNote;
  await p.evaluate(() => { window.__pairedEditor.setCamera({ x: 0, y: 0, z: 1 }); });
  for (const [pos, x] of [['left', 0.05], ['middle', 0.45], ['right', 0.8]]) {
    for (const id of [card, noteId]) {
      await p.evaluate(({ id, x }) => {
        const ed = window.__pairedEditor;
        const shape = ed.getShape(id);
        ed.updateShape({ id, type: shape.type, x: ed.getViewportPageBounds().x + ed.getViewportPageBounds().w * x, y: ed.getViewportPageBounds().y + (shape.meta.createdBy ? 520 : 220) });
      }, { id, x });
    }
    await p.evaluate((id) => { window.__pairedEditor.selectNone(); window.paired.select([id]); }, card);
    await p.waitForTimeout(300);
    const bar = await fit(p, '.selection-bar');
    check(`${tag}: selection bar on screen, selection at the ${pos}`, inWindow(bar), where(bar));
    await p.evaluate((id) => { window.__pairedEditor.selectNone(); window.paired.select([id]); }, noteId);
    await p.waitForTimeout(300);
    await p.click('.selection-bar > button.primary');
    await p.waitForTimeout(400);
    const opened = await p.evaluate(() => {
      const ed = window.__pairedEditor, id = ed.getEditingShapeId();
      const b = id && ed.getShapePageBounds(id);
      if (!b) return null;
      const a = ed.pageToScreen({ x: b.x, y: b.y }), z = ed.pageToScreen({ x: b.maxX, y: b.maxY });
      return { left: Math.round(a.x), right: Math.round(z.x), top: Math.round(a.y), bottom: Math.round(z.y), vw: innerWidth, vh: innerHeight, kidsOut: 0 };
    });
    check(`${tag}: the card opened for the question is on screen, selection at the ${pos}`, inWindow(opened), where(opened));
    if (pos === 'right') await p.screenshot({ path: `${out}/${tag}-2-question-card-right.png` });
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
  }

  // Send an ask from the right-hand selection; with no agent its state line says so.
  // The person's card is the question: Ask sends it as it is.
  await p.evaluate((id) => window.paired.select([id]), card);
  await p.waitForTimeout(200);
  await p.click('.selection-bar > button.primary');
  await p.waitForSelector('.ask-status', { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(800);
  const status = await fit(p, '.ask-status');
  const statusText = await p.evaluate(() => document.querySelector('.ask-status')?.textContent ?? '');
  const statusClipped = await p.evaluate(() => {
    const el = document.querySelector('.ask-status span:not(.ask-pulse)');
    return el ? el.scrollWidth > el.clientWidth + 1 : false;
  });
  check(`${tag}: the ask's state line is on screen and whole`, Boolean(status) && status.left >= 0 && status.right <= status.vw && !statusClipped, `${where(status)}${statusClipped ? ', text clipped' : ''}: ${statusText.slice(0, 80)}`);
  await p.screenshot({ path: `${out}/${tag}-3-ask-state.png` });
  check(`${tag}: no page errors`, errs.length === 0, errs.join(' | '));
  await p.close();
}
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
