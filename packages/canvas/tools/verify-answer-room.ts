// Browser check for item 100 (f): an answer never covers what sits below the room it checked.
//
// The room an answer needs is estimated from its text before the cards exist; the cards are then
// stacked by their measured height. Text in a wide face can measure taller than the estimate.
// Here the person asks, a note of theirs sits just clear of the estimated room, and the agent
// answers with four long options in wide capitals: no answer card may cover the note (or any
// other object), and the options still sit under or beside their ask.
//
//   node --import tsx tools/verify-answer-room.ts <screenshot dir>
//
// Starts its own dev server with a throwaway board store. No model is needed. Exits non-zero if
// any check fails.
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ANSWER_CHROME, answerLayout, capWords } from "../src/ask-rules";

// Playwright is not a dependency of this repository: loaded from the directory this runs in.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = createRequire(`${process.cwd()}/`)("playwright") as { chromium: any };
const out = process.argv[2];
if (!out) throw new Error("Usage: node --import tsx tools/verify-answer-room.ts <screenshot dir>");
mkdirSync(out, { recursive: true });
const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.ANSWER_ROOM_PORT ?? 5215), ORIGIN = `http://localhost:${PORT}`;
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const boards = mkdtempSync(join(tmpdir(), "answer-room-"));
const server = spawn(process.execPath, [join(pkg, "node_modules/vite/bin/vite.js"), "--port", String(PORT), "--strictPort"], {
  cwd: pkg, env: { ...process.env, PAIRED_BOARDS_DIR: boards }, stdio: ["ignore", "pipe", "pipe"],
});
await new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("dev server did not start")), 30000);
  server.stdout.on("data", (d) => { if (/Local:/.test(String(d))) { clearTimeout(timer); resolve(); } });
});
const post = (path: string, body: unknown) => fetch(`${ORIGIN}/api/canvas${path}`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify(body),
}).then((r) => r.json() as Promise<any>);

