// Browser check for item 120: suggestions follow what the thought says.
//
// On a fresh profile at 1440 x 900 the person writes four thoughts, one at a time, each selected
// and left alone for a moment: a proposal, a number, a short list, and a plain thought with no cue;
// then a Spanish proposal and a Chinese reason (item 149).
// The first suggestion under each must follow its words (what would make it wrong; where the
// number comes from; which matters most) and the second must be the usual "What's missing?"; the
// plain thought keeps "What's missing?" and "Give me alternatives". Clicking the cued suggestion
// writes exactly that question as the person's card, sent as an ask.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-suggest-cues.mjs <screenshot dir>
//
// Needs a dev server for this checkout with an empty board store. No model is needed.
// Exits non-zero if any check fails.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-suggest-cues.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'suggest-cues-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await p.waitForTimeout(1500);

/** Write a thought, move it to a clear spot in view, select it and wait; return what is suggested. */
async function suggestedFor(text, x, y) {
  await p.evaluate(() => window.paired.select([]));
  await p.keyboard.press('n');
  await p.waitForTimeout(300);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    await p.keyboard.type(line, { delay: 0 });
    if (i < lines.length - 1) await p.keyboard.press('Shift+Enter');
  }
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  const id = await p.evaluate(() => window.__pairedEditor.getOnlySelectedShapeId());
  await p.evaluate(([id, x, y]) => {
    const ed = window.__pairedEditor;
    ed.updateShape({ id, type: 'card', x, y });
    ed.selectNone();
  }, [id, x, y]);
  await p.waitForTimeout(200);
  await p.evaluate((id) => { window.paired.select([id]); window.__pairedEditor.focus(); }, id);
  await p.waitForTimeout(1900);
  const texts = await p.evaluate(() => [...document.querySelectorAll('.suggestions button')].map((b) => b.textContent));
  return { id, texts };
}

// Lay the thoughts out well apart, under the first board.
const origin = await p.evaluate(() => {
  const ed = window.__pairedEditor, all = ed.getCurrentPageShapes().map((s) => ed.getShapePageBounds(s));
  return { x: Math.min(...all.map((b) => b.x)), y: Math.max(...all.map((b) => b.maxY)) + 120 };
});
await p.evaluate((o) => { const ed = window.__pairedEditor; ed.centerOnPoint({ x: o.x + 500, y: o.y + 250 }, { animation: { duration: 0 } }); }, origin);

const proposal = await suggestedFor('We should drop the free plan', origin.x, origin.y);
check('a proposal: what would make it wrong, then the usual next step', proposal.texts[0] === 'What would make this wrong?' && proposal.texts[1] === "What's missing?", JSON.stringify(proposal.texts));
await p.screenshot({ path: `${out}/1-proposal.png` });
const number = await suggestedFor('Churn is 4% a month', origin.x + 520, origin.y);
check('a number: where it comes from', number.texts[0] === 'Where does this number come from?' && number.texts[1] === "What's missing?", JSON.stringify(number.texts));
await p.screenshot({ path: `${out}/2-number.png` });
const list = await suggestedFor('Price\nSupport\nSpeed', origin.x, origin.y + 320);
check('a list: which matters most', list.texts[0] === 'Which of these matters most?' && list.texts[1] === "What's missing?", JSON.stringify(list.texts));
const plain = await suggestedFor('Charge per seat', origin.x + 520, origin.y + 320);
check('a plain thought keeps the usual pair', plain.texts[0] === "What's missing?" && plain.texts[1] === 'Give me alternatives', JSON.stringify(plain.texts));
await p.screenshot({ path: `${out}/3-plain.png` });
// Item 149: a proposal or a reason in another language invites the same suggestion as in English.
await p.evaluate((o) => { window.__pairedEditor.centerOnPoint({ x: o.x + 500, y: o.y + 860 }, { animation: { duration: 0 } }); }, origin);
const spanish = await suggestedFor('Deberíamos quitar el plan gratis', origin.x, origin.y + 640);
check('a proposal in Spanish: what would make it wrong', spanish.texts[0] === 'What would make this wrong?' && spanish.texts[1] === "What's missing?", JSON.stringify(spanish.texts));
await p.screenshot({ path: `${out}/3b-spanish-proposal.png` });
const chinese = await suggestedFor('按席位收费，因为成本随团队增长', origin.x + 520, origin.y + 640);
check('a reason in Chinese: the strongest objection', chinese.texts[0] === "What's the strongest objection?" && chinese.texts[1] === "What's missing?", JSON.stringify(chinese.texts));
await p.screenshot({ path: `${out}/3c-chinese-reason.png` });

// Clicking the cued suggestion writes exactly that question, sent as an ask about the thought.
await p.evaluate((id) => { window.paired.select([]); }, number.id);
await p.waitForTimeout(200);
await p.evaluate((id) => { window.paired.select([id]); window.__pairedEditor.focus(); }, number.id);
await p.waitForTimeout(1900);
await p.locator('.suggestions button', { hasText: 'Where does this number come from?' }).click();
await p.waitForTimeout(600);
const made = await p.evaluate((cardId) => {
  const ed = window.__pairedEditor, shape = ed.getCurrentPageShapes().find((s) => s.meta.ask && (s.meta.targetIds ?? []).includes(cardId));
  const text = shape ? shape.props.richText.content.map((b) => (b.content ?? []).map((t) => t.text).join('')).join('\n') : '';
  return shape ? { text, author: shape.meta.author, state: shape.meta.ask.state } : null;
}, number.id);
check('clicking it writes that question as the person\'s card, sent as an ask', made?.text === 'Where does this number come from?' && made.author === 'Human' && made.state === 'waiting', JSON.stringify(made));
await p.screenshot({ path: `${out}/4-chosen.png` });
check('no page errors', errors.length === 0, errors.join(' | '));

await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
