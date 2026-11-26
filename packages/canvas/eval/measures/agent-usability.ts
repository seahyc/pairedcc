import { existsSync, readdirSync, readFileSync } from "node:fs";
import { packageDir } from "../lib";

// Agent usability is measured by a fresh agent attempting the tasks in eval/tasks/.
// That needs a model, which this script does not call; it reports the most recent
// recorded attempt in eval/agent-runs/latest.json, whose end states were machine-checked.

export function agentUsability() {
  const dir = `${packageDir}/eval/tasks`;
  const tasks = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).length : 0;
  const file = `${packageDir}/eval/agent-runs/latest.json`;
  if (!existsSync(file)) return { tasks, attempted: 0, completed: 0, medianToolCalls: null, recordedAt: null };
  const run = JSON.parse(readFileSync(file, "utf8")) as { recordedAt: string; results: { task: string; pass: boolean; toolCalls: number }[] };
  const calls = run.results.map((r) => r.toolCalls).sort((a, b) => a - b);
  return {
    tasks,
    attempted: run.results.length,
    completed: run.results.filter((r) => r.pass).length,
    medianToolCalls: calls.length ? calls[Math.floor(calls.length / 2)] : null,
    recordedAt: run.recordedAt,
  };
}
