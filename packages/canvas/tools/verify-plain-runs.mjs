// Browser check for item 146: a word with part of it formatted stays one word wherever an agent
// is given a card's words. The person writes "Launch in March", bolds "Lau", and comments on it;
// the feedback queue's target text, the overview's snippet and read's text all say
// "Launch in March", not "Lau nch in March". A hard break still separates words.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-plain-runs.mjs <screenshot dir>
//
// Needs the dev server (`pnpm dev:canvas`, CANVAS_BASE to use another origin) with an empty
// board store (PAIRED_BOARDS_DIR set to a new folder).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-plain-runs.mjs <screenshot dir>');
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
  const res = await fetch(`${BASE}/api/canvas/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: `plain-runs-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }) });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}

// The person's card, then "Lau" made bold in the editor, as the text toolbar would.
const made = await p.evaluate(() => window.paired.create({ kind: 'note', x: 900, y: 120, text: 'Launch in March' }));
const cardId = made.id ?? made;
await p.evaluate((id) => {
  const ed = window.__pairedEditor;
  const s = ed.getShape(id);
  ed.updateShape({ id, type: s.type, props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lau', marks: [{ type: 'bold' }] }, { type: 'text', text: 'nch in March' }] }] } } });
}, cardId);
// A second card with a hard break between two lines.
const two = await p.evaluate(() => window.paired.create({ kind: 'note', x: 900, y: 420, text: 'Price:' }));
const twoId = two.id ?? two;
await p.evaluate((id) => {
  const ed = window.__pairedEditor;
  const s = ed.getShape(id);
  ed.updateShape({ id, type: s.type, props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Price:' }, { type: 'hardBreak' }, { type: 'text', text: '£40' }] }] } } });
}, twoId);
await p.waitForTimeout(300);

// The person comments on the bold card with C.
await p.evaluate((id) => { const ed = window.__pairedEditor; ed.setCurrentTool('select'); ed.select(id); }, cardId);
await p.keyboard.press('c');
await p.waitForTimeout(400);
await p.keyboard.type('Is March realistic?');
await p.keyboard.press('Escape');
await p.waitForTimeout(600);
await p.screenshot({ path: `${out}/plain-runs.png` });

const queue = await command('feedback', {});
const items = queue.items ?? queue;
const item = items.find((i) => (i.targets ?? []).some((t) => t.id === cardId));
const target = item?.targets.find((t) => t.id === cardId);
check('the comment is in the queue with the card as its target', Boolean(target), JSON.stringify(items.map((i) => i.text ?? i.id)).slice(0, 200));
check("the queue's target text keeps the partly bold word whole", target?.text === 'Launch in March', JSON.stringify(target?.text));

const ov = await command('overview', {});
const entry = ov.objects.find((o) => o.id === cardId);
check("the overview's snippet keeps it whole", entry?.text === 'Launch in March', JSON.stringify(entry?.text));
const twoEntry = ov.objects.find((o) => o.id === twoId);
check('a hard break still separates the words, with one space', twoEntry?.text === 'Price: £40', JSON.stringify(twoEntry?.text));

const read = await command('read', { ids: [cardId] });
const readObj = (read.objects ?? []).find((o) => o.id === cardId);
check("read's text keeps it whole", readObj?.text === 'Launch in March', JSON.stringify(readObj?.text));
check('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
