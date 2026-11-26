import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

// Shared plumbing for `pnpm eval:canvas`: a dev server, headless pages and a real
// stdio MCP client for the agent side. Playwright is resolved at run time (it is
// preinstalled in the sprint environment and used by the e2e package), so the
// canvas package takes no new dependency.

export const packageDir = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Page = any;
export type Browser = any;

export function playwright(): { chromium: { launch(o?: unknown): Promise<Browser> } } {
  try {
    return require("playwright");
  } catch {
    return require(require.resolve("playwright", { paths: [`${packageDir}/../../e2e`, `${packageDir}/../..`] }));
  }
}

/** Launch headless Chromium; falls back to a preinstalled browser when the resolved Playwright has none. */
export async function launch(): Promise<Browser> {
  const { chromium } = playwright();
  try {
    return await chromium.launch();
  } catch (error) {
    const path = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
    if (!existsSync(path)) throw error;
    return chromium.launch({ executablePath: path });
  }
}

export type DevServer = { base: string; stop(): void };

/** Start the canvas dev server (with the local relay) on its own port, or reuse `EVAL_URL`. */
export async function startServer(port = Number(process.env.EVAL_PORT ?? 5191)): Promise<DevServer> {
  if (process.env.EVAL_URL) return { base: process.env.EVAL_URL.replace(/\/$/, ""), stop() {} };
  // Each run gets an empty development board store, so saved boards never leak between runs.
  const boards = mkdtempSync(join(tmpdir(), "paired-eval-boards-"));
  const child: ChildProcess = spawn(process.execPath, [`${packageDir}/node_modules/vite/bin/vite.js`, "--port", String(port), "--strictPort"], {
    cwd: packageDir,
    env: { ...process.env, PAIRED_BOARDS_DIR: boards },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Dev server exited: ${log}`);
    try {
      if ((await fetch(`${base}/api/canvas/sessions`)).ok) return { base, stop: () => child.kill() };
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  child.kill();
  throw new Error(`Dev server did not start: ${log}`);
}

export const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export async function until<T>(fn: () => Promise<T> | T, what: string, timeout = 15000): Promise<T> {
  const end = Date.now() + timeout;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ""}`);
}

/** Open the canvas in a fresh browser context (clean profile) and wait until it is ready. */
export async function openCanvas(browser: Browser, base: string, query = "") {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  await page.goto(`${base}/canvas/${query}`);
  await ready(page);
  return { context, page, errors, session: await sessionOf(page, base) };
}

export async function ready(page: Page) {
  await page.waitForFunction(() => Boolean((window as any).paired && (window as any).__pairedEditor), null, { timeout: 60000 });
  // A new board lays out the welcome page after fonts load (up to 2.5 s); wait for it so it
  // does not land in the middle of a check. Existing boards are already seeded.
  await page
    .waitForFunction(() => (window as any).__pairedEditor.getPages().some((p: any) => p.meta.seeded === 2), null, { timeout: 10000 })
    .catch(() => undefined);
}

/**
 * Wait until the board is saved to the account (or the development board store), as a
 * person would before closing the tab: nothing unsaved and no save in flight. Returns
 * false if the board never reports being saved there (for example, no board storage).
 */
export async function savedToAccount(page: Page, timeout = 20000): Promise<boolean> {
  await sleep(300);
  return page
    .waitForFunction(
      () => {
        const el = document.querySelector(".save-state");
        let memo: { dirty?: boolean } | null = null;
        try {
          memo = JSON.parse(localStorage.getItem("paired-board-sync") ?? "null");
        } catch {
          /* unreadable memo counts as unsaved */
        }
        return !!el && el.textContent?.startsWith("Saved to") && !el.classList.contains("saving") && memo?.dirty === false;
      },
      null,
      { timeout },
    )
    .then(() => true, () => false);
}

/** The relay session ID of a tab, once the tab has connected to the relay. */
export async function sessionOf(page: Page, base: string): Promise<string> {
  const id: string = await page.evaluate(() => sessionStorage.getItem("picabird-agent-session"));
  await until(async () => {
    const list = (await (await fetch(`${base}/api/canvas/sessions`)).json()) as { sessions: { id: string }[] };
    return list.sessions.some((s) => s.id === id);
  }, "the tab to connect to the relay");
  return id;
}

export type Agent = {
  call(name: string, args?: Record<string, unknown>): Promise<any>;
  tools(): Promise<string[]>;
  calls: number;
  close(): Promise<void>;
};

/** A real stdio MCP client running tools/mcp.ts against one tab. Tool errors reject. */
export async function mcpAgent(base: string, session: string): Promise<Agent> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  const client = new Client({ name: "paired-eval", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [`${packageDir}/node_modules/tsx/dist/cli.mjs`, `${packageDir}/tools/mcp.ts`],
      env: { ...env, PAIRED_URL: base, PAIRED_SESSION: session },
    }),
  );
  const agent: Agent = {
    calls: 0,
    async call(name, args = {}) {
      agent.calls++;
      const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
      const text = result.content.find((c) => c.type === "text");
      const body = text && text.type === "text" ? text.text : "";
      if (result.isError) throw new Error(`${name}: ${body}`);
      try {
        return JSON.parse(body);
      } catch {
        return body;
      }
    },
    async tools() {
      return (await client.listTools()).tools.map((t) => t.name);
    },
    close: () => client.close(),
  };
  return agent;
}

export type Check = { name: string; pass: boolean; detail: string; ms: number };

/** Run one named check; a thrown error or a false/string result is a failure with its reason. */
export async function check(list: Check[], name: string, fn: () => Promise<true | string>): Promise<boolean> {
  const start = Date.now();
  try {
    const out = await fn();
    const pass = out === true;
    list.push({ name, pass, detail: pass ? "ok" : out, ms: Date.now() - start });
    return pass;
  } catch (error) {
    list.push({ name, pass: false, detail: error instanceof Error ? error.message.split("\n")[0] : String(error), ms: Date.now() - start });
    return false;
  }
}

export const objects = (read: any): any[] => read.objects ?? [];
export const find = (read: any, id: string) => objects(read).find((o) => o.id === id);
