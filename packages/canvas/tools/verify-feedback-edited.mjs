// Browser check for item 140 (c), task 12: the feedback queue says when a comment's target was
// edited after the comment. The person writes a card, comments on it, then edits the card's words
// in the tab; the agent's canvas_feedback gives that target `editedAt`. A target left alone has none.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-feedback-edited.mjs <screenshot dir>
//
// Needs the dev server (PAIRED_URL, default http://localhost:5183) with an empty board store.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-feedback-edited.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = process.env.PAIRED_URL ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await p.waitForTimeout(800);
const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
const list = sessions.sessions ?? sessions;
const sessionId = list[list.length - 1].id ?? list[list.length - 1].sessionId;
let n = 0;
async function command(op, input) {
  const res = await fetch(`${BASE}/api/canvas/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: `feedback-edited-${Date.now()}-${++n}`, sessionId, actor: 'Verifier', command: { op, input } }) });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}

// Two cards of the person's, each with a comment of theirs; then they edit the first card's words.
const ids = await p.evaluate(() => {
  const edited = window.paired.create({ kind: 'rectangle', x: 100, y: 500, width: 260, height: 100, text: 'Price: £40 a month' });
  const left = window.paired.create({ kind: 'rectangle', x: 1000, y: 200, width: 260, height: 100, text: 'Launch in March' });
  return { edited, left };
});
// Comments made as the person does: through the bridge's comment path (the toolbar's C).
for (const id of [ids.edited, ids.left]) {
  await p.evaluate((id) => { window.paired.select([id]); }, id);
  await p.keyboard.press('c');
  await p.waitForTimeout(300);
  await p.keyboard.type(id === ids.edited ? 'Too expensive?' : 'Is March realistic?');
  await p.keyboard.press('Escape');
  await p.keyboard.press('Escape');
  await p.evaluate(() => { window.__pairedEditor.selectNone(); });
  await p.waitForTimeout(300);
}
const before = await command('feedback', {});
const item = (q, target) => q.items.find((i) => i.kind === 'comment' && i.targetIds.length === 1 && i.targetIds[0] === target);
check('both comments are in the queue', Boolean(item(before, ids.edited) && item(before, ids.left)), JSON.stringify(before.items.map((i) => [i.text, i.targetIds])) + ' ' + JSON.stringify(ids));
check('before any edit, no target says it was edited', !item(before, ids.edited)?.targets[0].editedAt && !item(before, ids.left)?.targets[0].editedAt);
await p.waitForTimeout(50);
await p.evaluate((id) => { const o = window.paired.read().objects.find((x) => x.id === id); window.paired.update({ id, expectedRevision: o.revision, text: 'Price: £30 a month' }); }, ids.edited);
await p.waitForTimeout(200);
const after = await command('feedback', {});
const t = item(after, ids.edited)?.targets[0];
check('after the person edits the card, its comment\'s target carries editedAt', typeof t?.editedAt === 'string' && Date.parse(t.editedAt) > Date.parse(item(after, ids.edited).createdAt), JSON.stringify(t));
check('the card nobody edited still has none', !item(after, ids.left)?.targets[0].editedAt, JSON.stringify(item(after, ids.left)?.targets[0]));
await p.screenshot({ path: `${out}/feedback-edited.png` });
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
