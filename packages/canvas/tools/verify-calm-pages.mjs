// Browser check for item 100 (d) and (e), from the bot review of #91 (a board saved before the
// calm canvas gets the calm board once it loads from the account).
// (d) Two devices open the same older board before either has saved: each lays out the calm
//     board, and the account must end up with one "Thinking" page and one set of its cards, not two.
// (e) An older board whose only page is empty but has a name someone chose keeps that name; the
//     calm layout used to rename it "Board 1".
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-calm-pages.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`) with an empty board store in
// PAIRED_BOARDS_DIR, which this check reads and rewrites (pass the same folder as BOARDS_DIR).
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
const dir = process.env.BOARDS_DIR;
if (!out || !dir) throw new Error('Usage: BOARDS_DIR=<PAIRED_BOARDS_DIR of the dev server> node verify-calm-pages.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const browser = await chromium.launch();
const errors = [];

async function open(width = 1440, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await p.goto(`${BASE}/canvas/`);
  await p.waitForFunction(() => window.paired && window.__pairedEditor, null, { timeout: 30000 });
  return { ctx, p };
}
const boardFile = () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length !== 1) throw new Error(`expected one board in ${dir}, found ${files.join(', ')}`);
  return join(dir, files[0]);
};
const stored = () => JSON.parse(readFileSync(boardFile(), 'utf8'));
const waitForSave = async (from, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (stored().revision > from) return true; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
/** Rewrite the account's board as one saved by the build before the calm canvas. */
function makeOlder(pages) {
  const b = stored();
  const store = b.snapshot.store;
  for (const [id, r] of Object.entries(store)) if (r.typeName === 'shape' || r.typeName === 'page') delete store[id];
  for (const r of Object.values(store)) if (r.typeName === 'document') r.meta = { ...r.meta, calm: 0 };
  pages.forEach((page, i) => {
    store[page.id] = { typeName: 'page', id: page.id, name: page.name, index: `a${i + 1}`, meta: {} };
    for (const [k, card] of (page.cards ?? []).entries()) {
      const id = `shape:older-${i}-${k}`;
      store[id] = { typeName: 'shape', id, type: 'card', parentId: page.id, index: `a${k + 1}`, x: 200, y: 200 + k * 160, rotation: 0, isLocked: false, opacity: 1, meta: { revision: 0, name: card }, props: { w: 300, h: 80, richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: card }] }] }, tone: 'human' } };
    }
  });
  // Instance records point at pages; drop them so nothing refers to the removed ones.
  for (const [id, r] of Object.entries(store)) if (r.typeName === 'instance_page_state' || r.typeName === 'camera') delete store[id];
  b.snapshot.store = store;
  b.history = [...b.history, { revision: b.revision + 1, savedAt: new Date().toISOString(), snapshot: b.snapshot }];
  b.revision += 1;
  writeFileSync(boardFile(), JSON.stringify(b));
  return b.revision;
}
const pagesOf = (b) => Object.values(b.snapshot.store).filter((r) => r.typeName === 'page');
const seedsOf = (b) => Object.values(b.snapshot.store).filter((r) => r.typeName === 'shape' && r.meta?.seed);

// A first browser makes the account's board.
const first = await open();
await waitForSave(0);
await first.ctx.close();

// (d) The board becomes an older one; two clean browsers open it at once, one a phone.
let rev = makeOlder([{ id: 'page:older', name: 'Pricing', cards: ['Charge per seat', 'Annual discount?'] }]);
const [a, b] = await Promise.all([open(), open(390, 844)]);
await waitForSave(rev);
await new Promise((r) => setTimeout(r, 6000)); // both have loaded, laid out and saved (one after a 409 and a merge)
const pagesA = await a.p.evaluate(() => window.__pairedEditor.getPages().map((pg) => pg.name));
check('a tab that opened the older board shows it with the calm board beside it', pagesA.includes('Pricing') && pagesA.includes('Thinking'), pagesA.join(', '));
await a.ctx.close();
await b.ctx.close();
const afterTwo = stored();
const names = pagesOf(afterTwo).map((pg) => pg.name);
check('(d) the account has one Thinking page after two devices opened it', names.filter((n) => n === 'Thinking').length === 1, names.join(', '));
check('(d) and one set of the calm board\'s cards', seedsOf(afterTwo).length === 3, `${seedsOf(afterTwo).length} seed cards`);
check('(d) the person\'s older page and its cards are kept', names.includes('Pricing') && Object.values(afterTwo.snapshot.store).filter((r) => r.typeName === 'shape' && r.parentId === 'page:older').length === 2);
const c = await open();
await new Promise((r) => setTimeout(r, 3000));
const pagesC = await c.p.evaluate(() => window.__pairedEditor.getPages().map((pg) => pg.name));
check('(d) a third device opens it with one Thinking page', pagesC.filter((n) => n === 'Thinking').length === 1, pagesC.join(', '));
await c.p.screenshot({ path: `${out}/calm-pages-third-device.png` });
await c.ctx.close();

// (e) The board becomes an older one whose only page is empty and named by someone.
rev = makeOlder([{ id: 'page:named', name: 'Launch plan' }]);
const e = await open();
await waitForSave(rev);
await new Promise((r) => setTimeout(r, 2000));
const pagesE = await e.p.evaluate(() => window.__pairedEditor.getPages().map((pg) => ({ name: pg.name, cards: window.__pairedEditor.getSortedChildIdsForParent(pg.id).length })));
check('(e) an empty page with a chosen name keeps it', pagesE.length === 1 && pagesE[0].name === 'Launch plan', JSON.stringify(pagesE));
check('(e) and gets the calm board on it', pagesE[0]?.cards === 3, JSON.stringify(pagesE));
await e.p.screenshot({ path: `${out}/calm-pages-named.png` });
await e.ctx.close();

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
