// Browser check for P3, part 2: the whole board (O).
//
// Starts its own dev server with a throwaway board store, opens the canvas at 1440 x 900 and:
//   1. the first screen is unchanged: no overview until asked;
//   2. a board with a frame (three thoughts, one settled), a pile under a heading (three
//      thoughts, two settled) and a lone thought far away: O shows three labelled boxes with the
//      right open and settled counts, laid out as on the board, no label covering another;
//   3. pressing the pile's box closes the overview and flies there: the whole pile in view, never
//      zoomed past 100%;
//   4. Menu → "The whole board" opens it too; Esc closes it and gives focus back;
//   5. the Ellipse is still a click away under More, now that O is the overview;
//   6. a 1,000-object board: the overview opens within the budget (under 1 s from the key press);
//   7. on a 390 px phone it fits the window, every box inside its map.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-overview.mjs <screenshot dir>
//
// No model is needed. Exits non-zero if any check fails.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-overview.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.OVERVIEW_PORT ?? 5213), ORIGIN = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const boards = mkdtempSync(join(tmpdir(), 'overview-boards-'));
const server = spawn(process.execPath, [join(pkg, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], {
  cwd: pkg, env: { ...process.env, PAIRED_BOARDS_DIR: boards }, stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('dev server did not start')), 30000);
  server.stdout.on('data', (d) => { if (/Local:/.test(String(d))) { clearTimeout(timer); resolve(); } });
  server.on('exit', (code) => reject(new Error(`dev server exited ${code}`)));
});
const post = (path, body) => fetch(`${ORIGIN}/api/canvas${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify(body),
}).then((r) => r.json());

const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  await p.goto(`${ORIGIN}/canvas/`);
  await p.waitForFunction(() => window.paired?.read().objects.length >= 1, null, { timeout: 30000 });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/0-first-screen.png` });
  check('the first screen shows no overview', (await p.locator('[role=dialog][aria-label="Overview of the board"]').count()) === 0);
  await p.evaluate(() => { const ed = window.__pairedEditor; ed.deleteShapes([...ed.getCurrentPageShapeIds()]); ed.setCamera({ x: 0, y: 0, z: 1 }); });

  const ids = await p.evaluate(() => {
    const ed = window.__pairedEditor, bridge = window.paired;
    const id = (r) => (typeof r === 'string' ? r : r.id);
    const note = (x, y, text) => id(bridge.create({ kind: 'note', x, y, width: 200, text }));
    const frame = id(bridge.create({ kind: 'frame', x: 100, y: 100, width: 760, height: 320, name: 'Pricing' }));
    const inside = [note(130, 150, 'Per seat'), note(370, 150, 'Flat fee'), note(610, 150, 'Usage')];
    ed.reparentShapes(inside, frame);
    const pile = [note(100, 700, 'Risks'), note(330, 700, 'Churn after a month'), note(560, 700, 'Price too high')];
    const lone = note(3200, 1400, 'Ask five teams');
    const settle = (sid) => ed.updateShape({ id: sid, type: ed.getShape(sid).type, meta: { ...ed.getShape(sid).meta, settled: true } });
    settle(inside[1]);
    settle(pile[1]);
    settle(pile[2]);
    return { frame, inside, pile, lone };
  });
  await p.waitForTimeout(300);
  await p.mouse.click(1300, 820);
  const t0 = Date.now();
  await p.keyboard.press('o');
  await p.locator('[data-overview-map]').waitFor({ timeout: 5000 });
  const openMs = Date.now() - t0;
  const groups = await p.evaluate(() => [...document.querySelectorAll('[data-overview-group]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.overviewGroup, label: el.querySelector('.overview-label').textContent, counts: el.querySelector('.overview-counts').textContent, x: r.x, y: r.y, r: r.right, b: r.bottom };
  }));
  const byLabel = Object.fromEntries(groups.map((g) => [g.label, g]));
  check('O shows the board\'s three groups, labelled', groups.length === 3 && byLabel.Pricing && byLabel.Risks && byLabel['Ask five teams'], groups.map((g) => g.label).join(', '));
  check('each says what is open and settled in it', byLabel.Pricing?.counts === '2 open · 1 settled' && byLabel.Risks?.counts === '1 open · 2 settled' && byLabel['Ask five teams']?.counts === '1 open', groups.map((g) => `${g.label}: ${g.counts}`).join('; '));
  check('they sit as on the board: the frame above the pile, the lone thought to the right', byLabel.Pricing && byLabel.Risks && byLabel.Pricing.b <= byLabel.Risks.y && byLabel['Ask five teams'].x > byLabel.Risks.r);
  const overlap = groups.some((a, i) => groups.slice(i + 1).some((b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b));
  check('no box covers another', !overlap);
  check('the overview takes focus', await p.evaluate(() => Boolean(document.activeElement?.closest('[role=dialog]'))));
  await p.screenshot({ path: `${out}/1-overview.png` });

  // 3. Fly to the pile.
  await p.locator(`[data-overview-group="${byLabel.Risks.id}"]`).click();
  await p.waitForTimeout(600);
  const view = await p.evaluate((pile) => {
    const ed = window.__pairedEditor, v = ed.getViewportPageBounds();
    const all = pile.map((id) => ed.getShapePageBounds(id));
    return { inView: all.every((b) => b.x >= v.x && b.y >= v.y && b.maxX <= v.maxX && b.maxY <= v.maxY), zoom: ed.getZoomLevel(), open: Boolean(document.querySelector('[data-overview-map]')) };
  }, ids.pile);
  check('pressing a group flies there: the whole pile in view, not past 100%', view.inView && view.zoom <= 1 && !view.open, JSON.stringify(view));
  await p.screenshot({ path: `${out}/2-flew-to-pile.png` });

  // 4. From the menu; Esc gives focus back to the Menu button.
  await p.getByRole('button', { name: 'Menu' }).click();
  await p.getByRole('menuitem', { name: /The whole board/ }).click();
  await p.locator('[data-overview-map]').waitFor({ timeout: 3000 });
  check('Menu → "The whole board" opens it', true);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => ({ open: Boolean(document.querySelector('[data-overview-map]')), focus: document.activeElement?.getAttribute('aria-label') }));
  check('Esc closes it and gives focus back', !after.open && after.focus === 'Menu', JSON.stringify(after));

  // 5. The Ellipse under More.
  await p.locator('button[title="More tools"]').click();
  await p.getByRole('menuitem', { name: /Ellipse/ }).click();
  await p.waitForTimeout(200);
  const geo = await p.evaluate(() => window.__pairedEditor.getCurrentToolId());
  check('the Ellipse is still a click away under More', geo === 'geo' && (await p.locator('.more-menu').count()) === 0, `tool ${geo}`);
  await p.evaluate(() => { window.__pairedEditor.setCurrentTool('select'); });

  // 5b. A finished thread folded to one line is still on the board: the overview counts it.
  const folded = await p.evaluate(() => {
    const ed = window.__pairedEditor, bridge = window.paired;
    const r = bridge.create({ kind: 'note', x: 100, y: 2600, width: 260, text: 'Which should we try first?' });
    const qid = typeof r === 'string' ? r : r.id;
    ed.updateShape({ id: qid, type: ed.getShape(qid).type, meta: { ...ed.getShape(qid).meta, ask: { state: 'answered', contextIds: [] }, fold: 'folded' } });
    ed.selectNone();
    return { qid, hidden: ed.isShapeHidden(ed.getShape(qid)) };
  });
  await p.waitForTimeout(300);
  await p.mouse.click(1300, 820);
  await p.keyboard.press('o');
  await p.locator('[data-overview-map]').waitFor({ timeout: 5000 });
  const foldedLabels = await p.evaluate(() => [...document.querySelectorAll('[data-overview-group] .overview-label')].map((el) => el.textContent));
  check('a folded thread is still counted in the overview', folded.hidden && foldedLabels.includes('Which should we try first?'), `hidden on the board: ${folded.hidden}; ${foldedLabels.join(', ')}`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);

  // 6. A 1,000-object board.
  await p.evaluate(() => {
    const ed = window.__pairedEditor;
    ed.deleteShapes([...ed.getCurrentPageShapeIds()]);
    const shapes = [];
    for (let i = 0; i < 1000; i++) {
      const pile = Math.floor(i / 25), k = i % 25;
      shapes.push({ type: 'card', x: (pile % 8) * 2200 + (k % 5) * 220, y: Math.floor(pile / 8) * 1400 + Math.floor(k / 5) * 110, props: { w: 200, richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Thought ${i}` }] }] } }, meta: i % 3 === 0 ? { settled: true } : {} });
    }
    ed.createShapes(shapes);
    ed.selectNone();
  });
  await p.waitForTimeout(1500);
  await p.mouse.click(1300, 820);
  const t1 = Date.now();
  await p.keyboard.press('o');
  await p.locator('[data-overview-map]').waitFor({ timeout: 10000 });
  const bigMs = Date.now() - t1;
  const bigCount = await p.locator('[data-overview-group]').count();
  check('on a 1,000-object board the overview opens in under 1 s', bigMs < 1000 && bigCount === 40, `${bigMs} ms (small board ${openMs} ms), ${bigCount} groups`);
  await p.screenshot({ path: `${out}/3-overview-1k.png` });
  await p.keyboard.press('Escape');
  // 7. On a 390 px phone: the overview fits the window, no box outside its map.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  phone.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  await phone.goto(`${ORIGIN}/canvas/`);
  await phone.waitForFunction(() => window.paired?.read().objects.length >= 1, null, { timeout: 30000 });
  await phone.waitForTimeout(1200);
  await phone.evaluate(() => {
    const ed = window.__pairedEditor;
    ed.deleteShapes([...ed.getCurrentPageShapeIds()]);
    const card = (x, y, text) => ed.createShape({ type: 'card', x, y, props: { w: 200, tone: 'human', richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } } });
    card(0, 0, 'Pricing'); card(220, 0, 'Per seat'); card(2400, 900, 'Ask five teams'); card(0, 1800, 'Risks');
  });
  await phone.getByRole('button', { name: 'Menu' }).click();
  await phone.getByRole('menuitem', { name: /The whole board/ }).click();
  await phone.locator('[data-overview-map]').waitFor({ timeout: 3000 });
  const fit = await phone.evaluate(() => {
    const d = document.querySelector('.overview-dialog').getBoundingClientRect(), m = document.querySelector('[data-overview-map]').getBoundingClientRect();
    const boxes = [...document.querySelectorAll('[data-overview-group]')].map((b) => b.getBoundingClientRect());
    return { dialog: [Math.round(d.left), Math.round(d.right)], inWindow: d.left >= 0 && d.right <= innerWidth, boxesInMap: boxes.every((b) => b.left >= m.left - 1 && b.right <= m.right + 1), mapScrolls: document.querySelector('[data-overview-map]').scrollWidth > document.querySelector('[data-overview-map]').clientWidth + 1, groups: boxes.length };
  });
  check('on a 390 px phone the overview fits the window, every box inside its map', fit.inWindow && fit.boxesInMap && !fit.mapScrolls && fit.groups === 3, JSON.stringify(fit));
  await phone.screenshot({ path: `${out}/4-overview-phone.png` });
  await phone.close();
  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await browser.close();
  server.kill();
  rmSync(boards, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
