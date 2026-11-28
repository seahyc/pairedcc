// Browser check for item 147: a comment's arrow is never drawn across the words of another card,
// and it ends at the edge of what it is about. The person pastes a ten-point review sheet (each
// row becomes a record: a title line over four field cards in a row), steps to record 3 and
// comments with C on its "defence" card, the second card of the row. The comment sits beside the
// whole record, so the straight line to that card ran over the "Gap / exposure" and "Suggested fix"
// cards' text. Also: a comment on a whole record ends at the record's edge facing it, and a comment
// on a plain card, dragged past another card, does not cross that card's words. Nothing of the
// person's moves.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-arrow-clear.mjs <screenshot dir> [shot name]
//
// Needs the dev server (CANVAS_BASE, default :5183) with an empty board store. The drawn arrow is
// read from the page: its body path sampled along its length, against each card's rendered text
// box. Screenshots at device scale 2; the record one is <shot name>.png (default arrow-clear).
// All data is synthetic.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-arrow-clear.mjs <screenshot dir> [shot name]');
mkdirSync(out, { recursive: true });
const shotName = process.argv[3] ?? 'arrow-clear';
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const fixture = (name) => readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8');
const results = [];
// How near the arrow's tip must be to the edge: tldraw stops an arrowhead bound to a shape about
// 10px plus its stroke short of the outline (a group, which has no outline of its own, gets 0).
const NEAR = 14;
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await p.waitForTimeout(1000);

const objects = () => p.evaluate(() => window.paired.read().objects.map((o) => ({ id: o.id, type: o.type, parentId: o.parentId, text: o.text ?? '', x: o.bounds?.x ?? 0, y: o.bounds?.y ?? 0, w: o.bounds?.w ?? 0, h: o.bounds?.h ?? 0, meta: o.meta })));
const kind = (o) => o.meta.source?.kind;
const positions = async () => Object.fromEntries((await objects()).filter((o) => o.meta.role !== 'annotation' && o.type !== 'arrow').map((o) => [o.id, `${Math.round(o.x)},${Math.round(o.y)}`]));
const comment = async (text) => {
  await p.keyboard.press('c'); await p.waitForTimeout(500);
  await p.keyboard.type(text, { delay: 5 }); await p.keyboard.press('Escape'); await p.waitForTimeout(800);
  return (await objects()).find((o) => o.meta.role === 'annotation' && o.text.includes(text));
};

/**
 * The comment's drawn arrow in page space, the rendered text boxes of every other card it passes,
 * and how far its tip is from the target's box. Shows comment and target first, so both are drawn.
 */
