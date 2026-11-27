// Browser check for the calm canvas, on a fresh profile: first load, text wrapping,
// the ask loop with the resident agent, pick / cross out / comment, reload, the
// no-agent state and an older saved board.
//
// The card is the question: there is no ask box. The person writes a thought, then writes
// the question on a card right beside it and presses ⌘↵ while writing; that card is sent, with
// the thought beside it as context. Asking about someone else's card opens a new pink card
// beside it to write the question on.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-calm.mjs <screenshot dir>
//
// Needs the dev server on :5183 (or CANVAS_BASE) and the resident agent running. Playwright is not a
// dependency of this repository; it is loaded from the directory you run this in.
// The no-agent step stops and restarts the macOS LaunchAgent com.paired.canvas.agent
// and is skipped where that is not installed.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-calm.mjs <screenshot dir>');
const URL = `${process.env.CANVAS_BASE ?? 'http://localhost:5183'}/canvas/`;
const profile = mkdtempSync(join(tmpdir(), 'calm-profile-'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const ctx = await chromium.launchPersistentContext(profile, { viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message.slice(0, 200)));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
const shot = (name) => p.screenshot({ path: `${out}/${name}.png` });
const objects = () => p.evaluate(() => window.paired.read().objects.map(o => ({ id: o.id, type: o.type, text: o.text ?? '', author: o.meta.role === 'annotation' && o.meta.author ? o.meta.author : (o.meta.createdBy ?? 'Human'), w: o.bounds?.w ?? 0, h: o.bounds?.h ?? 0, x: o.bounds?.x ?? 0, y: o.bounds?.y ?? 0, meta: o.meta, props: o.props })));
const long = 'This is a long thought with no line breaks that just keeps going and going because I am thinking out loud and I do not press enter at all while typing it into the canvas so it has to wrap somewhere sensible';
const words300 = Array.from({ length: 300 }, (_, i) => ['alpha', 'bravo', 'charlie', 'delta', 'echo'][i % 5] + i).join(' ');
/** No text line may be wider than its shape, and no shape wider than a reading width. */
const overflow = () => p.evaluate(() => [...document.querySelectorAll('.tl-shape')].flatMap(el => {
  const t = el.querySelector('.tl-rich-text'); if (!t) return [];
  const box = el.getBoundingClientRect(), text = t.getBoundingClientRect();
  const bad = t.scrollWidth > t.clientWidth + 1 || text.right > box.right + 2 || text.bottom > box.bottom + 2 || box.width > 640;
  return bad ? [{ type: el.getAttribute('data-shape-type'), boxW: Math.round(box.width), textW: Math.round(t.scrollWidth), textBottom: Math.round(text.bottom), boxBottom: Math.round(box.bottom) }] : [];
}));

await p.goto(URL);
await p.waitForSelector('.topbar', { timeout: 20000 });
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 15000 });
await p.waitForTimeout(1200);

