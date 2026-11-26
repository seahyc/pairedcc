// Browser check for item 84: an ask about an image says what the image is. An agent places an
// image with a caption; the person drops a second image file of their own; the person asks about
// each, and then about a frame holding the first. The agent's view of each ask (the `asks`
// operation) must give the file name, size and caption, never "(Image, no text)".
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-ask-image.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`) with an empty board store (PAIRED_BOARDS_DIR
// set to a new folder).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-ask-image.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// A synthetic 2×2 PNG (four coloured pixels).
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGM4YWNjU3GCAUIBACWiBXm4fctXAAAAAElFTkSuQmCC';

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
  const res = await fetch(`${BASE}/api/canvas/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: `ask-image-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }) });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
async function ask(ids, question) {
  await p.evaluate((ids) => window.paired.select(ids), ids);
  await p.waitForTimeout(250);
  await p.locator('.selection-bar button.primary').click();
  await p.locator('.selection-bar.asking input').fill(question);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  return (await command('asks', {})).asks.find((a) => a.question === question);
}

// An agent's image with a caption.
const placed = await command('image', { x: 120, y: 560, width: 320, height: 200, name: 'pricing-sketch.png', caption: 'Three tiers on a napkin', src: `data:image/png;base64,${PNG}` });
const sketch = placed.id;
const first = await ask([sketch], 'What is this sketch for?');
const t1 = first?.targets?.[0]?.text ?? '';
check('an ask about the agent\'s image gives its name and caption', t1.includes('pricing-sketch.png') && t1.includes('Three tiers on a napkin') && !t1.includes('no text'), t1);

// The person drops an image file of their own.
await p.evaluate(async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const file = new File([bytes], 'whiteboard-photo.png', { type: 'image/png' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const target = document.querySelector('.tl-canvas') ?? document.body;
  for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: 900, clientY: 600, dataTransfer: dt }));
}, PNG);
await p.waitForTimeout(1500);
const dropped = await p.evaluate(() => window.paired.read().objects.filter((o) => o.type === 'image').map((o) => o.id));
const mine = dropped.find((id) => id !== sketch);
check('the dropped image is on the board', Boolean(mine), JSON.stringify(dropped));
if (mine) {
  const second = await ask([mine], 'What does this photo show?');
  const t2 = second?.targets?.[0]?.text ?? '';
  check('an ask about a dropped image gives its file name and size', t2.includes('whiteboard-photo.png') && /\d+×\d+ px/.test(t2), t2);
}

// The image inside a frame: an ask about the frame lists it by what it is.
const revs = await p.evaluate((ids) => ids.map((id) => ({ id, expectedRevision: window.paired.read().objects.find((o) => o.id === id).revision })), [sketch, placed.captionId]);
const frame = (await command('group', { objects: revs, name: 'Sketches', padding: 10 })).frame.id;
const third = await ask([frame], 'What is in here?');
const held = (third?.targets?.[0]?.inside ?? []).map((o) => o.text).join(' | ');
check('an ask about the frame gives the image by what it is', held.includes('Image "pricing-sketch.png"'), held);
await p.evaluate(() => { window.paired.select([]); });
await p.screenshot({ path: `${out}/ask-image.png` });
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
