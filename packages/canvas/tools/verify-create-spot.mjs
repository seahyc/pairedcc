// Browser check for item 141: `canvas_create` without x/y puts the object in the person's view,
// beside their selection when there is one, clear of everything; with x/y nothing changes.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-create-spot.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`; another port through CANVAS_BASE) with an empty board store (PAIRED_BOARDS_DIR
// set to a new folder).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-create-spot.mjs <screenshot dir>');
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
async function send(op, input) {
  const res = await fetch(`${BASE}/api/canvas/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: `create-spot-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }) });
  return res.json();
}
async function command(op, input) {
  const body = await send(op, input);
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
const bounds = (id) => p.evaluate((id) => { const b = window.__pairedEditor.getShapePageBounds(id); return b && { x: b.x, y: b.y, w: b.w, h: b.h }; }, id);
const view = () => p.evaluate(() => { const v = window.__pairedEditor.getViewportPageBounds(); return { x: v.x, y: v.y, w: v.w, h: v.h }; });
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a, v) => a.x >= v.x - 0.5 && a.y >= v.y - 0.5 && a.x + a.w <= v.x + v.w + 0.5 && a.y + a.h <= v.y + v.h + 0.5;
const gap = (a, b) => Math.hypot(Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)));
const covered = async (id) => {
  const nb = await bounds(id);
  const others = await p.evaluate((me) => window.paired.read().objects.filter((o) => o.id !== me && o.type !== 'arrow' && o.type !== 'frame' && o.bounds).map((o) => ({ id: o.id, text: (o.text ?? '').slice(0, 30), ...o.bounds })), id);
  return others.filter((o) => overlaps(nb, o));
};

// 1. Nothing selected: the middle of the view, over the calm first board's own cards if need be, clear of them.
await p.evaluate(() => { window.__pairedEditor.selectNone(); });
const v1 = await view();
const a = await command('create', { kind: 'note', text: 'A note that belongs to nothing in particular' });
const ab = await bounds(a.id);
check('without x/y and nothing selected, the note is wholly in the person\'s view', inside(ab, v1), `${JSON.stringify(ab)} in ${JSON.stringify(v1)}`);
const ac = await covered(a.id);
check('it covers nothing', ac.length === 0, ac.map((o) => o.text || o.id).join(' | '));
const b = await command('create', { kind: 'note', text: 'A second free note' });
const bb = await bounds(b.id);
const bc = await covered(b.id);
check('a second free note is in view and covers nothing, not even the first', inside(bb, await view()) && bc.length === 0, `${JSON.stringify(bb)}; covers ${bc.map((o) => o.text || o.id).join(' | ')}`);

// 2. The person selects a card of their own: the next note goes beside it.
const mine = await p.evaluate(() => {
  const v = window.__pairedEditor.getViewportPageBounds();
  const id = window.paired.create({ kind: 'rectangle', x: v.x + 80, y: v.y + v.h - 260, width: 260, height: 120, text: 'My own thought' });
  window.paired.select([id]);
  return id;
});
const mb = await bounds(mine);
const c = await command('create', { kind: 'note', text: 'Beside the selection' });
const cb = await bounds(c.id);
check('with the person\'s card selected, the note goes beside it', gap(cb, mb) <= 120, `gap ${Math.round(gap(cb, mb))} px; note ${JSON.stringify(cb)}, card ${JSON.stringify(mb)}`);
const cc = await covered(c.id);
check('in view and covering nothing', inside(cb, await view()) && cc.length === 0, cc.map((o) => o.text || o.id).join(' | '));

// Nothing placed sits under the tool strip, the zoom bar or the undo buttons.
const underControls = await p.evaluate((ids) => {
  const e = window.__pairedEditor;
  const controls = [...document.querySelectorAll('.topbar, .tool-strip, .bottom-left, .zoom-controls')].map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
  return ids.filter((id) => {
    const b = e.getShapePageBounds(id), a = e.pageToScreen({ x: b.x, y: b.y }), z = e.pageToScreen({ x: b.maxX, y: b.maxY });
    return controls.some((r) => a.x < r.right && z.x > r.left && a.y < r.bottom && z.y > r.top);
  });
}, [a.id, b.id, c.id]);
check('nothing placed sits under the window\'s controls', underControls.length === 0, underControls.join(' | '));