const browser = await chromium.launch();
try {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs: string[] = [];
  p.on("pageerror", (e: Error) => errs.push(e.message.slice(0, 200)));
  await p.goto(`${ORIGIN}/canvas/`);
  await p.waitForFunction(() => (window as any).paired?.read().objects.length >= 1, null, { timeout: 30000 });
  await p.waitForTimeout(1200);
  const options = Array.from({ length: 4 }, (_, i) => `${"ABCD"[i]}: ` + Array.from({ length: 50 }, () => "WMWM").join(" "));
  // The person's question, and where the answer's estimated room ends.
  const ask = await p.evaluate(() => {
    const ed = (window as any).__pairedEditor;
    ed.deleteShapes([...ed.getCurrentPageShapeIds()]);
    ed.setCamera({ x: 0, y: 0, z: 1 });
    ed.createShape({ type: "card", x: 200, y: 120, props: { w: 300, tone: "human", richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Which tier should we lead with?" }] }] } } });
    const s = ed.getCurrentPageShapes().find((x: any) => x.type === "card");
    const b = ed.getShapePageBounds(s.id);
    return { id: s.id, x: b.x, maxY: b.maxY, available: (ed.getViewportScreenBounds().w) / ed.getZoomLevel() };
  });
  const texts = options.map((t, i) => `${"ABCD"[i]} · ${capWords(t, 60)}`);
  const room = answerLayout({ x: ask.x, y: ask.maxY }, texts, ask.available - ANSWER_CHROME / 1).box;
  const note = await p.evaluate(([y, x, w]: readonly number[]) => {
    const ed = (window as any).__pairedEditor;
    ed.createShape({ type: "card", x, y, props: { w, tone: "human", richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A note of mine just below" }] }] } } });
    return ed.getCurrentPageShapes().filter((x: any) => x.type === "card").at(-1).id;
  }, [room.y + room.h + 40, room.x, Math.min(room.w, 600)] as const);
  await p.evaluate((id: string) => (window as any).paired.select([id]), ask.id);
  await p.waitForTimeout(200);
  const waiting = post("/asks/wait", { agent: "Check agent", waitMs: 10000 });
  await p.keyboard.press("Control+Enter");
  const got = await waiting;
  const answered = await post("/command", { requestId: randomUUID(), sessionId: got.sessionId, actor: "Check agent", command: { op: "answer", input: { id: got.ask.id, alternatives: options } } });
  if (!answered.ok) throw new Error(JSON.stringify(answered).slice(0, 300));
  await p.waitForTimeout(1200);
  const layout = await p.evaluate(([askId, noteId]: readonly string[]) => {
    const ed = (window as any).__pairedEditor;
    // (No named helpers in here: the page does not have the bundler's naming shim.)
    const [answers, [noteBox], [askBox]] = [ed.getCurrentPageShapes().filter((s: any) => s.meta.replyTo === askId).map((s: any) => s.id), [noteId], [askId]].map((ids: string[]) =>
      ids.map((id) => { const b = ed.getShapePageBounds(id); return { id, x: b.x, y: b.y, r: b.maxX, b: b.maxY }; }));
    return { answers, note: noteBox, ask: askBox };
  }, [ask.id, note] as const);
  const hit = (a: any, b: any) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;
  const measured = Math.max(...layout.answers.map((a: any) => a.b)) - Math.min(...layout.answers.map((a: any) => a.y));
  check("the answer's cards measured taller than the room it estimated (the case under test)", measured > room.h, `${Math.round(measured)} px > ${Math.round(room.h)} px`);
  const covering = layout.answers.filter((a: any) => hit(a, layout.note));
  check("no answer card covers the person's note below", covering.length === 0, covering.map((a: any) => `${Math.round(a.y)}–${Math.round(a.b)} over note ${Math.round(layout.note.y)}`).join("; "));
  const overlaps = layout.answers.flatMap((a: any, i: number) => layout.answers.slice(i + 1).filter((b: any) => hit(a, b)));
  check("the options do not cover each other", overlaps.length === 0);
  const first = layout.answers.reduce((m: any, a: any) => (a.y < m.y || (a.y === m.y && a.x < m.x) ? a : m), layout.answers[0]);
  check("the options still start under or beside their ask", Math.abs(first.x - layout.ask.x) < 5 || (first.x >= layout.ask.r && Math.abs(first.y - layout.ask.y) < 40), JSON.stringify({ first, ask: layout.ask }));
  await p.evaluate(() => { (window as any).__pairedEditor.zoomToFit({ animation: { duration: 0 } }); });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/answer-room.png` });
  // 2. A tall obstacle below the answer in both the under and the beside columns: wherever the
  // answer goes, it covers nothing (the search steps past the obstacle, not 60 short steps into it).
  const ask2 = await p.evaluate(() => {
    const ed = (window as any).__pairedEditor;
    ed.setCamera({ x: -6000, y: 0, z: 1 });
    // (No named helpers in here: the page does not have the bundler's naming shim.)
    ed.createShape({ type: "card", x: 6200, y: 120, props: { w: 300, tone: "human", richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "And for schools?" }] }] } } });
    const a = ed.getCurrentPageShapes().filter((s: any) => s.type === "card").at(-1).id;
    const b = ed.getShapePageBounds(a);
    // A note just under the estimated room, and a tall block across both columns beneath it.
    ed.createShape({ type: "card", x: 6200, y: b.maxY + 330, props: { w: 600, tone: "human", richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A note of mine" }] }] } } });
    ed.createShape({ type: "geo", x: 6150, y: b.maxY + 420, props: { w: 1600, h: 2600, geo: "rectangle" } });
    return { id: a };
  });
  await p.evaluate((id: string) => (window as any).paired.select([id]), ask2.id);
  await p.waitForTimeout(200);
  const waiting2 = post("/asks/wait", { agent: "Check agent", waitMs: 10000 });
  await p.keyboard.press("Control+Enter");
  const got2 = await waiting2;
  const answered2 = await post("/command", { requestId: randomUUID(), sessionId: got2.sessionId, actor: "Check agent", command: { op: "answer", input: { id: got2.ask.id, alternatives: options } } });
  if (!answered2.ok) throw new Error(JSON.stringify(answered2).slice(0, 300));
  await p.waitForTimeout(1200);
  const covered2 = await p.evaluate((askId: string) => {
    const ed = (window as any).__pairedEditor;
    const answers = ed.getCurrentPageShapes().filter((s: any) => s.meta.replyTo === askId).map((s: any) => ed.getShapePageBounds(s.id));
    const others = ed.getCurrentPageShapes().filter((s: any) => s.meta.replyTo !== askId && s.id !== askId && s.type !== "arrow" && s.type !== "frame").map((s: any) => ed.getShapePageBounds(s.id));
    return answers.flatMap((a: any) => others.filter((o: any) => a.x < o.maxX && o.x < a.maxX && a.y < o.maxY && o.y < a.maxY).map((o: any) => `${Math.round(a.y)}–${Math.round(a.maxY)} over ${Math.round(o.y)}–${Math.round(o.maxY)}`));
  }, ask2.id);
  check("with a tall obstacle below both columns, the answer still covers nothing", covered2.length === 0, covered2.slice(0, 3).join("; "));
  check("no page errors", errs.length === 0, errs.join(" | "));
} finally {
  await browser.close();
  server.kill();
  rmSync(boards, { recursive: true, force: true });
}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
