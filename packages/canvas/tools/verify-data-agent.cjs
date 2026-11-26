// Requires the dev server (pnpm dev:canvas) with no other canvas tab open: node packages/canvas/tools/verify-data-agent.cjs
// End-to-end over the dev-server HTTP relay with a real headless tab.
const { chromium } = require('playwright');
const base = 'http://localhost:5183';
let n = 0;
async function cmd(sessionId, op, input) {
  const r = await fetch(base + '/api/canvas/command', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `e2e-${Date.now()}-${n++}`, sessionId, actor: 'Test agent', command: { op, input } }) });
  const j = await r.json();
  if (!j.ok) throw new Error(op + ': ' + j.error);
  return j.result;
}
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(base + '/canvas/'); await p.waitForTimeout(2000); await p.reload(); await p.waitForTimeout(3500);
  const sessions = await (await fetch(base + '/api/canvas/sessions')).json();
  const sid = sessions.sessions[0].id;
  await cmd(sid, 'page', { name: 'Agent data check' });
  const ds = await cmd(sid, 'dataset', { x: 0, y: 0, synthetic: 'orders' });
  console.log('dataset:', ds.dataset.title, ds.dataset.rowCount, 'rows, v' + ds.dataset.version, 'rows in result:', 'rows' in ds.dataset);
  const ch = await cmd(sid, 'chart', { x: 480, y: 0, datasetId: ds.id, state: { x: 'region', y: 'orders' } });
  console.log('chart bars:', ch.widget.bars.map(b => `${b.key}=${b.value}`).join(' '));
  // Human filters and selects directly in the browser.
  await p.getByRole('button', { name: 'Cake', exact: true }).click();
  await p.getByRole('button', { name: /^West:/ }).click();
  await p.waitForTimeout(300);
  let read = await cmd(sid, 'read', {});
  let chart = read.objects.find(o => o.id === ch.id);
  console.log('agent reads exact state:', JSON.stringify(chart.widget.state), '|', chart.widget.summary);
  console.log('selected:', chart.widget.selected.map(s => `${s.key}=${s.value} from ${s.rows.length} rows`).join(', '));
  console.log('read omits rows:', !('data' in chart.props) && !('rows' in read.objects.find(o => o.id === ds.id).dataset));
  const full = await cmd(sid, 'get', { id: ds.id });
  console.log('get returns rows:', full.dataset.rows.length);
  // Human writes a manual annotation; agent writes an explanation derived from the chart.
  const human = await p.evaluate(() => window.paired.create({ kind: 'text', x: 1080, y: 300, width: 260, text: 'Human: check the West cake promo' }));
  const s = chart.widget.selected[0];
  const note = await cmd(sid, 'create', { kind: 'note', x: 1080, y: 0, inputs: [ch.id], text: `West sold ${s.value} cakes over ${s.rows.length} months (filter: product = Cake).` });
  console.log('note inputs:', JSON.stringify(note && (await cmd(sid, 'get', { id: note.id })).meta.inputs));
  // Agent revises the chart state: aggregate only, filter and selection kept.
  const rev = await cmd(sid, 'chart_state', { id: ch.id, expectedRevision: chart.revision, state: { aggregate: 'mean' } });
  console.log('after partial state:', JSON.stringify(rev.widget.state));
  try { await cmd(sid, 'chart_state', { id: ch.id, expectedRevision: chart.revision, state: { aggregate: 'sum' } }); console.log('stale write ACCEPTED (bad)'); }
  catch (e) { console.log('stale write rejected:', e.message); }
  read = await cmd(sid, 'read', {});
  console.log('note stale after chart change:', JSON.stringify(read.objects.find(o => o.id === note.id).stale));
  console.log('human annotation survives:', read.objects.some(o => o.id === human && o.text.includes('West cake')));
  // Changing an input marks the chart stale.
  const dsNow = read.objects.find(o => o.id === ds.id);
  await cmd(sid, 'cell', { id: ds.id, expectedRevision: dsNow.revision, row: 47, column: 'orders', value: 400 });
  read = await cmd(sid, 'read', {});
  chart = read.objects.find(o => o.id === ch.id);
  console.log('chart stale:', JSON.stringify(chart.stale), '| note:', chart.widget.note ? 'present' : 'missing');
  await p.waitForTimeout(400);
  console.log('banner:', await p.locator('.data-stale').textContent());
  await cmd(sid, 'select', { ids: [] }); await cmd(sid, 'focus', {}); await p.waitForTimeout(600);
  await p.screenshot({ path: 'agent-stale.png' });
  await p.reload(); await p.waitForTimeout(3500);
  read = await cmd(sid, 'read', {});
  console.log('after reload: chart still stale:', Boolean(read.objects.find(o => o.id === ch.id)?.stale), 'note still derived:', Boolean(read.objects.find(o => o.id === note.id)?.meta.inputs));
  console.log('errors:', errors);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
