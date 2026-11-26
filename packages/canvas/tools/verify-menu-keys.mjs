// Browser check for item 87: the menu and dialogs work from the keyboard.
//
// On a fresh profile at 1440 x 900: the Menu opens with Enter and its first item takes focus;
// arrows, Home and End move between items; Escape closes it, puts focus back on the Menu button
// and keeps the board's selection; the shortcut dialog (from the menu, and from ? on the board)
// takes focus, keeps Tab inside and gives focus back when it closes; the agent dialog does the
// same; the More tools menu behaves like the Menu.
//
//   cd <a directory where playwright is installed> && node <repo>/packages/canvas/tools/verify-menu-keys.mjs <screenshot dir>
//
// Needs a dev server for this checkout (`pnpm dev:canvas`). No agent is needed. Playwright is
// loaded from the directory you run this in. Exits non-zero if any check fails.
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = createRequire(`${process.cwd()}/`)('playwright');
const out = process.argv[2];
if (!out) throw new Error('Usage: node verify-menu-keys.mjs <screenshot dir>');
mkdirSync(out, { recursive: true });
const BASE = process.env.CANVAS_BASE ?? 'http://localhost:5183';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'menu-keys-')), { viewport: { width: 1440, height: 900 } });
const p = ctx.pages()[0] ?? await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
await p.goto(`${BASE}/canvas/`);
await p.waitForFunction(() => window.paired?.read().objects.length >= 3, null, { timeout: 30000 });
await p.waitForTimeout(1500);
const press = async (key, wait = 250) => { await p.keyboard.press(key); await p.waitForTimeout(wait); };
/** Where the keyboard is: the focused element's label, and whether it is in the open menu or dialog. */
const where = () => p.evaluate(() => {
  const a = document.activeElement;
  const label = (a?.getAttribute('aria-label') || a?.textContent || a?.tagName || '').trim().replace(/\s+/g, ' ').slice(0, 30);
  return {
    label,
    inMenu: Boolean(a?.closest('[role=menu]')),
    inDialog: Boolean(a?.closest('[role=dialog]')),
    menu: Boolean(document.querySelector('[role=menu]')),
    dialog: document.querySelector('[role=dialog]')?.getAttribute('aria-label') ?? null,
    body: a === document.body,
  };
});

// A selection on the board, to see that Escape in the menu leaves it alone.
const card = await p.evaluate(() => window.paired.read().objects.find((o) => o.type === 'card')?.id);
await p.evaluate((id) => window.paired.select([id]), card);

// The Menu.
await p.focus('.menu-button');
await press('Enter');
let w = await where();
check('Enter on the Menu opens it with its first item focused', w.menu && w.inMenu && /New board/.test(w.label), JSON.stringify(w));
await press('ArrowDown');
const second = (await where()).label;
check('ArrowDown moves to the next item', second !== w.label && (await where()).inMenu, second);
await press('End');
const last = (await where()).label;
await press('Home');
const first = (await where()).label;
await press('ArrowUp');
const wrapped = (await where()).label;
check('End and Home go to the last and first items, ArrowUp wraps', /Open board file/.test(last) && /New board/.test(first) && wrapped === last, `${last} / ${first} / ${wrapped}`);
await press('Escape');
w = await where();
const kept = await p.evaluate(() => window.__pairedEditor.getSelectedShapeIds());
check('Escape closes the menu and puts focus back on the Menu button', !w.menu && w.label === 'Menu', JSON.stringify(w));
check('Escape in the menu keeps the board selection', kept.length === 1 && kept[0] === card, kept.join(','));

// The shortcut dialog from the menu.
await press('Enter');
for (let i = 0; i < 15 && !/Shortcuts/.test((await where()).label); i++) await press('ArrowDown', 120);
await press('Enter', 400);
w = await where();
check('Shortcuts from the menu opens the dialog with focus inside it', w.dialog === 'Keyboard shortcuts' && w.inDialog, JSON.stringify(w));
let escaped = '';
for (let i = 0; i < 6; i++) {
  await press('Tab', 120);
  const t = await where();
  if (!t.inDialog) escaped ||= t.label;
}
for (let i = 0; i < 3; i++) {
  await press('Shift+Tab', 120);
  const t = await where();
  if (!t.inDialog) escaped ||= t.label;
}
check('Tab and Shift+Tab stay inside the dialog', !escaped, escaped);
await p.screenshot({ path: `${out}/shortcuts-dialog.png` });
await press('Escape', 400);
w = await where();
check('Escape closes the dialog and focus goes back to the Menu button', !w.dialog && w.label === 'Menu', JSON.stringify(w));

// The shortcut dialog from ? on the board.
await p.evaluate(() => { document.activeElement?.blur?.(); });
await press('?', 400);
w = await where();
check('? on the board opens the dialog with focus inside it', w.dialog === 'Keyboard shortcuts' && w.inDialog, JSON.stringify(w));
await press('Escape', 400);
w = await where();
check('Escape gives the keyboard back to the board, not to a button', !w.dialog && !w.inMenu && (w.body || /tldraw|tl-/.test(w.label) || w.label === 'DIV'), JSON.stringify(w));

// The agent dialog from the menu.
await p.focus('.menu-button');
await press('Enter');
for (let i = 0; i < 15 && !/Connect an agent/.test((await where()).label); i++) await press('ArrowDown', 120);
await press('Enter', 500);
w = await where();
check('Connect an agent opens its dialog with focus inside it', w.dialog === 'Agent access' && w.inDialog, JSON.stringify(w));
await press('Escape', 400);
w = await where();
check('Escape closes it and focus goes back to the Menu button', !w.dialog && w.label === 'Menu', JSON.stringify(w));

// The More tools menu.
await p.focus('button[title="More tools"]');
await press('Enter');
w = await where();
check('Enter on More opens its menu with the first item focused', w.menu && w.inMenu, JSON.stringify(w));
await press('ArrowDown');
const moved = await where();
check('ArrowDown moves in the More menu', moved.inMenu && moved.label !== w.label, moved.label);
await press('Escape');
w = await where();
check('Escape closes it and focus goes back to More', !w.menu && /More/.test(w.label), JSON.stringify(w));
check('no page errors', errors.length === 0, errors.join(' | '));

await ctx.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
