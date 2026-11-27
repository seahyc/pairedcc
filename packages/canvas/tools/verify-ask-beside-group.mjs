// Browser check for item 129: the group an ask gives starts from the card beside the question.
// The person writes two ideas side by side, 40 px apart, by double-clicking the board as people
// do, then writes a question 40 px under the first idea and finishes it (a card ending in "?" is
// sent as it is finished). The agent's view of the ask (`asks` over HTTP) must give the first
// idea as a target, right beside the question ("above"), and the second idea, which the question
// names, in its group, so an agent never needs a text search to find it.
//
// It also sets up the board as eval task 29 did (`create` with kind "note" from the person) and
// prints what that board really is: the person's `create` makes 200 px sticky notes whatever
// `width` says, so the two ideas sit 80 px apart, beyond the group gap. That is why the ask in
// #170's attempt had no group; it is printed as INFO, not judged.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-ask-beside-group.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`), with an empty board store.
import { createRequire } from 'node:module';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-ask-beside-group.mjs <screenshot dir>');
const BASE = process.env.PAIRED_URL ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 20000 });
await p.waitForTimeout(800);

let n = 0;
async function command(op, input) {
  const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
  const list = sessions.sessions ?? sessions;
  const sessionId = list[list.length - 1]?.id ?? list[list.length - 1]?.sessionId;
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `beside-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
const bounds = (id) => p.evaluate((id) => { const b = window.__pairedEditor.getShapePageBounds(id); return { x: b.x, y: b.y, w: b.w, h: b.h, maxX: b.maxX, maxY: b.maxY }; }, id);
/** Write a card as the person does: double-click the board where its corner should be, type, Esc. */
async function write(x, y, text) {
  const before = await p.evaluate(() => window.__pairedEditor.getCurrentPageShapeIds().size);
  // A double-click makes the card 24 px left of and 28 px above the pointer.
  const at = await p.evaluate(([x, y]) => window.__pairedEditor.pageToScreen({ x: x + 24, y: y + 28 }), [x, y]);
  await p.mouse.dblclick(at.x, at.y);
  await p.waitForTimeout(250);
  await p.keyboard.type(text, { delay: 2 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const id = await p.evaluate(() => window.__pairedEditor.getSelectedShapeIds()[0] ?? [...window.__pairedEditor.getCurrentPageShapeIds()].pop());
  const after = await p.evaluate(() => window.__pairedEditor.getCurrentPageShapeIds().size);
  if (after !== before + 1) throw new Error(`writing "${text}" made ${after - before} objects`);
  return id;
}

// An empty stretch of board, away from the first board's cards.
await p.evaluate(() => void window.__pairedEditor.setCamera({ x: 0, y: -1200, z: 1 }));
await p.evaluate(() => void window.__pairedEditor.selectNone());
const idea1 = await write(200, 1400, 'Charge per seat: £8 a month for each recruiter on the account');
const b1 = await bounds(idea1);
const idea2 = await write(b1.maxX + 40, 1400, 'Charge per job post: £30 a post, capped at £300 a month');
const b2 = await bounds(idea2);
const far = await write(b2.maxX + 260, 1400, 'Office move in March');
// Line the two ideas up at the top and keep the 40 px gap whatever their heights.
check('the person wrote two cards side by side, 40 px apart', Math.round(b2.x - b1.maxX) === 40 && Math.abs(b2.y - b1.y) < 2, JSON.stringify({ idea1: b1, idea2: b2 }));
const top = Math.max(b1.maxY, b2.maxY);
await p.evaluate(() => void window.__pairedEditor.selectNone());
// Finishing a card that ends in "?" sends it.
const question = await write(b1.x, top + 40, 'Seat or job post: which should we test first?');
await p.waitForTimeout(600);
const bq = await bounds(question);
const ask = (await command('asks', { state: 'all' })).asks.find((a) => a.id === question);
check('finishing the question sent it', Boolean(ask), JSON.stringify({ question: bq }));
const targets = (ask?.targets ?? []).map((t) => t.id), group = (ask?.cluster ?? []).map((m) => m.id);
check('the first idea is given right beside the question, above it', targets.includes(idea1) && ask.targets.find((t) => t.id === idea1)?.relation === 'above', JSON.stringify(ask?.targets?.map((t) => [t.text?.slice(0, 24), t.relation])));
check('the second idea, which the question names, is in the group the ask gives', group.includes(idea2) || targets.includes(idea2), JSON.stringify(ask?.cluster?.map((m) => [m.text?.slice(0, 24), m.relation])));
check('each is given once (a target is not repeated in the group)', group.every((id) => !targets.includes(id)));
check('the card far away is not given', !group.includes(far) && !targets.includes(far));
await command('ask_status', { id: question, state: 'working', note: 'reading both ideas' });
await p.evaluate(() => void window.__pairedEditor.selectNone());
await p.waitForTimeout(400);
const drawn = await p.evaluate(([ids, far]) => {
  const ed = window.__pairedEditor, el = document.querySelector('.ask-group');
  if (!el) return { ok: false, why: 'no group outline' };
  const r = el.getBoundingClientRect();
  const inside = (id) => { const b = ed.getShapePageBounds(id), a = ed.pageToScreen({ x: b.x, y: b.y }), z = ed.pageToScreen({ x: b.maxX, y: b.maxY }); return a.x >= r.left - 1 && a.y >= r.top - 1 && z.x <= r.right + 1 && z.y <= r.bottom + 1; };
  return { ok: ids.every(inside) && !inside(far), r: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
}, [[idea1, idea2, question], far]);
check('while it is worked on, the board outlines both ideas and the question, not the far card', drawn.ok, JSON.stringify(drawn));
await p.screenshot({ path: `${out}/ask-beside-group.png` });

// Eval task 29's setup, for the record: the person's `create` with kind "note".
await p.evaluate(() => void window.__pairedEditor.setCamera({ x: 0, y: -3200, z: 1 }));
const note = (x, y, text) => p.evaluate(([x, y, text]) => window.paired.create({ kind: 'note', x, y, width: 240, text }), [x, y, text]).then((r) => (typeof r === 'string' ? r : r.id));
const n1 = await note(0, 3400, 'Charge per seat');
const n2 = await note(280, 3400, 'Charge per job post');
const nq = await note(0, 3570, 'Seat or job post: which should we test first?');
const [s1, s2, sq] = [await bounds(n1), await bounds(n2), await bounds(nq)];
const types = await p.evaluate((ids) => ids.map((id) => window.__pairedEditor.getShape(id).type), [n1, n2, nq]);
console.log(`INFO  task 29's board: ${types.join(', ')} shapes, ${s1.w}x${s1.h} (width 240 was asked), ideas ${Math.round(s2.x - s1.maxX)} px apart, question ${sq.y < s1.maxY ? 'overlapping' : Math.round(sq.y - s1.maxY) + ' px under'} the first idea`);

console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length && !errors.length ? 0 : 1);
