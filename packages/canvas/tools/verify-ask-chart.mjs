// Browser check for item 61: an ask about a chart or dataset gives what it shows.
// With ?prototype=data, an agent makes a small dataset and a chart of it, filtered to two
// regions with one bar selected. The person selects the chart: the ask box offers chart
// starters. They ask; the agent's view of the ask (`asks`) must carry the chart's measure,
// filter, bars and selection as text. Then a cell changes, so the chart is stale, and a second
// ask must say it is out of date and name the input. An ask about the dataset gives its
// columns and rows.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-ask-chart.mjs <screenshot dir>
//
// Needs the dev server on :5183 (`pnpm dev:canvas`), ideally with an empty PAIRED_BOARDS_DIR.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-ask-chart.mjs <screenshot dir>');
const BASE = 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'ask-chart-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/?prototype=data`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await p.waitForTimeout(800);

let n = 0;
async function command(op, input) {
  const sessions = await (await fetch(`${BASE}/api/canvas/sessions`)).json();
  const list = sessions.sessions ?? sessions;
  const res = await fetch(`${BASE}/api/canvas/command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `ask-chart-${++n}`, sessionId: list[0]?.id ?? list[0]?.sessionId, actor: 'Verifier', command: { op, input } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${op}: ${JSON.stringify(body)}`);
  return body.result;
}
async function ask(id, question) {
  await p.evaluate((id) => window.paired.select([id]), id);
  await p.waitForTimeout(200);
  await p.locator('.selection-bar button.primary').click();
  const starters = await p.locator('.ask-starters').innerText().catch(() => '');
  await p.locator('.selection-bar.asking input').fill(question);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  await p.evaluate(() => window.paired.select([]));
  const asks = (await command('asks', { state: 'all' })).asks;
  return { starters, view: asks.find((a) => a.question === question) };
}

const dataset = await command('dataset', {
  x: 120, y: 520, title: 'Orders (synthetic)', source: 'made up for this check',
  columns: [{ name: 'region', type: 'text' }, { name: 'orders', type: 'number' }],
  rows: [{ region: 'North', orders: 10 }, { region: 'South', orders: 4 }, { region: 'North', orders: 6 }, { region: 'East', orders: 7 }],
});
const chart = await command('chart', { x: 620, y: 520, datasetId: dataset.id, state: { x: 'region', y: 'orders', aggregate: 'sum', filter: { region: ['North', 'South'] }, selected: ['North'] } });

const first = await ask(chart.id, 'What does this show?');
check('the ask box offers chart starters', first.starters.includes('What does this show?'), first.starters.replace(/\n/g, ' | '));
const text = first.view?.targets?.[0]?.text ?? '';
console.log(text);
check('the ask gives the measure and grouping', text.includes('Bar chart of sum of orders by region'));
check('it gives the filter and rows in view', text.includes('Filter: region = North or South. 3 of 4 rows in view.'));
check('it gives each bar and the selection', text.includes('North 16 (2 rows, selected)') && text.includes('South 4 (1 row)') && text.includes('Selected: North.'));
await p.screenshot({ path: `${out}/ask-chart-board.png` });

const ds = (await command('read', { ids: [dataset.id] })).objects[0];
await command('cell', { id: dataset.id, expectedRevision: ds.revision, row: 1, column: 'orders', value: 40 });
await p.waitForTimeout(300);
const second = await ask(chart.id, 'Is this still right?');
const staleText = second.view?.targets?.[0]?.text ?? '';
console.log(staleText);
check('a stale chart says it is out of date and names the input', /^Out of date: “[^”]+” changed/.test(staleText), staleText.split('\n')[0]);
check('it gives the bars the person still sees', staleText.includes('South 4 (1 row)'));

const third = await ask(dataset.id, 'What is in this data?');
const dsText = third.view?.targets?.[0]?.text ?? '';
console.log(dsText);
check('an ask about the dataset gives its columns and rows', dsText.includes('Columns: region (text), orders (number). 4 rows.') && dsText.includes('region: South; orders: 40'));
check('no page errors', errors.length === 0, errors.join(' | '));
await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
