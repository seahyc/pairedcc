// Headless check of the data prototype page. Start the dev server (pnpm dev:canvas), then:
//   node packages/canvas/tools/verify-data-prototype.cjs
// Writes filtered.png and stale.png to the current directory.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => m.type()==='error' && errors.push(m.text()));
  await p.goto('http://localhost:5183/canvas/');
  await p.waitForTimeout(3000);
  console.log('button without flag:', await p.getByText('Data prototype page').count());
  await p.goto('http://localhost:5183/canvas/?prototype=data');
  await p.waitForTimeout(3000);
  // The pages list sits behind the menu in the calm layout.
  await p.getByRole('button', { name: 'Menu' }).click(); await p.getByRole('menuitem', { name: /layers and pages/ }).click();
  await p.getByText('Data prototype page').click();
  await p.waitForTimeout(800);
  const bars = async () => p.$$eval('.bar', bs => bs.map(b => b.getAttribute('aria-label')));
  console.log('bars:', await bars());
  await p.getByRole('button', { name: 'Tea', exact: true }).click();
  await p.waitForTimeout(300);
  console.log('bars Tea:', await bars());
  await p.getByRole('button', { name: /^South:/ }).click();
  await p.waitForTimeout(300);
  console.log('selected:', await p.$$eval('.bar.on', bs => bs.map(b => b.getAttribute('aria-label'))));
  await p.screenshot({ path: 'filtered.png' });
  // Edit first South/Tea row value: row index find via label
  const read = await p.evaluate(() => window.paired.read().objects.filter(o => o.type==='chart' || o.type==='dataset').map(o => ({type:o.type, rev:o.revision, version: o.props.version ?? o.props.data.version, state: o.props.state})));
  console.log('read:', JSON.stringify(read));
  const cell = p.getByLabel('orders, row 17');
  await cell.click(); await cell.fill('500'); await cell.press('Enter');
  await p.waitForTimeout(500);
  console.log('stale text:', await p.locator('.data-stale').textContent());
  await p.screenshot({ path: 'stale.png' });
  await p.getByRole('button', { name: 'Recompute' }).click();
  await p.waitForTimeout(300);
  console.log('stale after recompute:', await p.locator('.data-stale').count(), await bars());
  // Moving the dataset must not mark the chart stale
  await p.evaluate(() => { const d = window.paired.read().objects.find(o => o.type==='dataset'); window.paired.update({ id: d.id, expectedRevision: d.revision, x: d.x - 40 }); });
  await p.waitForTimeout(300);
  console.log('stale after move:', await p.locator('.data-stale').count());
  // Undo the recompute, the chart returns to stale
  await p.evaluate(() => { window.paired.undo(); window.paired.undo(); });
  await p.waitForTimeout(300);
  console.log('stale after 2x undo:', await p.locator('.data-stale').count());
  // Reload persists
  await p.reload(); await p.waitForTimeout(3000);
  console.log('after reload pages has data proto:', await p.getByText('Data prototype', { exact: true }).count(), 'charts:', await p.locator('.chart').count());
  console.log('errors:', errors);
  await b.close();
})();
