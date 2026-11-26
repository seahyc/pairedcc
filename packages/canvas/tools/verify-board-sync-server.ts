import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../eval/lib";

// Board sync against the real paired.cc server, in a browser. Starts the server (with its
// migrations) and the dev canvas with PAIRED_SERVER_URL, signs in through the real magic-link
// flow, saves a board, and checks that a clean browser on the same account opens it while
// another account does not. Needs throwaway Postgres and Redis (see e2e/README.md):
//
//   DATABASE_URL=postgres://paired@localhost:5433/paired_sync REDIS_URL=redis://localhost:6380 \
//   JWT_SECRET=sync-check-throwaway-secret pnpm --filter @pairedcc/canvas verify:sync-server
//
// Ports: SYNC_SERVER_PORT (default 3110) for the server, SYNC_CANVAS_PORT (5185) for the canvas.

const canvasDir = fileURLToPath(new URL("..", import.meta.url));
const root = join(canvasDir, "..", "..");
for (const name of ["DATABASE_URL", "REDIS_URL", "JWT_SECRET"])
  if (!process.env[name]) {
    console.error(`${name} is not set; this check needs throwaway Postgres and Redis (see the header of this file)`);
    process.exit(2);
  }
const serverPort = Number(process.env.SYNC_SERVER_PORT ?? 3110);
const canvasPort = Number(process.env.SYNC_CANVAS_PORT ?? 5185);
const canvas = `http://localhost:${canvasPort}`;

const children: ChildProcess[] = [];
let serverLog = "";
function start(command: string, args: string[], cwd: string, env: Record<string, string>, onOutput?: (s: string) => void) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (d) => onOutput?.(String(d)));
  child.stderr?.on("data", (d) => onOutput?.(String(d)));
  children.push(child);
  return child;
}
const stopAll = () => children.forEach((c) => c.kill());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | undefined | false> | T | undefined | false, what: string, ms = 30000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch {
      /* not yet */
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

// The server runs from an empty directory so it serves no stale frontend files. Its links point
// at the canvas origin, which proxies /auth there, so the session cookie lands on the canvas.
start(join(root, "packages/server/node_modules/.bin/tsx"), [join(root, "packages/server/src/index.ts")], mkdtempSync(join(tmpdir(), "paired-sync-")), { PORT: String(serverPort), BASE_URL: canvas }, (s) => (serverLog += s));
start(process.execPath, [join(canvasDir, "node_modules/vite/bin/vite.js"), "--port", String(canvasPort), "--strictPort"], canvasDir, { PAIRED_SERVER_URL: `http://localhost:${serverPort}` });

let failed = false;
const report = (ok: boolean, line: string) => {
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} ${line}`);
};

try {
  await until(() => serverLog.includes(`running on port ${serverPort}`), "the server to start (and migrate)", 60000);
  await until(async () => (await fetch(`${canvas}/canvas/`)).ok, "the dev canvas to start");
  const browser = await launch();
  const run = Date.now();
  const errors: string[] = [];

  async function signedIn(email: string) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on("pageerror", (e: Error) => errors.push(e.message));
    const sent = await page.request.post(`${canvas}/auth/magic/send`, { data: { email, returnTo: "/canvas/" } });
    if (!sent.ok()) throw new Error(`magic link request failed: ${sent.status()}`);
    const link = await until(() => [...serverLog.matchAll(/Magic link for (\S+): (\S+)/g)].reverse().find((m) => m[1] === email)?.[2], `a magic link for ${email}`);
    await page.goto(link);
    await page.waitForURL(/\/canvas\/?$/);
    await page.waitForFunction(() => Boolean((window as any).paired && (window as any).__pairedEditor), null, { timeout: 60000 });
    return { context, page };
  }
  const chip = (page: any) => page.locator(".save-state").first();
  const savedChip = (page: any) =>
    until(async () => ((await chip(page).textContent()) ?? "").includes("Saved to your account") && chip(page).textContent(), "the chip to say the board is saved to the account").catch(async (error) => {
      const me = await page.request.get(`${canvas}/auth/me`);
      throw new Error(`${error.message}; chip "${await chip(page).textContent()}" (${await chip(page).getAttribute("title")}); /auth/me ${me.status()} ${(await me.text()).slice(0, 120)}; cookies ${(await page.context().cookies()).map((c: any) => c.name).join(",")}`);
    });
  const boards = async (page: any) => (await (await page.request.get(`${canvas}/api/canvas/boards`)).json()).boards as { id: string; revision: number }[];

  // Synthetic addresses, unique per run, so reruns against the same database stay independent.
  const a = await signedIn(`sync-a-${run}@example.test`);
  console.log("A chip after sign-in:", await savedChip(a.page));
  const note = `Saved through the real server ${run}`;
  const id: string = await a.page.evaluate((text: string) => (window as any).paired.create({ kind: "note", x: 300, y: -300, text }), note);
  const saved = await until(async () => {
    const list = await boards(a.page);
    const main = list.find((b) => b.id === "main");
    if (!main || main.revision < 2) return undefined;
    const board = (await (await a.page.request.get(`${canvas}/api/canvas/boards/main`)).json()).board;
    return board.snapshot.store[id] ? main : undefined;
  }, "the server to hold A's new note");
  report(true, `server holds A's note on board main at revision ${saved.revision}`);
  await a.page.screenshot({ path: process.env.SYNC_SCREENSHOT ?? join(tmpdir(), "board-sync-server.png") });

  // A clean browser, same account: opens the account's board.
  const a2 = await signedIn(`sync-a-${run}@example.test`);
  await savedChip(a2.page);
  const inA2 = await until(() => a2.page.evaluate((i: string) => Boolean((window as any).__pairedEditor.getShape(i)), id), "A's note in the clean browser", 15000).catch(() => false);
  report(inA2 === true, `a clean browser signed in as A opens A's note (chip: ${await chip(a2.page).textContent()})`);

  // Another account never sees it.
  const b = await signedIn(`sync-b-${run}@example.test`);
  await savedChip(b.page);
  await sleep(1500);
  const inB = await b.page.evaluate((i: string) => Boolean((window as any).__pairedEditor.getShape(i)), id);
  const bBoard = (await (await b.page.request.get(`${canvas}/api/canvas/boards/main`)).json()).board;
  report(!inB && !bBoard?.snapshot?.store?.[id], `account B does not see A's note (B's board main: revision ${bBoard?.revision ?? "none"})`);

  // Signed out: the board API refuses, and the canvas says it is saved on this device only.
  const anon = await browser.newContext();
  const status = (await anon.request.get(`${canvas}/api/canvas/boards`)).status();
  report(status === 401, `signed out, GET /api/canvas/boards returns ${status}`);
  await anon.close();

  report(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await browser.close();
} catch (error) {
  report(false, error instanceof Error ? error.message : String(error));
} finally {
  stopAll();
}
process.exit(failed ? 1 : 0);