const measure = (commentId, targetId) => p.evaluate(async ([commentId, targetId]) => {
  const ed = window.__pairedEditor;
  const arrow = ed.getCurrentPageShapes().find((s) => s.type === 'arrow' && s.meta.fromId === commentId && s.meta.toId === targetId);
  if (!arrow) return { error: 'no arrow' };
  const c = ed.getShapePageBounds(commentId), t = ed.getShapePageBounds(targetId);
  const x = Math.min(c.x, t.x) - 80, y = Math.min(c.y, t.y) - 120;
  ed.zoomToBounds({ x, y, w: Math.max(c.maxX, t.maxX) + 80 - x, h: Math.max(c.maxY, t.maxY) + 160 - y }, { animation: { duration: 0 }, targetZoom: 1 });
  await new Promise((r) => setTimeout(r, 400));
  const el = document.querySelector(`[data-shape-id="${arrow.id}"]`);
  const body = [...el.querySelectorAll('path')].filter((q) => !q.closest('clipPath') && !q.getAttribute('fill')).sort((a, b) => b.getTotalLength() - a.getTotalLength())[0];
  const transform = ed.getShapePageTransform(arrow.id);
  const len = body.getTotalLength();
  const points = Array.from({ length: Math.ceil(len / 3) + 1 }, (_, i) => { const q = body.getPointAtLength(Math.min(len, i * 3)); return transform.applyToPoint({ x: q.x, y: q.y }); });
  const own = new Set([commentId, targetId, ...ed.getSortedChildIdsForParent(targetId)]);
  const texts = [...document.querySelectorAll('.tl-shape[data-shape-type="card"]')].flatMap((s) => {
    const id = s.getAttribute('data-shape-id'), text = s.querySelector('.tl-rich-text');
    if (own.has(id) || !text || !text.textContent.trim()) return [];
    const r = text.getBoundingClientRect(), a = ed.screenToPage({ x: r.left, y: r.top }), b = ed.screenToPage({ x: r.right, y: r.bottom });
    return [{ id, words: text.textContent.slice(0, 40), x: a.x, y: a.y, maxX: b.x, maxY: b.y }];
  });
  const hit = texts.filter((r) => points.some((q) => q.x > r.x && q.x < r.maxX && q.y > r.y && q.y < r.maxY));
  const crossed = hit.map((r) => r.words), crossedIds = hit.map((r) => r.id);
  const tip = points[points.length - 1];
  // Distance from the tip to the target's outline (0 on an edge), and which side it is on.
  const inside = tip.x > t.x && tip.x < t.maxX && tip.y > t.y && tip.y < t.maxY;
  const outside = Math.hypot(Math.max(t.x - tip.x, 0, tip.x - t.maxX), Math.max(t.y - tip.y, 0, tip.y - t.maxY));
  const edge = inside ? Math.min(tip.x - t.x, t.maxX - tip.x, tip.y - t.y, t.maxY - tip.y) : outside;
  const sides = { left: Math.abs(tip.x - t.x), right: Math.abs(tip.x - t.maxX), top: Math.abs(tip.y - t.y), bottom: Math.abs(tip.y - t.maxY) };
  const side = Object.entries(sides).sort((a, b) => a[1] - b[1])[0][0];
  const facing = c.x >= t.maxX ? 'right' : c.maxX <= t.x ? 'left' : c.y >= t.maxY ? 'bottom' : 'top';
  return { inside, crossed, crossedIds, edge: Math.round(edge * 10) / 10, side, facing, tip: { x: Math.round(tip.x), y: Math.round(tip.y) }, bend: Math.round(arrow.props.bend) };
}, [commentId, targetId]);

// 1. The review sheet as ten records; step to record 3.
await p.mouse.click(1000, 620);
await p.evaluate(async (d) => {
  const item = {};
  for (const [type, value] of Object.entries(d)) item[type] = new Blob([value], { type });
  await navigator.clipboard.write([new ClipboardItem(item)]);
}, { 'text/html': fixture('review.html'), 'text/plain': fixture('review.tsv') });
await p.keyboard.press('ControlOrMeta+v'); await p.waitForTimeout(1500);
await p.keyboard.press('Escape');
let objs = await objects();
const recs = objs.filter((o) => kind(o) === 'record').sort((a, b) => a.y - b.y);
check('the review sheet became ten records', recs.length === 10, `${recs.length}`);
for (let i = 0; i < 3; i++) { await p.keyboard.press('j'); await p.waitForTimeout(500); }
const fieldsOf = (id) => objs.filter((o) => o.parentId === id && kind(o) === 'field').sort((a, b) => a.x - b.x);
const [, defence, gap] = fieldsOf(recs[2].id);
const before = await positions();

// 2. Comment with C on the record's defence card.
await p.evaluate((id) => window.paired.select([id]), defence.id); await p.waitForTimeout(200);
const onCard = await comment('Only one of three funders signed');
check('C pins a comment to the defence card, beside the record', Boolean(onCard) && onCard.meta.targetId === defence.id && onCard.x >= recs[2].x + recs[2].w, onCard ? `at ${Math.round(onCard.x)},${Math.round(onCard.y)}` : 'no comment');
let m = await measure(onCard.id, defence.id);
check('the arrow crosses no other card\'s words', !m.error && m.crossed.length === 0, m.error ?? `crosses ${JSON.stringify(m.crossed)}`);
check('the arrow does not strike through the Gap / exposure card', !m.error && !m.crossedIds.includes(gap.id), m.error ?? '');
check('the arrow ends on the edge of the defence card', !m.error && !m.inside && m.edge <= NEAR, m.error ?? `tip ${JSON.stringify(m.tip)} is ${m.edge}px from its outline (${m.side} side), bend ${m.bend}`);
// The view the person had: the record stepped to, selected, the comment beside it.
await p.evaluate(([rec, c]) => {
  const ed = window.__pairedEditor, a = ed.getShapePageBounds(rec), b = ed.getShapePageBounds(c);
  const x = Math.min(a.x, b.x) - 40, y = Math.min(a.y, b.y) - 40;
  ed.zoomToBounds({ x, y, w: Math.max(a.maxX, b.maxX) + 40 - x, h: Math.max(a.maxY, b.maxY) + 40 - y }, { animation: { duration: 0 }, targetZoom: 1 });
  window.paired.select([rec]); document.activeElement?.blur?.();
}, [recs[2].id, onCard.id]);
await p.waitForTimeout(500);
await p.screenshot({ path: `${out}/${shotName}.png` });
await p.keyboard.press('Escape');

