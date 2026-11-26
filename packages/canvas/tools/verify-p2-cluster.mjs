// Browser check for P2 (findings 2 and 3): arrangement carries meaning to the agent.
// Three of the person's cards sit in a row and one sits far away. The person writes a question
// under the middle card and sends it. The agent's view of the ask (`asks` over HTTP) must hold
// the row as its group, each card with where it sits ("above"), and not the far card. While the
// ask is worked on, the board outlines the group and the ask's line says so. A question written
// on the empty space at the end of the row is about the row too.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-p2-cluster.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`), with an empty board store.
import { createRequire } from 'node:module';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-p2-cluster.mjs <screenshot dir>');
const BASE = 'http://localhost:5183';
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
    body: JSON.stringify({ requestId: `p2-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
const make = (x, y, text) => p.evaluate(([x, y, text]) => window.paired.create({ kind: 'note', x, y, width: 220, text }), [x, y, text]).then((r) => (typeof r === 'string' ? r : r.id));
const bounds = (id) => p.evaluate((id) => { const b = window.__pairedEditor.getShapePageBounds(id); return { x: b.x, y: b.y, w: b.w, h: b.h, maxX: b.maxX, maxY: b.maxY }; }, id);
/** The person's card is the question: select it and send it with ⌘↵. */
async function send(id) {
  await p.evaluate((id) => window.paired.select([id]), id);
  await p.waitForTimeout(200);
  await p.keyboard.press('ControlOrMeta+Enter');
  await p.waitForTimeout(500);
  return (await command('asks', { state: 'all' })).asks.find((a) => a.id === id);
}

// Move the view away from the first board, then lay out the row.
await p.evaluate(() => void window.__pairedEditor.setCamera({ x: 0, y: -1200, z: 1 }));
const left = await make(140, 1400, 'Charge per seat');
const middle = await make(400, 1400, 'Charge per job post');
const right = await make(660, 1400, 'Flat yearly price');
const far = await make(1600, 1400, 'Office move in March');
const row = await bounds(middle);
const question = await make(400, row.maxY + 40, 'Which of these would you test first?');
const ask = await send(question);
const group = (ask?.cluster ?? []).map((m) => m.id), targets = (ask?.targets ?? []).map((t) => t.id);
// The card right beside the question is given as a target; the rest of the row as its group.
check('the ask is given the row its card sits in (beside it, or in its group)', [left, middle, right].every((id) => group.includes(id) || targets.includes(id)) && targets.includes(middle), JSON.stringify({ targets, group: ask?.cluster?.map((m) => [m.text, m.relation]) }));
check('and not the card far away', !group.includes(far));
check('each group member says where it sits, in words', (ask?.cluster ?? []).length >= 2 && ask.cluster.every((m) => ['left of', 'right of', 'above', 'under'].includes(m.relation)) && ask.cluster.find((m) => m.id === left)?.relation !== 'right of', JSON.stringify(ask?.cluster?.map((m) => [m.text, m.relation])));
check('nothing is given twice (a card beside the question is not also in its group)', group.every((id) => !(ask?.targets ?? []).some((t) => t.id === id)), JSON.stringify({ targets: ask?.targets?.map((t) => t.id), group }));

await command('ask_status', { id: question, state: 'working', note: 'reading the row' });
await p.evaluate(() => void window.__pairedEditor.selectNone());
await p.waitForTimeout(400);
const drawn = await p.evaluate(([ids, far]) => {
  const ed = window.__pairedEditor, el = document.querySelector('.ask-group');
  if (!el) return { ok: false, why: 'no group outline' };
  const r = el.getBoundingClientRect();
  const inside = (id) => { const b = ed.getShapePageBounds(id), a = ed.pageToScreen({ x: b.x, y: b.y }), z = ed.pageToScreen({ x: b.maxX, y: b.maxY }); return a.x >= r.left && a.y >= r.top && z.x <= r.right && z.y <= r.bottom; };
  return { ok: ids.every(inside) && !inside(far), r: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
}, [[left, middle, right, question], far]);
check('while the ask is worked on, the board outlines the group, not the far card', drawn.ok, JSON.stringify(drawn));
const line = await p.locator('.ask-status').last().innerText();
check('the ask\'s line says it gave the group', /2 more in its group/.test(line), line);
await p.screenshot({ path: `${out}/p2-cluster-working.png` });

// "About everything over here": a question on the empty space at the end of the row.
const end = await bounds(right);
const here = await make(end.maxX + 40, end.y, 'What do these have in common?');
const ask2 = await send(here);
const group2 = [...(ask2?.cluster ?? []).map((m) => m.id), ...(ask2?.targets ?? []).map((t) => t.id)];
check('a question written at the end of the row is about the whole row', [left, middle, right].every((id) => group2.includes(id)), JSON.stringify({ cluster: ask2?.cluster?.map((m) => m.text), targets: ask2?.targets?.map((t) => t.text) }));

// Answered and deselected: the outline goes, so the board stays calm.
await command('answer', { id: question, text: 'Per job post: it matches how often teams hire.' });
await p.evaluate(() => void window.__pairedEditor.selectNone());
await p.waitForTimeout(400);
check('once answered and not selected, no group outline stays on the board', await p.locator('.ask-group').count() === 0);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
