// Browser check for item 45 (d): images the person adds survive a clean browser profile.
//
//   node verify-board-images.mjs fresh <screenshot dir>
//     A person drops two images (a small drawing and a large photo-like image) into one
//     profile; a second, clean profile opens the same board and must show both. The large
//     one must have been scaled down to fit the board.
//   node verify-board-images.mjs legacy-add <profile dir>      (run against the OLD code)
//   node verify-board-images.mjs legacy-open <profile dir> <screenshot dir>   (NEW code)
//     An image added before this change lives only in that browser. Reopening that profile
//     with the new code must move it into the board, and a clean profile must then show it.
//
// Run from a directory where playwright is installed. Needs the dev server on :5183
// (`pnpm dev:canvas`), ideally with an empty PAIRED_BOARDS_DIR.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const [mode, a1, a2] = process.argv.slice(2);
const URL = 'http://localhost:5183/canvas/';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

async function open(profile) {
  const ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 1440, height: 900 } });
  const p = ctx.pages()[0] ?? await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message.slice(0, 200)));
  await p.goto(URL);
  await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
  await p.waitForTimeout(1000);
  return { ctx, p };
}
const saved = (p) => p.waitForFunction(() => /Saved to the local server/.test(document.body.textContent ?? ''), null, { timeout: 30000 }).then(() => true, () => false);
/** Draw an image in the page and drop it on the board as a file, as a person would. */
const addImage = (p, { name, w, h, noise, x, y }) => p.evaluate(async ({ name, w, h, noise, x, y }) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (noise) {
    const img = g.createImageData(w, h);
    for (let i = 0; i < img.data.length; i += 4) { const v = (Math.random() * 255) | 0; img.data[i] = v; img.data[i + 1] = (v * 7) & 255; img.data[i + 2] = 255 - v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  } else {
    const grad = g.createLinearGradient(0, 0, w, h); grad.addColorStop(0, '#ff7a59'); grad.addColorStop(1, '#3a2fd0');
    g.fillStyle = grad; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.fillText(name, 24, 64);
  }
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], `${name}.png`, { type: 'image/png' });
  await window.__pairedEditor.putExternalContent({ type: 'files', files: [file], point: { x, y } });
  return blob.size;
}, { name, w, h, noise, x, y });
/** Each image on the board: where its asset is kept, its pixel size, and whether it shows. */
const images = (p) => p.evaluate(async () => {
  const ed = window.__pairedEditor;
  const shapes = ed.getCurrentPageShapes().filter((s) => s.type === 'image');
  // Bring every image on screen first: tldraw does not draw shapes outside the view, so an
  // image off screen has no <img> and would read as "not shown" whatever the board holds.
  ed.zoomToBounds(ed.getCurrentPageBounds(), { animation: { duration: 0 } });
  await new Promise((r) => setTimeout(r, 1500));
  return shapes.map((s) => {
    const asset = ed.getAsset(s.props.assetId);
    const el = document.querySelector(`[data-shape-id="${s.id}"] img`);
    return { kept: asset?.props.src?.slice(0, 15), w: asset?.props.w, mime: asset?.props.mimeType, shows: Boolean(el && el.complete && el.naturalWidth > 0), natural: el?.naturalWidth ?? 0 };
  });
});

if (mode === 'fresh') {
  const out = a1;
  const first = await open(mkdtempSync(join(tmpdir(), 'images-a-')));
  const small = await addImage(first.p, { name: 'sketch', w: 480, h: 320, noise: false, x: 160, y: 600 });
  const large = await addImage(first.p, { name: 'photo', w: 3000, h: 2000, noise: true, x: 2900, y: 1400 });
  console.log(`added images of ${small} and ${large} bytes`);
  await first.p.waitForTimeout(1500);
  check('the board saves with both images', await saved(first.p));
  const here = await images(first.p);
  console.log(JSON.stringify(here));
  check('both images are kept in the board, not only in this browser', here.length === 2 && here.every((i) => i.kept?.startsWith('data:')), here.map((i) => i.kept).join(', '));
  await first.ctx.close();
  const clean = await open(mkdtempSync(join(tmpdir(), 'images-b-')));
  await clean.p.waitForTimeout(1500);
  const there = await images(clean.p);
  console.log(JSON.stringify(there));
  check('a clean profile shows both images', there.length === 2 && there.every((i) => i.shows), JSON.stringify(there.map((i) => i.shows)));
  const big = there.find((i) => i.natural > 1000 || (i.w ?? 0) > 1000);
  check('the large image was scaled to 2048 px on its longest side', big?.natural === 2048, `natural width ${big?.natural}`);
  await clean.p.evaluate(() => void window.__pairedEditor.zoomToFit());
  await clean.p.waitForTimeout(800);
  await clean.p.screenshot({ path: `${out}/board-images-clean-profile.png` });
  check('no page errors', first.p.errors.length + clean.p.errors.length === 0, [...first.p.errors, ...clean.p.errors].join(' | '));
  await clean.ctx.close();
} else if (mode === 'legacy-add') {
  const { ctx, p } = await open(a1);
  await addImage(p, { name: 'older', w: 480, h: 320, noise: false, x: 160, y: 600 });
  await p.waitForTimeout(1500);
  check('the board saves', await saved(p));
  const here = await images(p);
  console.log(JSON.stringify(here));
  check('(old code) the image lives only in this browser', here.length === 1 && here[0].kept?.startsWith('asset:'), here[0]?.kept);
  await ctx.close();
} else if (mode === 'legacy-open') {
  const out = a2;
  const { ctx, p } = await open(a1);
  await p.waitForTimeout(2500);
  check('the board saves after opening', await saved(p));
  const here = await images(p);
  console.log(JSON.stringify(here));
  check('the older image has moved into the board', here.length === 1 && here[0].kept?.startsWith('data:'), here[0]?.kept);
  await ctx.close();
  const clean = await open(mkdtempSync(join(tmpdir(), 'images-c-')));
  const there = await images(clean.p);
  console.log(JSON.stringify(there));
  check('a clean profile shows the older image', there.length === 1 && there[0].shows, JSON.stringify(there));
  await clean.p.screenshot({ path: `${out}/board-images-legacy-clean-profile.png` });
  check('no page errors', p.errors.length + clean.p.errors.length === 0, [...p.errors, ...clean.p.errors].join(' | '));
  await clean.ctx.close();
} else throw new Error('Usage: verify-board-images.mjs fresh <dir> | legacy-add <profile> | legacy-open <profile> <dir>');
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