// 3. A comment on the whole record ends at the record's edge facing it.
await p.evaluate((id) => window.paired.select([id]), recs[3].id); await p.waitForTimeout(200);
const onRecord = await comment('Which survey, and when');
check('C pins a comment to the whole record', Boolean(onRecord) && onRecord.meta.targetId === recs[3].id, onRecord ? '' : 'no comment');
m = await measure(onRecord.id, recs[3].id);
check('the record comment\'s arrow crosses no card\'s words', !m.error && m.crossed.length === 0, m.error ?? `crosses ${JSON.stringify(m.crossed)}`);
check('it ends on the record\'s edge facing the comment', !m.error && !m.inside && m.edge <= NEAR && m.side === m.facing, m.error ?? `tip ${JSON.stringify(m.tip)} ${m.edge}px from the ${m.side} side; facing ${m.facing}`);
await p.screenshot({ path: `${out}/${shotName}-record.png` });
await p.keyboard.press('Escape');
const after = await positions();
const moved = Object.keys(before).filter((id) => after[id] && after[id] !== before[id]);
check('nothing of the person\'s moved', moved.length === 0, moved.join(', '));

// 4. A plain card, a comment on it, and the comment dragged past another card level with it.
const make = (x, y, text) => p.evaluate(([x, y, text]) => { const r = window.paired.create({ kind: 'note', x, y, width: 260, text }); return typeof r === 'string' ? r : r.id; }, [x, y, text]);
const lone = await make(200, 4200, 'Price the team plan per seat, billed monthly');
const between = await make(560, 4200, 'Three teams said they would pay ten a seat, two said they would not pay for seats at all');
await p.evaluate((id) => window.paired.select([id]), lone); await p.waitForTimeout(200);
const plain = await comment('Is ten a seat right?');
check('C pins a comment to the plain card', Boolean(plain) && plain.meta.targetId === lone);
await p.evaluate(([id, x, y]) => { const ed = window.__pairedEditor; ed.updateShape({ id, type: 'card', x, y }); }, [plain.id, 960, 4200]);
await p.waitForTimeout(500);
m = await measure(plain.id, lone);
check('dragged past another card, its arrow does not cross that card\'s words', !m.error && m.crossed.length === 0, m.error ?? `crosses ${JSON.stringify(m.crossed)}`);
check('and still ends on the edge of the card it is about', !m.error && !m.inside && m.edge <= NEAR, m.error ?? `tip ${JSON.stringify(m.tip)} ${m.edge}px from the ${m.side} side, bend ${m.bend}`);
await p.screenshot({ path: `${out}/${shotName}-plain.png` });
void between;

// 5. With nothing in the way, the arrow is the usual one: facing sides, gentle bend.
const free = await make(200, 5200, 'Ship the import before the board sync');
await p.evaluate((id) => window.paired.select([id]), free); await p.waitForTimeout(200);
const simple = await comment('Why first?');
m = await measure(simple.id, free);
check('with nothing between, the arrow joins the facing sides as before', !m.error && m.crossed.length === 0 && !m.inside && m.edge <= NEAR && m.side === m.facing && Math.abs(m.bend) <= 60, m.error ?? `${m.side} side, facing ${m.facing}, bend ${m.bend}`);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
