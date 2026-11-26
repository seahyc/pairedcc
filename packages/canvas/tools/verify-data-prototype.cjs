// Headless check of the data prototype page. Start the dev server (pnpm dev:canvas), then:
//   node packages/canvas/tools/verify-data-prototype.cjs
// Writes filtered.png and stale.png to the current directory. Prints PASS or FAIL for each
// step and exits non-zero if any fails.
const { chromium } = require('playwright');
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : '  — ' + detail}`); };
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type()==='error' && errors.push(m.text()));
  await p.goto('http://localhost:5183/canvas/');
  await p.waitForTimeout(3000);
  const unflagged = await p.getByText('Data prototype page').count();
  check('no Data prototype page button without the flag', unflagged === 0, unflagged);
  await p.goto('http://localhost:5183/canvas/?prototype=data');
  await p.waitForTimeout(3000);
  // The pages list sits behind the menu in the calm layout.
  await p.getByRole('button', { name: 'Menu' }).click(); await p.getByRole('menuitem', { name: /layers and pages/ }).click();
  await p.getByText('Data prototype page').click();
  await p.waitForTimeout(800);
  const bars = async () => p.$$eval('.bar', bs => bs.map(b => b.getAttribute('aria-label')));
  const all = await bars();
  check('the chart shows four region bars', all.length === 4, all.join(', '));
  await p.getByRole('button', { name: 'Tea', exact: true }).click();
  await p.waitForTimeout(300);
  const tea = await bars();
  check('filtering to Tea lowers every bar', tea.length === 4 && tea.every((b, i) => Number(b.split(': ')[1]) < Number(all[i].split(': ')[1])), tea.join(', '));
  await p.getByRole('button', { name: /^South:/ }).click();
  await p.waitForTimeout(300);
  const selected = await p.$$eval('.bar.on', bs => bs.map(b => b.getAttribute('aria-label')));
  check('clicking South selects it alone', selected.length === 1 && selected[0].startsWith('South:'), selected.join(', '));
  await p.screenshot({ path: 'filtered.png' });
  // Edit first South/Tea row value: row index find via label
  const read = await p.evaluate(() => window.paired.read().objects.filter(o => o.type==='chart' || o.type==='dataset').map(o => ({type:o.type, rev:o.revision, version: o.props.version ?? o.props.data.version, state: o.props.state})));
  const chartState = read.find(o => o.type === 'chart')?.state;
  check('read reports the exact chart state', JSON.stringify(chartState?.filter) === '{"product":["Tea"]}' && JSON.stringify(chartState?.selected) === '["South"]', JSON.stringify(chartState));
  const cell = p.getByLabel('orders, row 17');
  await cell.click(); await cell.fill('500'); await cell.press('Enter');
  await p.waitForTimeout(500);
  const staleText = await p.locator('.data-stale').textContent().catch(() => '');
  check('editing a cell marks the chart stale and says why', /Stale: dataset changed/.test(staleText ?? ''), staleText);
  await p.screenshot({ path: 'stale.png' });
  await p.getByRole('button', { name: 'Recompute' }).click();
  await p.waitForTimeout(300);
  const afterRecompute = await bars();
  check('Recompute clears the stale mark and shows the new value', (await p.locator('.data-stale').count()) === 0 && Number(afterRecompute[1]?.split(': ')[1]) > Number(tea[1].split(': ')[1]), afterRecompute.join(', '));
  // Moving the dataset must not mark the chart stale
  await p.evaluate(() => { const d = window.paired.read().objects.find(o => o.type==='dataset'); window.paired.update({ id: d.id, expectedRevision: d.revision, x: d.x - 40 }); });
  await p.waitForTimeout(300);
  check('moving the dataset does not mark the chart stale', (await p.locator('.data-stale').count()) === 0);
  // Undo the recompute, the chart returns to stale
  await p.evaluate(() => { window.paired.undo(); window.paired.undo(); });
  await p.waitForTimeout(300);
  check('undoing the recompute makes the chart stale again', (await p.locator('.data-stale').count()) === 1);
  // Reload persists
  await p.reload(); await p.waitForTimeout(3000);
  const charts = await p.locator('.chart').count();
  // The page is read from the board itself: the layers panel that lists pages is not built while
// it is closed (#127), so its text is no longer on the page to find.
  const pages = await p.evaluate(() => window.__pairedEditor.getPages().map((pg) => pg.name));
  check('reload keeps the data prototype page and its chart', pages.includes('Data prototype') && charts === 1, `charts: ${charts}; pages: ${pages.join(', ')}`);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await b.close();
  const failed = results.filter(ok => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks pass`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
