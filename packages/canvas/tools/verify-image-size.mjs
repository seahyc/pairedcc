// Browser check for item 56: a dropped image lands at a size that fits beside cards.
// The person drops a large photo-like image and a small sketch next to the first board's
// cards; an agent places an image at an explicit size with `image`. The photo must land no
// larger than 600 on its longest side with its shape kept and its full-size asset kept; the
// sketch and the agent's image keep their sizes.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-image-size.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`), ideally with an empty PAIRED_BOARDS_DIR.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-image-size.mjs <screenshot dir>');
const BASE = 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'image-size-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await p.waitForTimeout(800);

/** Draw an image in the page and drop it on the board as a file, as a person would. */
const drop = (name, w, h, x, y) => p.evaluate(async ({ name, w, h, x, y }) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, '#ff7a59'); grad.addColorStop(1, '#3a2fd0');
  g.fillStyle = grad; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = `bold ${Math.round(h / 8)}px sans-serif`; g.fillText(name, w / 20, h / 5);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const ed = window.__pairedEditor, before = new Set(ed.getCurrentPageShapeIds());
  await ed.putExternalContent({ type: 'files', files: [new File([blob], `${name}.png`, { type: 'image/png' })], point: { x, y } });
  const shape = ed.getCurrentPageShapes().find((s) => s.type === 'image' && !before.has(s.id));
  const asset = shape && ed.getAsset(shape.props.assetId);
  return shape ? { w: shape.props.w, h: shape.props.h, assetW: asset?.props.w, assetH: asset?.props.h } : null;
}, { name, w, h, x, y });

const photo = await drop('photo', 3000, 2000, 1000, 640);
console.log('photo', JSON.stringify(photo));
check('a large photo lands no larger than 600 on its longest side', photo && Math.max(photo.w, photo.h) <= 600, JSON.stringify(photo));
check('it keeps its shape', photo && Math.abs(photo.w / photo.h - 1.5) < 0.01);
check('its asset keeps full resolution', photo?.assetW === 3000 && photo?.assetH === 2000);
const sketch = await drop('sketch', 480, 320, 300, 700);
const thin = await drop('line', 3000, 2, 300, 1100);
check('a very thin image still lands, thin but not zero', thin && thin.w === 600 && thin.h > 0, JSON.stringify(thin));
check('a small image keeps its size', sketch?.w === 480 && sketch?.h === 320, JSON.stringify(sketch));

let n = 0;
const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
const list = sessions.sessions ?? sessions;
const png = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; c.getContext('2d').fillRect(0, 0, 64, 64); return c.toDataURL('image/png'); });
const res = await (await fetch(`${BASE}/api/canvas/command`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ requestId: `image-size-${++n}`, sessionId: list[0]?.id ?? list[0]?.sessionId, actor: 'Verifier', command: { op: 'image', input: { src: png, x: 1800, y: 200, width: 1200, height: 900 } } }),
})).json();
const agentShape = res.ok ? await p.evaluate((id) => { const s = window.__pairedEditor.getShape(id); return s ? { w: s.props.w, h: s.props.h } : null; }, res.result?.id) : null;
check('an agent image placed at an explicit size keeps it', agentShape?.w === 1200 && agentShape?.h === 900, JSON.stringify(res.ok ? agentShape : res));
await p.evaluate((id) => { const ed = window.__pairedEditor; if (id) ed.deleteShapes([id]); ed.selectNone(); ed.zoomToFit(); }, res.result?.id);
await p.waitForTimeout(600);
await p.screenshot({ path: `${out}/image-size-dropped.png` });
check('no page errors', errors.length === 0, errors.join(' | '));
await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
