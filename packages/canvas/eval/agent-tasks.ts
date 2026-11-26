import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { launch, mcpAgent, openCanvas, packageDir, sleep, startServer } from "./lib";
import type { Ctx, Task } from "./task-kit";

// Agent-usability tasks (eval/tasks/*.ts).
//   tsx eval/agent-tasks.ts self-test [--only=01-create-note,...]
//       For every task: set it up, require the check to FAIL, run the reference solution,
//       require the check to PASS. Proves each check is satisfiable and not trivially true.
//   tsx eval/agent-tasks.ts attempt [--agent="description"] [--timeout=600]
//       For every task: set it up on a fresh page, write the prompt to
//       eval/agent-runs/work/current.json, and wait for the agent under test to create
//       work/done-<task> (or give-up-<task>). Then check the board and record the result.
//       The agent acts only through `tsx eval/mcp-call.ts`, which counts its calls.
//       Writes eval/agent-runs/latest.json, which `pnpm eval:canvas` reports.

const [mode = "self-test", ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = flag("only")?.split(",");
const work = process.env.AGENT_TASK_DIR ?? `${packageDir}/eval/agent-runs/work`;

const files = readdirSync(`${packageDir}/eval/tasks`).filter((f) => f.endsWith(".ts")).sort();
const tasks: Task[] = [];
for (const f of files) tasks.push((await import(`./tasks/${f}`)).default as Task);
const selected = tasks.filter((t) => !only || only.includes(t.id));

const server = await startServer();
const browser = await launch();
// Tasks 13 to 16 use the data prototype and task 24 converge; a tab refuses those unless it was
// opened with their flags.
const { page, session, context } = await openCanvas(browser, server.base, "?prototype=data&prototype=converge");
const helper = await mcpAgent(server.base, session);
const ctxFor = (refs: Record<string, any>): Ctx => ({
  call: helper.call,
  page,
  refs,
  // Results that are not plain data (tldraw returns the editor from most calls) come back as null.
  person: (fn, arg) =>
    page.evaluate(`(async () => { const r = await (${fn})(window.paired, window.__pairedEditor, ${JSON.stringify(arg ?? null)}); try { return JSON.parse(JSON.stringify(r ?? null)); } catch { return null; } })()`),
});
const verdict = async (t: Task, ctx: Ctx): Promise<true | string> => {
  try {
    return await t.check({ ...ctx, read: await helper.call("canvas_read") });
  } catch (error) {
    return `check failed: ${error instanceof Error ? error.message : String(error)}`;
  }
};
const prepare = async (t: Task) => {
  const ctx = ctxFor({});
  await helper.call("canvas_page", { name: `Task ${t.id}` });
  await t.setup?.(ctx);
  await page.evaluate(() => (window as any).paired.select([]));
  return ctx;
};

const results: { task: string; pass: boolean; detail: string; toolCalls: number; seconds: number; evidence?: unknown }[] = [];
try {
  if (mode === "self-test") {
    let bad = 0;
    for (const t of selected) {
      const ctx = await prepare(t);
      const before = await verdict(t, ctx);
      let after: true | string = "solution not run";
      try {
        await t.solution(ctx);
        await sleep(200);
        after = await verdict(t, ctx);
      } catch (error) {
        after = `solution failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      const ok = before !== true && after === true;
      if (!ok) bad++;
      console.log(`${ok ? "OK  " : "BAD "} ${t.id}: before → ${before === true ? "PASS (check is trivially true)" : `fail (${before})`}; after solution → ${after === true ? "pass" : `FAIL (${after})`}`);
    }
    console.log(`${selected.length - bad}/${selected.length} tasks have a check that fails before and passes after the reference solution`);
    process.exitCode = bad ? 1 : 0;
  } else if (mode === "attempt") {
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    const timeout = Number(flag("timeout") ?? 600) * 1000;
    for (const t of selected) {
      const ctx = await prepare(t);
      const start = Date.now();
      writeFileSync(`${work}/current.json`, JSON.stringify({ task: t.id, prompt: t.prompt, base: server.base, session }, null, 2));
      console.log(`task ${t.id} ready`);
      while (!existsSync(`${work}/done-${t.id}`) && !existsSync(`${work}/give-up-${t.id}`) && Date.now() - start < timeout) await sleep(500);
      const log = `${work}/calls-${t.id}.log`;
      const toolCalls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).length : 0;
      const v = existsSync(`${work}/give-up-${t.id}`) ? `gave up; ${(await verdict(t, ctx)) === true ? "but the board satisfies the check" : "board not done"}` : await verdict(t, ctx);
      const pass = v === true || v === "gave up; but the board satisfies the check";
      // For a failure, keep what the agent left on the board so the check can be audited.
      const evidence = pass
        ? undefined
        : (await helper.call("canvas_read")).objects
            .filter((o: any) => o.text && o.author !== "human")
            .map((o: any) => ({ type: o.type, text: String(o.text).slice(0, 200), bounds: o.bounds }));
      results.push({ task: t.id, pass, detail: pass ? "ok" : String(v), toolCalls, seconds: Math.round((Date.now() - start) / 1000), ...(evidence ? { evidence } : {}) });
      console.log(`${pass ? "PASS" : "FAIL"} ${t.id} (${toolCalls} tool calls)${pass ? "" : `: ${v}`}`);
    }
    writeFileSync(`${work}/current.json`, JSON.stringify({ task: "finished" }));
    mkdirSync(`${packageDir}/eval/agent-runs`, { recursive: true });
    writeFileSync(
      `${packageDir}/eval/agent-runs/latest.json`,
      `${JSON.stringify({ recordedAt: new Date().toISOString(), agent: flag("agent") ?? "unspecified", results }, null, 2)}\n`,
    );
  } else throw new Error(`Unknown mode ${mode}`);
} finally {
  await helper.close();
  await context.close();
  await browser.close();
  server.stop();
}
