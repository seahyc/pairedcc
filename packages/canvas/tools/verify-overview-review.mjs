// Browser check for item 142 (bot review of #166 and #169, verified by reading the code):
// (a) the overview (O) never names a group after a thought Check me is covering, so opening O
//     does not give the answer away (a loose pile, and an imported record's group);
// (b) a folded thread inside a frame still counts in that frame's box, as it does on the page;
// (c) canvas_overview's clusters are the groups O draws: a frame is never in one cluster with
//     the loose pile beside it.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-overview-review.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`) with an empty board store (PAIRED_BOARDS_DIR
// set to a new folder).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-overview-review.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = 'http://localhost:5183';
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
  const res = await fetch(`${BASE}/api/canvas/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: `overview-review-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }) });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}

// The board, built as the person's own cards (no createdBy), on a cleared page.
const ids = await p.evaluate(() => {
  const ed = window.__pairedEditor;
  ed.deleteShapes([...ed.getCurrentPageShapeIds()]);
  const doc = (t) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
  let k = 0;
  const id = (name) => `shape:review-${name}-${++k}`;
  const card = (name, x, y, text, extra = {}) => {
    const sid = id(name);
    ed.createShape({ id: sid, type: 'card', x, y, ...(extra.parentId ? { parentId: extra.parentId } : {}), meta: { revision: 0, ...(extra.meta ?? {}) }, props: { w: 300, tone: 'human', richText: doc(text) } });
    return sid;
  };
  const frame = (name, x, y, w, h) => {
    const sid = id(name);
    ed.createShape({ id: sid, type: 'frame', x, y, meta: { revision: 0 }, props: { w, h, name } });
    return sid;
  };
  // (a) A loose pile whose first card in reading order is a settled thought, and a record (group).
  const canberra = card('canberra', 100, 100, 'Canberra is the capital of Australia', { meta: { settled: true } });
  const geo = card('geo', 100, 200, 'Geography facts to remember');
  const paris = card('paris', 100, 600, 'Paris is the capital of France', { meta: { settled: true } });
  const europe = card('europe', 100, 700, 'Europe trip notes');
  ed.groupShapes([paris, europe]);
  const record = ed.getShape(paris).parentId;
  // (b) The same thread twice: once inside a frame, once loose; both folded.
  const thread = (x, y, parentId) => {
    const ask = card('ask', x, y, 'Train or plane?', { parentId, meta: { ask: { question: 'Train or plane?', status: 'answered' }, fold: 'folded' } });
    const train = card('train', x, y + 100, 'Train: four hours, door to door', { parentId, meta: { replyTo: ask, createdBy: 'Agent', mark: 'picked' } });
    const plane = card('plane', x + 320, y + 100, 'Plane: two hours plus the airports', { parentId, meta: { replyTo: ask, createdBy: 'Agent' } });
    const pack = card('pack', x, y + 220, 'Pack light', { parentId });
    return { ask, train, plane, pack };
  };
  const trip = frame('Trip', 1000, 100, 720, 380);
  const inFrame = thread(40, 40, trip);
  const loose = thread(1040, 700);
  // (c) A frame with a loose pile right beside it (within 60 px).
  const kitchen = frame('Kitchen', 100, 1100, 400, 260);
  card('cupboards', 40, 40, 'Cupboards: keep the old ones', { parentId: kitchen });
  const tiles = card('tiles', 540, 1100, 'Tiles quote: £1,200');
  const paint = card('paint', 540, 1200, 'Paint quote: £400');
  ed.selectNone();
  return { canberra, geo, paris, europe, record, trip, inFrame, loose, kitchen, tiles, paint };
});
await p.waitForTimeout(300);

// Check me on each settled thought (E), as the person would.
for (const id of [ids.canberra, ids.paris]) {
  await p.evaluate((id) => { window.__pairedEditor.select(id); }, id);
  await p.waitForTimeout(150);
  await p.keyboard.press('e');
  await p.waitForTimeout(300);
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await p.evaluate(() => { window.__pairedEditor.selectNone(); });
  await p.waitForTimeout(150);
}
const covered = await p.evaluate(() => window.__pairedEditor.getCurrentPageShapes().filter((s) => s.type === 'prompt' && s.props.status === 'open').map((s) => s.meta.check));
check('Check me is open on both settled thoughts', covered.includes(ids.canberra) && covered.includes(ids.paris), JSON.stringify(covered));

// Open O.
await p.mouse.click(1300, 860);
await p.keyboard.press('Escape');
await p.keyboard.press('o');
await p.waitForSelector('.overview-dialog', { timeout: 5000 });
await p.waitForTimeout(300);
const boxes = await p.evaluate(() => [...document.querySelectorAll('.overview-group')].map((el) => ({ label: el.querySelector('.overview-label')?.textContent ?? '', counts: el.querySelector('.overview-counts')?.textContent ?? '' })));
await p.screenshot({ path: `${out}/overview-review.png` });
const labels = boxes.map((b) => b.label);
check('(a) no group in O is named after a covered thought', !labels.some((l) => /Canberra|Paris/.test(l)), labels.join(' | '));
check('(a) the pile is named by its next words instead', labels.some((l) => /Geography facts/.test(l)), labels.join(' | '));
const tripBox = boxes.find((b) => b.label === 'Trip');
const looseBox = boxes.find((b) => /^Train|Pack light/.test(b.label) && b.label !== 'Trip');
check('(b) a folded thread inside a frame counts in its box as the same thread does on the page', Boolean(tripBox && looseBox) && tripBox.counts === looseBox.counts, `Trip: ${tripBox?.counts}; loose copy (${looseBox?.label}): ${looseBox?.counts}`);
await p.keyboard.press('Escape');

// (c) canvas_overview's clusters against O's groups.
const ov = await command('overview', {});
const frameIds = new Set(ov.objects.filter((o) => o.type === 'frame').map((o) => o.id));
const mixed = ov.clusters.filter((c) => c.ids.some((id) => frameIds.has(id)) && c.ids.some((id) => !frameIds.has(id)));
check('(c) no canvas_overview cluster holds a frame together with the loose pile beside it', mixed.length === 0, mixed.map((c) => `${c.label}: ${c.ids.length} ids`).join(' | '));
const pile = ov.clusters.find((c) => c.ids.includes(ids.tiles));
check('(c) the pile beside the frame is a cluster of its own two cards, named as O names it', Boolean(pile) && pile.ids.length === 2 && pile.ids.includes(ids.paint) && labels.includes(pile.label), pile && `${pile.label}: ${JSON.stringify(pile.ids)}; O: ${labels.join(' | ')}`);
const every = ov.clusters.every((c) => labels.includes(c.label));
check('(c) every canvas_overview cluster label is a box in O', every, ov.clusters.map((c) => c.label).join(' | '));

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
