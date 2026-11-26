// Browser check for item 50: notes built on notes in rounds on the data prototype, each round
// using both notes of the round before, then one dataset cell changed. Times the agent read and
// the board's stale flags. Before the fix each round doubled the work.
//
//   cd <a directory where playwright is installed>
//   node <repo>/packages/canvas/tools/verify-stale-linear.cjs [rounds=20] [http://localhost:5199] [screenshot]
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd()] }));
const ROUNDS = Number(process.argv[2] ?? 20), base = process.argv[3] ?? 'http://localhost:5199', shot = process.argv[4];
let n = 0;
async function cmd(sessionId, op, input, timeout = 60000) {
  const r = await fetch(base + '/api/canvas/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeout),
    body: JSON.stringify({ requestId: `stale-${Date.now()}-${n++}`, sessionId, actor: 'Stale check', command: { op, input } }) });
  const j = await r.json();
  if (!j.ok) throw new Error(op + ': ' + j.error);
  return j.result;
}
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(base + '/canvas/?prototype=data');
  await p.waitForFunction(() => window.paired?.read, null, { timeout: 30000 });
  await p.waitForTimeout(2500);
  const sid = (await (await fetch(base + '/api/canvas/sessions')).json()).sessions[0].id;
  await cmd(sid, 'page', { name: `Stale rounds ${ROUNDS}` });
  const ds = await cmd(sid, 'dataset', { x: 0, y: 0, synthetic: 'orders' });
  let previous = [ds.id];
  for (let k = 1; k <= ROUNDS; k++) {
    const made = [];
    for (const side of [0, 1]) made.push((await cmd(sid, 'create', { kind: 'note', x: 480 + k * 230, y: side * 220, inputs: previous, text: `Round ${k}${side ? 'b' : 'a'}` })).id);
    previous = made;
  }
  const dsNow = await cmd(sid, 'get', { id: ds.id });
  await cmd(sid, 'cell', { id: ds.id, expectedRevision: dsNow.revision, row: 0, column: 'orders', value: 999 });
  await p.waitForTimeout(500);
  let started = Date.now(), read, readMs, size = 0;
  try {
    read = await cmd(sid, 'read', {}, 60000);
    readMs = Date.now() - started;
    size = JSON.stringify(read).length;
  } catch (e) {
    readMs = `gave up after ${Date.now() - started} ms (${e.name})`;
  }
  const stale = read ? read.objects.filter(o => o.stale).length : 'unknown';
  started = Date.now();
  const flags = await p.evaluate(() => document.querySelectorAll('.stale-flag').length).catch(() => 'page did not answer');
  const flagMs = Date.now() - started;
  console.log(JSON.stringify({ rounds: ROUNDS, objects: 1 + 2 * ROUNDS, readMs, readBytes: size, staleObjects: stale, staleFlagsOnScreen: flags, pageAnswerMs: flagMs }));
  if (shot) { await p.evaluate(() => { window.__pairedEditor.zoomToFit(); }); await p.waitForTimeout(800); await p.screenshot({ path: shot }); }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