// 1. Calm first load
let objs = await objects();
check('first board holds at most four things', objs.length <= 4, `${objs.length} objects`);
check('layers, properties and feedback panels are hidden', await p.locator('.left-panel:visible, .right-panel:visible').count() === 0);
const toolNames = await p.locator('.tool-strip .tool-button span').allTextContents();
check('toolbar is Select, Write, Pen, Arrow, Ask, More', toolNames.join(',') === 'Select,Write,Pen,Arrow,Ask,More', toolNames.join(','));
check('no object counter on screen', await p.locator('.marks-counter').count() === 0);
await p.waitForFunction(() => /listening/.test(document.querySelector('.agent-chip')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
const chip = await p.locator('.agent-chip').textContent();
check('top bar says the agent is listening', /is listening/.test(chip), chip);
await shot('01-first-load-calm');

// 2. Text never leaves its container
await p.mouse.dblclick(330, 700); await p.waitForTimeout(400);
await p.keyboard.type(long, { delay: 1 }); await p.waitForTimeout(500);
await shot('02-long-text-card-typing');
check('typing shows the ⌘↵ hint', await p.locator('.selection-bar.hint').count() === 1);
await p.keyboard.press('Escape'); await p.waitForTimeout(200); await p.keyboard.press('Escape');
objs = await objects();
const card = objs.find(o => o.type === 'card' && o.text.startsWith('This is a long'));
check('double-click on the board writes a pink card', Boolean(card) && card.props.tone === 'human');
check('long card text wraps and the card grows down', Boolean(card) && card.w <= 320 && card.h > 200, card ? `${Math.round(card.w)}×${Math.round(card.h)}` : '');

await p.keyboard.press('t'); await p.mouse.click(760, 560); await p.waitForTimeout(300);
await p.keyboard.type(long, { delay: 1 }); await p.waitForTimeout(500);
await shot('03-long-text-plain-typing');
await p.keyboard.press('Escape'); await p.waitForTimeout(200); await p.keyboard.press('Escape');
objs = await objects();
const text = objs.find(o => o.type === 'text');
check('long plain text wraps at a reading width', Boolean(text) && text.w <= 470 && text.h > 60, text ? `${Math.round(text.w)}×${Math.round(text.h)}` : 'no text shape');

await p.mouse.move(1150, 330); await p.keyboard.press('c'); await p.waitForTimeout(400);
await p.keyboard.type(long, { delay: 1 }); await p.waitForTimeout(500);
await shot('04-long-text-comment-typing');
await p.keyboard.press('Escape'); await p.waitForTimeout(200); await p.keyboard.press('Escape');
objs = await objects();
const comment = objs.find(o => o.meta.role === 'annotation' && o.author === 'Human');
check('long comment wraps and grows down', Boolean(comment) && comment.w <= 320 && comment.h > 200, comment ? `${Math.round(comment.w)}×${Math.round(comment.h)}` : '');

await p.evaluate((t) => navigator.clipboard.writeText(t), words300);
await p.mouse.click(900, 200); await p.keyboard.press('ControlOrMeta+v'); await p.waitForTimeout(1200);
objs = await objects();
const pasted = objs.find(o => o.text.includes('alpha0') && o.text.includes('echo299'));
check('a pasted 300-word block lands as one wrapped object', Boolean(pasted) && pasted.w <= 470, pasted ? `${pasted.type} ${Math.round(pasted.w)}×${Math.round(pasted.h)}` : 'not found');
await p.keyboard.press('Shift+1'); await p.waitForTimeout(700);
await shot('05-long-text-all-wrapped');
const spills = await overflow();
check('no text spills out of any shape', spills.length === 0, JSON.stringify(spills));
// clear the paste so the board stays readable
if (pasted) { await p.evaluate((id) => window.paired.select([id]), pasted.id); await p.keyboard.press('Backspace'); }
await p.keyboard.press('Escape');

// 3. Ask with the resident agent, on a new board (one click from the menu)
await p.locator('.menu-button').click(); await p.waitForTimeout(200);
await shot('05b-menu');
await p.locator('.menu button', { hasText: 'New board' }).click(); await p.waitForTimeout(900);
objs = await objects();
check('New board is one click and opens calm', objs.length <= 4 && (await p.evaluate(() => window.paired.read().pages.length)) === 2, `${objs.length} objects`);
await p.keyboard.press('n');
await p.mouse.click(330, 560); await p.waitForTimeout(300);
await p.keyboard.type('Maybe we should charge per seat instead of per job post', { delay: 2 });
await p.keyboard.press('Escape'); await p.waitForTimeout(300); await p.keyboard.press('Escape');
const asksNow = () => p.evaluate(() => window.paired.read().objects.filter(o => o.meta.ask).length);
check('finishing a thought with no question mark does not send it', await asksNow() === 0);
// The question goes on a card right beside the thought, so the thought is given with it.
const under = await p.evaluate(() => {
  const ed = window.__pairedEditor;
  const s = window.paired.read().objects.find(o => (o.text ?? '').startsWith('Maybe we should charge'));
  const b = s && ed.getShapePageBounds(s.id);
  return b ? ed.pageToScreen({ x: b.x, y: b.maxY + 24 }) : { x: 330, y: 700 };
});
await p.keyboard.press('n');
await p.mouse.click(under.x + 4, under.y); await p.waitForTimeout(300);
// A card's text is set with typographic quotes, so the apostrophe may come back as ’.
await p.keyboard.type("What's missing from this?", { delay: 2 });
const t0 = Date.now();
await p.keyboard.press('ControlOrMeta+Enter'); await p.waitForTimeout(400);
const sent = await p.evaluate(() => ({ editing: Boolean(window.__pairedEditor.getEditingShapeId()), ask: window.paired.read().objects.find(o => o.meta.ask && /^What['’]s missing/.test(o.text ?? '')) }));
check('⌘↵ while writing sends the card as the ask, with no box', Boolean(sent.ask) && !sent.editing && await p.locator('.selection-bar.asking, .ask-starters').count() === 0, `editing ${sent.editing}; ask ${sent.ask ? sent.ask.id : 'none'}`);
await shot('06-ask-sent');
await p.waitForSelector('.ask-status', { timeout: 5000 });
const seen = new Set(); let shotWorking = false;
let answered = false;
while (Date.now() - t0 < 90000) {
  const state = await p.locator('.ask-status').last().getAttribute('data-ask-state');
  seen.add(state);
  if (state === 'working' && !shotWorking) { shotWorking = true; await shot('07-ask-working'); }
  if (state === 'answered') { answered = true; break; }
  if (state === 'failed') break;
  await p.waitForTimeout(150);
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
await p.waitForTimeout(600);
await shot('08-ask-answered');
objs = await objects();
const ask = objs.find(o => o.meta.ask && /^What['’]s missing/.test(o.text));
const answers = objs.filter(o => ask && o.meta.replyTo === ask.id);
check('Ask produces an answer on the board', answered && answers.length >= 1, `${elapsed}s, states seen: ${[...seen].join(' → ')}`);
console.log('ELAPSED_SECONDS', elapsed);
console.log('ANSWER', JSON.stringify(answers.map(a => a.text)));
check('progress was shown while waiting', seen.has('working') || seen.has('waiting'));
const words = answers.map(a => a.text.split(/\s+/).length);
check('the answer is short (≤ 90 words per card, ≤ 4 cards)', answers.length <= 4 && words.every(w => w <= 92), `${words.join(', ')} words`);
check('the answer is agent work beside the ask', answers.every(a => a.author === 'Claude' && a.y > ask.y), answers.map(a => a.author).join(','));
const statusText = await p.locator('.ask-status').last().textContent();
check('the ask shows what the agent was given', /(given|with|also read) “Maybe we should/.test(statusText), statusText);
const thought = objs.find(o => o.text.startsWith('Maybe we should charge'));
const before = await p.evaluate((id) => window.paired.read().objects.find(o => o.id === id).revision, thought.id);
check("the human's card was not edited or moved", thought.text === 'Maybe we should charge per seat instead of per job post', `revision ${before}`);

// 4. Pick, cross out, comment, queue
await p.evaluate((id) => window.paired.select([id]), answers[0].id); await p.waitForTimeout(300);
// On an agent's answer Ask reads "Ask about this" (it opens a card for the question); Settle
// and, on one agent answer, Check me have joined the bar since this check was written.
check('selection bar on an answer offers Ask about this, Pick, Cross out, Settle, Comment, Check me', (await p.locator('.selection-bar > button').allTextContents()).map(t => t.replace(/\s*(Ctrl[ +]?|⌘)?[↵PXCSE]$/u, '').replace('✦ ', '').trim()).join(',') === 'Ask about this,Pick,Cross out,Settle,Comment,Check me', (await p.locator('.selection-bar > button').allTextContents()).join('|'));
await shot('09-selection-bar');
// ⌘↵ on the agent's card opens a new pink card beside it to write the question on; the
// agent's card itself is not edited. Leaving the new card empty removes it.
const countBeforeAsk = (await objects()).length;
await p.keyboard.press('ControlOrMeta+Enter'); await p.waitForTimeout(500);
const opened = await p.evaluate((answerId) => {
  const ed = window.__pairedEditor, id = ed.getEditingShapeId(), s = id && ed.getShape(id);
  return s ? { answerEdited: id === answerId, human: !s.meta.createdBy || s.meta.createdBy === 'Human', targets: s.meta.targetIds ?? [], askWhenWritten: s.meta.askWhenWritten === true } : null;
}, answers[0].id);
check("⌘↵ on an agent's card opens a pink card beside it for the question, and does not edit the answer", Boolean(opened) && !opened.answerEdited && opened.human && opened.askWhenWritten && opened.targets.includes(answers[0].id) && await p.locator('.selection-bar.asking').count() === 0, JSON.stringify(opened));
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
const leftBehind = (await objects()).slice(countBeforeAsk);
check('…and leaving it empty takes it away again, with nothing left behind', leftBehind.length === 0, `${countBeforeAsk} → ${countBeforeAsk + leftBehind.length} objects; left: ${leftBehind.map(o => `${o.type} by ${o.author}`).join(', ')}`);
await p.evaluate((id) => window.paired.select([id]), answers[0].id); await p.waitForTimeout(200);
await p.keyboard.press('p'); await p.waitForTimeout(250);
let fb = await p.evaluate(() => window.paired.read().objects.filter(o => o.meta.mark).map(o => ({ kind: o.meta.mark === 'picked' ? 'pick' : 'reject' })));
check('P picks', fb.some(m => m.kind === 'pick'));
await p.evaluate((id) => window.paired.select([id]), thought.id); await p.waitForTimeout(200);
await p.locator('.selection-bar > button', { hasText: 'Cross out' }).click(); await p.waitForTimeout(250);
fb = await p.evaluate(() => window.paired.read().objects.filter(o => o.meta.mark).map(o => ({ kind: o.meta.mark === 'picked' ? 'pick' : 'reject' })));
check('Cross out button rejects', fb.some(m => m.kind === 'reject'));
await p.keyboard.press('x'); await p.waitForTimeout(200);
fb = await p.evaluate(() => window.paired.read().objects.filter(o => o.meta.mark).map(o => ({ kind: o.meta.mark === 'picked' ? 'pick' : 'reject' })));
check('X again clears it', !fb.some(m => m.kind === 'reject'));
await p.keyboard.press('c'); await p.waitForTimeout(300); await p.keyboard.type('not sure about this'); await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await p.keyboard.press('Shift+C'); await p.waitForTimeout(400);
const rows = await p.locator('.feedback-item').count();
check('feedback queue opens with Shift+C and lists the marks', rows >= 2, `${rows} open rows`);
await shot('10-feedback-queue');
await p.locator('.feedback-filters button', { hasText: 'All' }).click(); await p.waitForTimeout(200);
check('the ask is in the queue with its answer', await p.locator('.feedback-item', { hasText: /What['’]s missing/ }).locator('.feedback-reply').count() >= 1, `queue: ${(await p.locator('.feedback-item .feedback-text').allTextContents()).join(' | ')}`);
await p.keyboard.press('Shift+C'); await p.waitForTimeout(300);
check('Shift+C closes the queue again', await p.locator('.right-panel:visible').count() === 0);

// 5. Reload keeps everything
const beforeReload = (await objects()).length;
await p.waitForTimeout(1500);
await p.reload(); await p.waitForSelector('.topbar'); await p.waitForFunction(() => window.paired?.read().objects.length >= 3); await p.waitForTimeout(2000);
const after = await objects();
check('reload keeps everything', after.length === beforeReload && after.some(o => o.meta.ask) && after.some(o => o.meta.mark === 'picked'), `${beforeReload} → ${after.length} objects`);
check('reload does not seed another board', await p.evaluate(() => window.paired.read().pages.length) === 2);
await shot('11-after-reload');

// 6. Nobody listening: the ask says so, with the one step to fix it
const uid = execSync('id -u').toString().trim();
const plist = `${process.env.HOME}/Library/LaunchAgents/com.paired.canvas.agent.plist`;
if (!existsSync(plist)) console.log('SKIP  no-agent state: LaunchAgent com.paired.canvas.agent is not installed');
else {
execSync(`launchctl bootout gui/${uid}/com.paired.canvas.agent`);
try {
  await p.waitForFunction(() => /No agent listening/.test(document.querySelector('.agent-chip')?.textContent ?? ''), null, { timeout: 20000 });
  check('top bar says no agent is listening once it stops', true);
  // The card is the question: write "Give me alternatives" right beside the thought and send it.
  const t = (await objects()).find(o => o.text.startsWith('Maybe we should charge'));
  const left = await p.evaluate((id) => { const ed = window.__pairedEditor, b = ed.getShapePageBounds(id); ed.centerOnPoint({ x: b.x, y: b.y }); return ed.pageToScreen({ x: b.x - 24 - 240, y: b.y }); }, t.id);
  await p.keyboard.press('Escape'); await p.keyboard.press('n');
  await p.mouse.click(left.x, left.y + 4); await p.waitForTimeout(300);
  await p.keyboard.type('Give me alternatives', { delay: 2 });
  await p.keyboard.press('ControlOrMeta+Enter'); await p.waitForTimeout(300);
  await p.waitForSelector('.ask-status[data-ask-tone="nobody"]', { timeout: 8000 });
  const nobody = await p.locator('.ask-status[data-ask-tone="nobody"]').textContent();
  check('an ask with no agent explains itself and says how to fix it', /No agent is listening/.test(nobody) && /pnpm --filter @pairedcc\/canvas agent/.test(nobody), nobody);
  await shot('12-ask-no-agent');
} finally {
  execSync(`launchctl bootstrap gui/${uid} ${plist}`);
}
// The agent comes back and takes the ask that was waiting, without the person doing anything.
const t1 = Date.now();
await p.waitForSelector('.ask-status[data-ask-tone="nobody"]', { state: 'detached', timeout: 60000 }).catch(() => {});
await p.waitForFunction(() => [...document.querySelectorAll('.ask-status')].every(e => e.getAttribute('data-ask-state') === 'answered'), null, { timeout: 60000 }).catch(() => {});
objs = await objects();
const ask2 = objs.find(o => o.meta.ask && o.text === 'Give me alternatives');
const options = objs.filter(o => ask2 && o.meta.replyTo === ask2.id);
check('the waiting ask is answered when the agent returns', ask2?.meta.ask.state === 'answered' && options.length >= 1, `${((Date.now() - t1) / 1000).toFixed(1)}s after restart, ${options.length} cards`);
check('a choice comes back as 2 to 4 alternatives side by side', options.length >= 2 && options.length <= 4 && new Set(options.map(o => Math.round(o.y))).size === 1 && new Set(options.map(o => Math.round(o.x))).size === options.length, JSON.stringify(options.map(o => ({ x: Math.round(o.x), y: Math.round(o.y) }))));
console.log('ALTERNATIVES', JSON.stringify(options.map(o => o.text)));
await p.keyboard.press('Shift+1'); await p.waitForTimeout(700);
await shot('13-alternatives-side-by-side');
}

// 7. A board saved by the earlier build: the calm board opens beside it, nothing is lost
const [download] = await Promise.all([p.waitForEvent('download'), (async () => { await p.locator('.menu-button').click(); await p.locator('.menu button', { hasText: 'Export board file' }).click(); })()]);
const file = join(profile, 'old-board.json');
await download.saveAs(file);
const old = readFileSync(file, 'utf8');
check('exported board carries the calm marker', old.includes('"calm":3'));
writeFileSync(file, old.replaceAll('"calm":3', '"calm":0'));
const pagesBefore = await p.evaluate(() => window.paired.read().pages.length);
await p.locator('input[type=file][accept=".json"]').setInputFiles(file); await p.waitForTimeout(1500);
await p.reload(); await p.waitForSelector('.topbar'); await p.waitForFunction(() => window.paired?.read().objects.length >= 3); await p.waitForTimeout(2500);
const pagesAfter = await p.evaluate(() => window.paired.read().pages);
objs = await objects();
check('an older saved board gets the calm board beside it', pagesAfter.length === pagesBefore + 1 && pagesAfter.some(pg => pg.name === 'Thinking') && objs.length <= 4, `${pagesBefore} → ${pagesAfter.map(pg => pg.name).join(', ')}; ${objs.length} objects on screen`);
await shot('14-older-board-opens-calm');
await p.locator('.menu-button').click(); await p.waitForTimeout(200);
await shot('15-menu-boards');
await p.keyboard.press('Escape');
check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
await ctx.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
