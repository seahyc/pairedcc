// Live check of canvas_group over the dev-server HTTP relay and MCP stdio, in a real headless tab.
// Start the dev server (pnpm dev:canvas) with no canvas tab open, then:
//   node packages/canvas/tools/verify-group.cjs   (NODE_PATH=$(npm root -g) if playwright is global)
const { chromium } = require('playwright');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const base = 'http://localhost:5183';
const pkg = join(__dirname, '..');
let n = 0;
async function http(sessionId, op, input) {
  const r = await fetch(base + '/api/canvas/command', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `group-${Date.now()}-${n++}`, sessionId, actor: 'Test agent', command: { op, input } }) });
  return r.json();
}
const ok = async (...a) => { const j = await http(...a); if (!j.ok) throw new Error(`${a[1]}: ${j.error}`); return j.result; };
const fails = async (...a) => { const j = await http(...a); assert.equal(j.ok, false, `${a[1]} should fail`); return j.error; };
const g = (o) => ({ id: o.id, expectedRevision: o.revision });
const round = (b) => [b.x, b.y, b.w, b.h].map(Math.round).join(',');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errors = []; p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base + '/canvas/'); await p.waitForTimeout(2000); await p.reload(); await p.waitForTimeout(3500);
  const sid = (await (await fetch(base + '/api/canvas/sessions')).json()).sessions.at(-1).id;
  await ok(sid, 'page', { name: 'Group check' });
  const notes = [];
  // Hypothesis on the left, two evidence notes stacked to its right, an unrelated note below.
  const layout = [[0, 0], [600, 0], [600, 200], [0, 600]];
  for (const [i, text] of ['Hypothesis: repeat visits drive revenue', 'Evidence: 61% of orders are repeat', 'Evidence: loyalty card users spend 2x', 'Unrelated: café opening hours'].entries())
    notes.push(await ok(sid, 'create', { kind: 'note', x: layout[i][0], y: layout[i][1], width: 300, text }));
  const read = async () => (await ok(sid, 'read', {})).objects;
  const byId = async (id) => (await read()).find((o) => o.id === id);
  const before = await Promise.all(notes.map((o) => ok(sid, 'get', { id: o.id })));

  // Stale and locked objects reject the whole call; nothing changes.
  const frames = async () => (await read()).filter((o) => o.type === 'frame').length;
  console.log('stale rejected:', await fails(sid, 'group', { objects: [g(before[1]), { id: before[2].id, expectedRevision: before[2].revision + 5 }], name: 'Evidence' }));
  await p.evaluate((id) => { const e = window.__pairedEditor; e.updateShape({ id, type: 'card', isLocked: true }); }, notes[3].id);
  const locked = await byId(notes[3].id);
  console.log('locked rejected:', await fails(sid, 'group', { objects: [g(before[1]), g(locked)], name: 'Mixed' }));
  // A frame that would cover an object outside the group is refused, naming it.
  const covering = await fails(sid, 'group', { objects: [g(before[0]), g(before[2])], name: 'Too wide' });
  console.log('covering rejected:', covering.slice(0, 120));
  assert.match(covering, new RegExp(notes[1].id));
  assert.equal(await frames(), 0);

  // Group the two evidence notes: positions on the page are unchanged.
  const res = await ok(sid, 'group', { objects: [g(before[1]), g(before[2])], name: 'Evidence' });
  const after = await Promise.all([1, 2].map((i) => ok(sid, 'get', { id: notes[i].id })));
  console.log('frame:', res.frame.props.name, round(res.frame.bounds), '| children parent = frame:', after.every((o) => o.parentId === res.frame.id),
    '| page bounds unchanged:', after.every((o, i) => round(o.bounds) === round(before[i + 1].bounds)));
  assert.ok(after.every((o) => o.parentId === res.frame.id));
  assert.ok(after.every((o, i) => round(o.bounds) === round(before[i + 1].bounds)));

  // Mixed parents are refused; grouping inside a frame nests the new frame.
  console.log('mixed parents rejected:', await fails(sid, 'group', { objects: [g(await byId(notes[0].id)), g(await byId(notes[1].id))], name: 'Claim' }));
  const inner = await ok(sid, 'group', { objects: [g(await byId(notes[1].id))], name: 'Strongest evidence', padding: 16 });
  console.log('nested frame parent is the outer frame:', inner.frame.parentId === res.frame.id);
  assert.equal(inner.frame.parentId, res.frame.id);

  // Over MCP stdio, as an external agent would.
  const { Client } = await import(join(pkg, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'));
  const { StdioClientTransport } = await import(join(pkg, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js'));
  const client = new Client({ name: 'verify-group', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(pkg, 'node_modules/tsx/dist/cli.mjs'), join(pkg, 'tools/mcp.ts')], env: { ...process.env, PAIRED_URL: base, PAIRED_SESSION: sid } }));
  const hyp = await byId(notes[0].id);
  const mcp = await client.callTool({ name: 'canvas_group', arguments: { objects: [g(hyp)], name: 'Claim' } });
  const mcpResult = JSON.parse(mcp.content[0].text);
  console.log('MCP canvas_group:', mcp.isError ? 'error' : `frame "${mcpResult.frame.props.name}" holding ${mcpResult.objects.length}`);
  assert.ok(!mcp.isError);
  await client.close();

  await ok(sid, 'select', { ids: [] }); await ok(sid, 'focus', {}); await p.waitForTimeout(700);
  if (process.argv[2]) await p.screenshot({ path: process.argv[2] });

  // Undo the first group as one run: the frame goes, the notes stay where they were.
  const run = (await ok(sid, 'runs', {})).runs.find((r) => r.created.includes(res.frame.id));
  const undoInner = (await ok(sid, 'runs', {})).runs.find((r) => r.created.includes(inner.frame.id));
  await ok(sid, 'undo_run', { runId: undoInner.runId });
  await ok(sid, 'undo_run', { runId: run.runId });
  const restored = await Promise.all([1, 2].map((i) => ok(sid, 'get', { id: notes[i].id })));
  console.log('after undo: frame gone', !(await byId(res.frame.id)), '| notes back on the page', restored.every((o) => o.parentId.startsWith('page:')),
    '| positions kept', restored.every((o, i) => round(o.bounds) === round(before[i + 1].bounds)));
  assert.ok(!(await byId(res.frame.id)));
  assert.ok(restored.every((o, i) => round(o.bounds) === round(before[i + 1].bounds)));
  console.log('page errors:', errors);
  assert.deepEqual(errors, []);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