// 3. A frame without coordinates: in view, and it does not cover a card.
await p.evaluate(() => { window.__pairedEditor.selectNone(); });
const f = await command('create', { kind: 'frame', name: 'Free frame', width: 360, height: 200 });
const fb = await bounds(f.id);
const fc = await covered(f.id);
check('a frame without x/y is in view and covers no card', inside(fb, await view()) && fc.length === 0, `${JSON.stringify(fb)}; covers ${fc.map((o) => o.text || o.id).join(' | ')}`);

// 4. With x/y nothing changes.
const d = await command('create', { kind: 'note', x: 5000, y: 6000, text: 'Placed by the agent' });
const db = await bounds(d.id);
check('with x and y the object is exactly there', Math.round(db.x) === 5000 && Math.round(db.y) === 6000, JSON.stringify(db));

// 5. Only one of x and y is refused, saying why.
const half = await send('create', { kind: 'note', x: 10, text: 'half' });
check('only x is refused with a reason', half.ok === false && /both x and y/i.test(JSON.stringify(half)), JSON.stringify(half).slice(0, 160));

// 6. One undo takes the placed note away.
const before = await p.evaluate(() => window.paired.read().objects.length);
const e = await command('create', { kind: 'note', text: 'Undo me' });
await p.evaluate(() => { window.__pairedEditor.undo(); });
const after = await p.evaluate((id) => ({ n: window.paired.read().objects.length, gone: !window.__pairedEditor.getShape(id) }), e.id);
check('one undo removes a placed note', after.gone && after.n === before, JSON.stringify(after));

// 7. An unlocked frame over the page origin, the view elsewhere: what is created without x/y is not
// taken into that frame (it would be clipped by it wherever it is placed), for a card and a primitive.
const originFrame = await p.evaluate(() => {
  const id = window.paired.create({ kind: 'frame', name: 'Over the origin', x: -300, y: -300, width: 900, height: 900 });
  const e = window.__pairedEditor;
  e.selectNone();
  e.setCamera({ x: -20000, y: -15000, z: 1 });
  return id;
});
for (const input of [{ kind: 'note', text: 'Made far from the origin' }, { kind: 'rectangle', width: 200, height: 120, text: 'A box far from the origin' }]) {
  const made = await command('create', input);
  const st = await p.evaluate(({ id, frame }) => {
    const e = window.__pairedEditor, s = e.getShape(id), v = e.getViewportPageBounds(), b = e.getShapePageBounds(id);
    return { pageChild: s.parentId === e.getCurrentPageId(), inFrame: s.parentId === frame, masked: !!e.getShapeMask(id), inView: v.contains(b) };
  }, { id: made.id, frame: originFrame });
  check(`a ${input.kind} without x/y with a frame over the origin is a page child, visible in view`, st.pageChild && !st.masked && st.inView, JSON.stringify(st));
}

// 8. A new frame without x/y does not cover an existing, unselected frame in the middle of the view.
const midFrame = await p.evaluate(() => {
  const e = window.__pairedEditor;
  e.setCamera({ x: -40000, y: -15000, z: 1 });
  const v = e.getViewportPageBounds();
  const id = window.paired.create({ kind: 'frame', name: 'Existing frame', x: v.x + v.w / 2 - 250, y: v.y + v.h / 2 - 150, width: 500, height: 300 });
  e.selectNone();
  return id;
});
const nf = await command('create', { kind: 'frame', name: 'New frame', width: 360, height: 200 });
const [nfb, mfb] = [await bounds(nf.id), await bounds(midFrame)];
check('a new frame without x/y does not cover an unselected existing frame, and is in view', !overlaps(nfb, mfb) && inside(nfb, await view()), `${JSON.stringify(nfb)} vs ${JSON.stringify(mfb)}`);

await p.evaluate(() => { window.__pairedEditor.selectNone(); });
await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/create-spot.png` });
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
