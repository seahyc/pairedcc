// Browser check for item 117: suggestions (P4) stay readable and in view at any zoom, and on a phone.
//
// On an emulated iPhone 13 (390 x 664, touch), fresh profile: the person taps Write, taps the
// board, writes a thought and finishes. After a pause the suggestions must be legible on screen
// (text at least 15 px, each tap target at least 32 px tall), wholly inside the window, clear of
// the top bar, tool strip, undo and zoom controls, the selection bar and every object. Tapping
// one writes the person's card and sends it. A card near the bottom edge gets suggestions only
// where they are wholly in view, or none. On a desktop window, the text is the same size on
// screen at 50 % and at 200 %.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-suggest-phone.mjs <screenshot dir>
//
// Needs a dev server for this checkout with an empty board store. No model is needed.
// Exits non-zero if any check fails.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium, devices } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-suggest-phone.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const PAUSE = 1900;

/** The suggestions as the person sees them, in screen px. */
const seen = (p) => p.evaluate(() => {
  const ed = window.__pairedEditor;
  const box = document.querySelector('.suggestions');
  if (!box) return { shown: false };
  const r = box.getBoundingClientRect();
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const buttons = [...box.querySelectorAll('button')];
  const zoom = ed.getZoomLevel();
  const chrome = [...document.querySelectorAll('.topbar, .tool-strip, .bottom-left, .zoom-controls, .selection-bar')]
    .filter((el) => el.getBoundingClientRect().width && hit(r, el.getBoundingClientRect())).map((el) => el.className);
  const selected = new Set(ed.getSelectedShapeIds());
  const covered = [...document.querySelectorAll('.tl-shape[data-shape-id]')]
    .filter((el) => !selected.has(el.dataset.shapeId) && !['arrow', 'frame'].includes(ed.getShape(el.dataset.shapeId)?.type))
    .filter((el) => hit(r, el.getBoundingClientRect())).map((el) => el.dataset.shapeId);
  return {
    shown: true,
    zoom: Math.round(zoom * 100) / 100,
    font: Math.round(parseFloat(getComputedStyle(buttons[0]).fontSize) * zoom * 10) / 10,
    tap: Math.round(Math.min(...buttons.map((b) => b.getBoundingClientRect().height)) * 10) / 10,
    inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
    chrome,
    covered,
    texts: buttons.map((b) => b.textContent),
  };
});

