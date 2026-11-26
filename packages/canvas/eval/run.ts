import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { launch, packageDir, startServer } from "./lib";
import { acceptance } from "./measures/acceptance";
import { agentUsability } from "./measures/agent-usability";
import { performanceMeasure } from "./measures/performance";
import { persistence } from "./measures/persistence";
import { safety } from "./measures/safety";
import { workspace } from "./measures/workspace";
import { markdown, rows, spliceReport, type Raw } from "./score";

// pnpm eval:canvas [--only=acceptance,safety,persistence,performance,agent,workspace] [--no-write]
// Writes eval/scorecard.json and the scorecard table in SPRINT-REPORT.md.

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const want = (name: string) => !only || only.includes(name);
const write = !args.includes("--no-write");
const scorecardPath = `${packageDir}/eval/scorecard.json`;
const reportPath = `${packageDir}/../../SPRINT-REPORT.md`;

const previous: { raw?: Raw } | undefined = existsSync(scorecardPath) ? JSON.parse(readFileSync(scorecardPath, "utf8")) : undefined;
const raw: Raw & Record<string, unknown> = {};
const log = (s: string) => process.stderr.write(`${s}\n`);

const server = await startServer();
const browser = await launch();
try {
  for (const [name, run] of [
    ["acceptance", () => acceptance(browser, server.base)],
    ["safety", () => safety(browser, server.base)],
    ["persistence", () => persistence(browser, server.base)],
    ["performance", () => performanceMeasure(browser, server.base)],
  ] as const) {
    if (!want(name)) continue;
    log(`eval: ${name}…`);
    const t = Date.now();
    try {
      (raw as Record<string, unknown>)[name] = await run();
    } catch (error) {
      log(`eval: ${name} could not run: ${error instanceof Error ? error.stack : error}`);
      (raw as Record<string, unknown>)[`${name}Error`] = String(error);
    }
    log(`eval: ${name} took ${Math.round((Date.now() - t) / 1000)} s`);
  }
} finally {
  await browser.close();
  server.stop();
}
if (want("agent")) raw.agentUsability = agentUsability();
if (want("workspace")) {
  log("eval: workspace build and tests…");
  raw.workspace = workspace();
}
// Measures skipped with --only keep their previous results, marked as carried over.
const carried: string[] = [];
for (const key of ["acceptance", "agentUsability", "safety", "persistence", "performance", "workspace"] as const)
  if (raw[key] === undefined && previous?.raw?.[key] !== undefined) {
    (raw as Record<string, unknown>)[key] = previous.raw[key];
    carried.push(key);
  }

const dirty = execSync("git status --porcelain -- . ':!SPRINT-REPORT.md' ':!packages/canvas/eval/scorecard.json'", { cwd: `${packageDir}/../..`, encoding: "utf8" }).trim();
const commit = execSync("git rev-parse --short HEAD", { cwd: packageDir, encoding: "utf8" }).trim() + (dirty ? " with uncommitted changes" : "");
const generatedAt = new Date().toISOString().replace(/:\d\d\.\d+Z$/, "Z");
const table = rows(raw, previous?.raw);
const scorecard = { generatedAt, commit, carriedOver: carried, table, raw };
let block = markdown(table, generatedAt, commit);
if (carried.length) block += `\n\nCarried over from the previous run, not re-measured: ${carried.join(", ")}.`;
console.log(block);
const steps = raw.acceptance?.steps ?? [];
for (const s of steps) console.log(`${s.pass ? "PASS" : "FAIL"} acceptance: ${s.name}${s.pass ? "" : ` — ${s.detail}`}`);
for (const r of raw.performance ?? []) console.log(`perf: ${JSON.stringify(r)}`);
for (const r of raw.safety?.races ?? []) console.log(`${r.pass ? "PASS" : "FAIL"} safety: ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
if (write) {
  writeFileSync(scorecardPath, `${JSON.stringify(scorecard, null, 2)}\n`);
  if (existsSync(reportPath)) writeFileSync(reportPath, spliceReport(readFileSync(reportPath, "utf8"), block));
}
