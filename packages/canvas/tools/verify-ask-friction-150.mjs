// Browser check for item 150, friction from the focused attempt on tasks 33 and 34 (#202):
// (a) a question in the middle of a ring of ten cards is given the whole ring, with no clusterMore;
// (c) a question written just under another question gives that one as context marked
//     `question: true`, and the person's other cards without it;
// (d) canvas_answer's result says where the answer went: `under`, or `right of` when the space
//     under the ask was taken.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-ask-friction-150.mjs <screenshot dir>
//
// Needs the dev server (`pnpm dev:canvas`, CANVAS_BASE to use another origin) with an empty
// board store (PAIRED_BOARDS_DIR set to a new folder).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-ask-friction-150.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await p.waitForTimeout(800);
const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
const list = sessions.sessions ?? sessions;
const sessionId = list[list.length - 1].id ?? list[list.length - 1].sessionId;
let n = 0;
async function command(op, input) {
  const res = await fetch(`${BASE}/api/canvas/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: `friction-150-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }) });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
const note = async (x, y, width, text) => {
  const r = await p.evaluate((a) => window.paired.create({ kind: 'note', ...a }), { x, y, width, text });
  return typeof r === 'string' ? r : r.id;
};
const send = async (id) => {
  await p.evaluate((id) => { const ed = window.__pairedEditor; ed.setCurrentTool('select'); ed.select(id); }, id);
  await p.waitForTimeout(200);
  await p.keyboard.press('ControlOrMeta+Enter');
  await p.waitForTimeout(500);
};
const askOf = async (id) => ((await command('asks', { state: 'all' })).asks ?? []).find((a) => a.id === id);

// (a) Ten venues in a ring, the question in the middle, more than 60 px from each (task 33's board).
const spots = [[0, 0], [300, 0], [600, 0], [0, 110], [600, 110], [0, 220], [600, 220], [0, 330], [300, 330], [600, 330]];
const ring = [];
for (const [i, [x, y]] of spots.entries()) ring.push(await note(2000 + x, y, 240, `Venue ${i + 1}: £${900 + i * 50}`));
const middle = await note(2320, 160, 200, 'Which of these is cheapest?');
await send(middle);
const a = await askOf(middle);
const given = (a?.cluster ?? []).map((m) => m.id);
check('(a) a question inside a ring of ten is given all ten', ring.every((id) => given.includes(id)), `${given.length} given, clusterMore ${a?.clusterMore ?? 0}`);
check('(a) and nothing is left to count', !a?.clusterMore);

// (c), (d) Two cards, then two questions, the second 24 px under the first (task 34's board).
const cards = [await note(0, 1000, 260, 'Inkwell 300: 2p a page, 18 pages a minute'), await note(300, 1000, 260, 'Laserline X: 4p a page, 40 pages a minute')];
const cost = await note(0, 1160, 300, 'Which is cheaper per page?');
await send(cost);
const below = await p.evaluate((id) => { const b = window.__pairedEditor.getShapePageBounds(id); return Math.round(b.y + b.h); }, cost);
const speed = await note(0, below + 24, 300, 'Which prints faster?');
await send(speed);
const s = await askOf(speed);
const asTarget = (s?.targets ?? []).find((t) => t.id === cost);
check('(c) the question above is given to the second ask', Boolean(asTarget), JSON.stringify((s?.targets ?? []).map((t) => t.text)));
check('(c) marked as another question', asTarget?.question === true, JSON.stringify(asTarget));
const plain = [...(s?.targets ?? []), ...(s?.cluster ?? [])].filter((t) => cards.includes(t.id));
check("(c) the person's printer cards are not marked", plain.length > 0 && plain.every((t) => !t.question), JSON.stringify(plain.map((t) => [t.text.slice(0, 12), t.question ?? false])));
check('(c) the ask never marks its own card', ![...(s?.targets ?? []), ...(s?.cluster ?? [])].some((t) => t.id === speed));

const first = await command('answer', { id: cost, text: 'Inkwell 300: 2p a page against 4p.' });
check('(d) the first answer says it went beside its ask, the space under it being taken', first.placed === 'right of', JSON.stringify(first.placed));
const second = await command('answer', { id: speed, text: 'Laserline X: 40 pages a minute.' });
check('(d) the second says it went under its ask', second.placed === 'under', JSON.stringify(second.placed));
const truth = await p.evaluate(([ask, answer]) => {
  const ed = window.__pairedEditor, q = ed.getShapePageBounds(ask), b = ed.getShapePageBounds(answer);
  return b.x >= q.maxX ? 'right of' : b.y >= q.maxY ? 'under' : 'other';
}, [cost, first.answers[0].id]);
check('(d) and that is where it is on the board', truth === first.placed, truth);
await p.evaluate((ids) => { window.__pairedEditor.zoomToBounds(window.__pairedEditor.getShapePageBounds(ids[0]).union(window.__pairedEditor.getShapePageBounds(ids[1])).expandBy(80)); }, [cards[0], second.answers[0].id]);
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/stacked-answers.png` });
check('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
