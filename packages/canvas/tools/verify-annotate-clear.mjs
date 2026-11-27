// Browser check for item 81: an agent's note never lands on top of something. The person writes a
// card and asks about it (the card is the question: Ask sends the card itself, which becomes the
// ask), writes a second card just under the first, and an agent annotates the first card without
// choosing a spot. The note must cover nothing, stay in the card's column below it, and an
// explicit x/y must still be honoured.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-annotate-clear.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`, or CANVAS_BASE) with an empty board store
// (PAIRED_BOARDS_DIR set to a new folder).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-annotate-clear.mjs <screenshot dir>');
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
  const res = await fetch(`${BASE}/api/canvas/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: `annotate-clear-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }) });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
const bounds = (id) => p.evaluate((id) => { const b = window.__pairedEditor.getShapePageBounds(id); return b && { x: b.x, y: b.y, w: b.w, h: b.h }; }, id);
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const make = async (x, y, text) => { const r = await p.evaluate(([x, y, text]) => window.paired.create({ kind: 'note', x, y, width: 240, text }), [x, y, text]); return typeof r === 'string' ? r : r.id; };

const first = await make(120, 560, 'Charge per seat');
const fb = await bounds(first);
await p.evaluate((id) => window.paired.select([id]), first);
await p.waitForTimeout(250);
await p.locator('.selection-bar button.primary').click();
await p.waitForTimeout(500);
const asked = await p.evaluate((id) => window.paired.read().objects.find((o) => o.id === id)?.meta.ask?.state ?? null, first);
check('Ask sends the person\'s card as the ask', Boolean(asked), String(asked));
await make(120, fb.y + fb.h + 60, 'A second thought, right under the first');
await p.waitForTimeout(300);

const result = await command('annotate', { targetId: first, text: 'A worked example with a team that shrinks mid-month would make this concrete.' });
const noteId = result.id ?? result.annotation?.id;
const nb = await bounds(noteId);
const others = await p.evaluate((note) => window.paired.read().objects.filter((o) => o.id !== note && o.type !== 'arrow' && o.type !== 'frame' && o.bounds).map((o) => ({ id: o.id, text: (o.text ?? '').slice(0, 30), ...o.bounds })), noteId);
const covered = others.filter((o) => overlaps(nb, o));
check('the agent note covers nothing', covered.length === 0, covered.map((o) => o.text || o.id).join(' | '));
check('it stays in the card\'s column, below it', Math.abs(nb.x - fb.x) < 1 && nb.y > fb.y + fb.h, JSON.stringify(nb));

const placed = await command('annotate', { targetId: first, text: 'Placed by hand', x: 900, y: 700 });
const pb = await bounds(placed.id ?? placed.annotation?.id);
check('an explicit x and y are kept', Math.abs(pb.x - 900) < 1 && Math.abs(pb.y - 700) < 1, JSON.stringify(pb));
await p.evaluate(() => { window.paired.select([]); window.__pairedEditor.zoomToFit(); });
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/annotate-clear.png` });
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