// A phone.
{
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'suggest-phone-')), { ...devices['iPhone 13'] });
  const p = ctx.pages()[0] ?? await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await p.goto(`${BASE}/canvas/`);
  await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  // The person taps Write, then a clear spot under the first board, writes, and finishes.
  // Bring empty board into view under the first board, then tap there.
  await p.evaluate(() => {
    const ed = window.__pairedEditor, all = ed.getCurrentPageShapes().map((s) => ed.getShapePageBounds(s));
    const maxY = Math.max(...all.map((b) => b.maxY)), z = ed.getZoomLevel();
    ed.setCamera({ ...ed.getCamera(), y: -(maxY + 40) + 80 / z }, { immediate: true });
  });
  await p.waitForTimeout(300);
  const spot = { x: 200, y: 260 };
  await p.getByRole('button', { name: /^Write/ }).first().tap();
  await p.waitForTimeout(300);
  await p.touchscreen.tap(spot.x, spot.y);
  await p.waitForTimeout(500);
  await p.keyboard.type('Per-seat pricing, because cost follows team size', { delay: 0 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const card = await p.evaluate(() => window.__pairedEditor.getOnlySelectedShapeId());
  check('the person wrote a card on the phone', Boolean(card), String(card));
  await p.waitForTimeout(PAUSE);
  let s = await seen(p);
  await p.screenshot({ path: `${out}/1-phone.png` });
  check('suggestions appear on the phone', s.shown, JSON.stringify(s));
  check('their text is legible on screen (at least 15 px) at the board\'s zoom', s.shown && s.font >= 15, `font ${s.font} px at zoom ${s.zoom}`);
  check('each is a tap target at least 32 px tall', s.shown && s.tap >= 32, `${s.tap} px`);
  check('they are wholly inside the window', s.shown && s.inView, JSON.stringify(s));
  check('they cover no control, bar or object', s.shown && s.chrome.length === 0 && s.covered.length === 0, JSON.stringify({ chrome: s.chrome, covered: s.covered }));

  // Tapping one writes the person's card and sends it.
  if (s.shown) {
    await p.locator('.suggestions button').first().tap();
    await p.waitForTimeout(600);
    const made = await p.evaluate((cardId) => {
      const ed = window.__pairedEditor, shape = ed.getCurrentPageShapes().find((x) => x.meta.ask && (x.meta.targetIds ?? []).includes(cardId));
      return shape ? { author: shape.meta.author, state: shape.meta.ask.state } : null;
    }, card);
    check('tapping one writes the person\'s card and sends it', made?.author === 'Human' && made?.state === 'waiting', JSON.stringify(made));
    await p.screenshot({ path: `${out}/2-phone-tapped.png` });
    if (made) {
      await p.keyboard.press('Control+z');
      await p.waitForTimeout(400);
    }
  }

  // A card near the bottom edge: suggestions only wholly in view, clear of the bottom controls.
  await p.evaluate((id) => {
    const ed = window.__pairedEditor, v = ed.getViewportPageBounds(), b = ed.getShapePageBounds(id);
    ed.updateShape({ id, type: 'card', x: v.x + v.w / 2 - b.w / 2, y: v.maxY - b.h - 90 / ed.getZoomLevel() });
    ed.selectNone();
  }, card);
  await p.waitForTimeout(300);
  await p.evaluate((id) => { window.__pairedEditor.select(id); }, card);
  await p.waitForTimeout(PAUSE);
  s = await seen(p);
  await p.screenshot({ path: `${out}/3-phone-bottom.png` });
  check('near the bottom edge, suggestions are wholly in view and cover nothing, or are not shown', !s.shown || (s.inView && s.chrome.length === 0 && s.covered.length === 0), JSON.stringify(s));
  check('no page errors on the phone', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// A desktop window: the same size on screen zoomed out and zoomed in.
{
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'suggest-zoom-')), { viewport: { width: 1440, height: 900 } });
  const p = ctx.pages()[0] ?? await ctx.newPage();
  await p.goto(`${BASE}/canvas/`);
  await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  await p.keyboard.press('n');
  await p.waitForTimeout(300);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(500);
  await p.keyboard.type('Flat price, because it is simple to explain', { delay: 0 });
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const card = await p.evaluate(() => window.__pairedEditor.getOnlySelectedShapeId());
  const fonts = [];
  for (const zoom of [0.5, 2]) {
    await p.evaluate(([id, z]) => {
      const ed = window.__pairedEditor, b = ed.getShapePageBounds(id);
      ed.selectNone();
      ed.setCamera({ x: ed.getViewportScreenBounds().w / (2 * z) - b.center.x, y: ed.getViewportScreenBounds().h / (3 * z) - b.center.y, z }, { immediate: true });
    }, [card, zoom]);
    await p.waitForTimeout(300);
    await p.evaluate((id) => { window.__pairedEditor.select(id); window.__pairedEditor.focus(); }, card);
    await p.waitForTimeout(PAUSE);
    const s = await seen(p);
    fonts.push(s.font);
    await p.screenshot({ path: `${out}/4-desktop-${zoom * 100}.png` });
    check(`at ${zoom * 100} % suggestions show, in view, covering nothing`, s.shown && s.inView && s.chrome.length === 0 && s.covered.length === 0, JSON.stringify(s));
  }
  check('their text is the same size on screen at 50 % and 200 %', fonts.length === 2 && fonts.every((f) => f >= 15 && Math.abs(f - fonts[0]) < 0.6), JSON.stringify(fonts));
  await ctx.close();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
