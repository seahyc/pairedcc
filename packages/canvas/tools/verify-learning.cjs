// Headless check of the learning prompt prototype over the UI and the HTTP relay.
// Start the dev server (pnpm dev:canvas) with no canvas tab open, then:
//   node packages/canvas/tools/verify-learning.cjs   (writes learning-open.png and learning-answered.png)
const { chromium } = require('playwright');
const base = 'http://localhost:5183';
let n = 0;
async function http(sessionId, op, input) {
  const r = await fetch(base + '/api/canvas/command', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `learn-${Date.now()}-${n++}`, sessionId, actor: 'Test agent', command: { op, input } }) });
  return r.json();
}
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(base + '/canvas/'); await p.waitForFunction(() => Boolean(window.paired), null, { timeout: 30000 });
  console.log('button without flag:', await p.getByText('Learning prototype page').count());
  await p.goto(base + '/canvas/?prototype=learning'); await p.waitForFunction(() => Boolean(window.paired), null, { timeout: 30000 });
  const sid = await p.evaluate(() => document.documentElement.dataset.pairedSession);
  await p.waitForTimeout(1500);
  // The pages list sits behind the menu in the calm layout.
  await p.getByRole('button', { name: 'Menu' }).click(); await p.getByRole('menuitem', { name: /layers and pages/ }).click();
  await p.getByText('Learning prototype page').click();
  await p.waitForTimeout(800);
  const visible = (t) => p.getByText(t, { exact: false }).filter({ visible: true }).count();
  console.log('result visible before answering:', await visible('About 2 seconds'), '| explanation visible:', await visible('less dense than liquid water'));
  console.log('waiting notes:', await p.locator('.learn-hidden').allTextContents());
  await p.screenshot({ path: 'learning-open.png' });
  // Empty commit is refused with a message; nothing is revealed.
  await p.getByRole('button', { name: 'Commit my guess' }).click();
  console.log('empty commit:', await p.locator('.learn-error').textContent(), '| still hidden:', (await visible('About 2 seconds')) === 0);
  await p.getByLabel('What do you expect?').fill('Maybe 3 seconds?');
  await p.getByRole('button', { name: 'Commit my guess' }).click();
  await p.waitForTimeout(400);
  console.log('after commit, result visible:', await visible('About 2 seconds'), '| guess kept:', await p.locator('.learn-answer p').first().textContent());
  await p.getByRole('button', { name: 'Skip, show me' }).click();
  await p.waitForTimeout(400);
  console.log('after skip, explanation visible:', await visible('less dense than liquid water'), '|', await p.locator('.learn-answer.skipped').textContent());
  await p.screenshot({ path: 'learning-answered.png' });
  const read = await http(sid, 'read', {});
  const prompts = read.result.objects.filter(o => o.type === 'prompt').map(o => ({ mode: o.props.mode, status: o.props.status, response: o.props.response }));
  console.log('agent reads prompts:', JSON.stringify(prompts));
  // Agent creates a prompt over HTTP hiding its own note; it cannot answer it.
  const note = await http(sid, 'create', { kind: 'note', x: 900, y: 300, text: 'Agent answer: 42' });
  const prompt = await http(sid, 'learn', { mode: 'generate', question: 'What is six times seven, and why?', x: 900, y: 0, hideIds: [note.result.id] });
  console.log('learn op:', prompt.ok, JSON.stringify(prompt.result));
  await p.waitForTimeout(300);
  console.log('agent note hidden (canvas and layers):', (await visible('Agent answer: 42')) === 0, '| layer label:', await p.getByText('Hidden until you answer').count());
  const pr = (await http(sid, 'get', { id: prompt.result.id })).result;
  const forge = await http(sid, 'update', { id: pr.id, expectedRevision: pr.revision, text: 'forged answer' });
  console.log('agent cannot answer:', forge.ok === false, forge.error);
  const bad = await http(sid, 'learn', { mode: 'predict', question: 'Q', x: 0, y: 0, hideIds: ['shape:missing'] });
  console.log('missing hide target rejected:', bad.ok === false, bad.error);
  // Undoing the agent's prompt is one history step and shows its note again.
  await p.evaluate(() => { window.paired.undo(); });
  await p.waitForTimeout(300);
  console.log('after undoing the prompt, agent note visible:', await visible('Agent answer: 42'));
  console.log('errors:', errors);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
