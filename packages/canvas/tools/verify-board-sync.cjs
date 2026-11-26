const { chromium } = require('playwright');
// Headless check of board sync against the dev server's board store. Start it with an empty store:
//   PAIRED_BOARDS_DIR=$(mktemp -d) pnpm dev:canvas
// then: node packages/canvas/tools/verify-board-sync.cjs
const base = process.env.PAIRED_URL ?? 'http://localhost:5183';
const boards = async () => (await (await fetch(base + '/api/canvas/boards')).json()).boards.map(b => `${b.id}@r${b.revision}`);
const chip = p => p.locator('.save-state').first().textContent();
(async () => {
  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const open = async () => { const c = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }); const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); await p.goto(base + '/canvas/'); await p.waitForFunction(() => window.paired); return { c, p, errs }; };
  const A = await open();
  await A.p.waitForFunction(() => document.querySelector('.save-state')?.textContent.includes('Saved to'), null, { timeout: 15000 });
  console.log('A chip after start:', await chip(A.p), '| server:', await boards());
  const id = await A.p.evaluate(() => window.paired.create({ kind: 'text', x: 200, y: -300, text: 'Saved from profile A' }));
  await A.p.waitForTimeout(2500);
  console.log('A chip after edit:', await chip(A.p), '| server:', await boards());
  const B = await open();
  await B.p.waitForFunction(() => document.querySelector('.save-state')?.textContent.includes('Saved to'), null, { timeout: 15000 });
  await B.p.waitForTimeout(500);
  const inB = await B.p.evaluate((id) => { const o = window.paired.read().objects.find(o => o.id === id); return o ? JSON.stringify(o.props.richText).includes('profile A') : false; }, id);
  console.log('clean profile B has A\'s object:', inB, '| B objects:', await B.p.evaluate(() => window.paired.read().objects.length), '| A objects:', await A.p.evaluate(() => window.paired.read().objects.length), '| server:', await boards());
  // B edits; A (stale) edits next: A's save must succeed on top, B's version kept in history.
  await B.p.evaluate((id) => { const o = window.paired.read().objects.find(o => o.id === id); window.paired.update({ id, expectedRevision: o.revision, text: 'Edited in B' }); }, id);
  await B.p.waitForTimeout(2500);
  await A.p.evaluate(() => window.paired.create({ kind: 'text', x: 200, y: -200, text: 'Second note from A' }));
  await A.p.waitForTimeout(3000);
  console.log('A chip after racing B:', await chip(A.p), '| title:', await A.p.locator('.save-state').first().getAttribute('title'), '| server:', await boards());
  const main = (await (await fetch(base + '/api/canvas/boards/main')).json()).board.snapshot.store;
  const texts = Object.values(main).map(r => JSON.stringify(r.props?.richText ?? '')).join(' ');
  console.log('server board keeps B\'s edit:', texts.includes('Edited in B'), '| and A\'s new note:', texts.includes('Second note from A'));
  await A.p.reload(); await A.p.waitForFunction(() => window.paired); await A.p.waitForTimeout(4000);
  console.log('A after reload:', await chip(A.p), '| server:', await boards());
  console.log('errors:', A.errs, B.errs);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
