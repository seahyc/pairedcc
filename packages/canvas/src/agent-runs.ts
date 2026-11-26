import type { Editor } from "tldraw";
import { executeCommand } from "./agent-operations";
import type { CanvasCommand } from "./protocol";
import { documentDiff, isEmptyDiff, planUndo, runsInput, undoRunInput, type RunDiff } from "./run-undo";

// Agent runs: every mutating agent command is captured as one run (who, what, which
// objects it created, changed or removed) so an agent, or the person, can undo that
// run as a unit without undoing anything else. See ./run-undo.ts for the rules.

const readOnly = new Set<CanvasCommand["op"]>(["read", "get", "overview", "screenshot", "select", "focus", "runs"]);
export type AgentRun = {
  runId: string;
  op: string;
  actor: string;
  at: string;
  changes: RunDiff;
  undone: boolean;
};

export function summariseRun(run: AgentRun) {
  return {
    runId: run.runId,
    op: run.op,
    actor: run.actor,
    at: run.at,
    created: Object.keys(run.changes.added),
    updated: Object.keys(run.changes.updated),
    removed: Object.keys(run.changes.removed),
    undone: run.undone,
  };
}

export function createRunLedger(max = 100) {
  const runs: AgentRun[] = [];
  return {
    add(run: AgentRun) {
      runs.push(run);
      if (runs.length > max) runs.shift();
    },
    get: (runId: string) => runs.find((r) => r.runId === runId),
    list: (limit: number) => runs.slice(-limit).reverse(),
  };
}
export type RunLedger = ReturnType<typeof createRunLedger>;

export function undoRun(editor: Editor, ledger: RunLedger, value: unknown) {
  const { runId } = undoRunInput.parse(value);
  const run = ledger.get(runId);
  if (!run) throw new Error(`Unknown run: ${runId}. canvas_runs lists recent runs in this tab.`);
  if (run.undone) throw new Error("This run has already been undone");
  const plan = planUndo(run.changes, (id) => editor.store.get(id as never) as never);
  if (plan.conflicts.length)
    throw new Error(
      `Cannot undo run ${runId}: ${plan.conflicts.map((c) => `${c.id} ${c.reason}${c.fields ? ` (${c.fields.join(", ")})` : ""}`).join("; ")}. Nothing was changed.`,
    );
  editor.markHistoryStoppingPoint("undo agent run");
  editor.run(() => {
    if (plan.remove.length) editor.store.remove(plan.remove as never[]);
    if (plan.put.length) editor.store.put(plan.put as never[]);
  });
  run.undone = true;
  return { ...summariseRun(run), restored: plan.put.map((r) => r.id), removedNow: plan.remove };
}

/** Run one agent command, recording its document changes as an undoable run. */
export async function runCommand(editor: Editor, ledger: RunLedger, command: CanvasCommand, actor: string, runId: string) {
  if (command.op === "runs") return { runs: ledger.list(runsInput.parse(command.input ?? {}).limit).map(summariseRun) };
  if (command.op === "undo_run") return undoRun(editor, ledger, command.input);
  if (readOnly.has(command.op)) return executeCommand(editor, command, actor);
  // Mutating operations finish synchronously, so every change lands inside this capture.
  let work: Promise<unknown> = Promise.resolve();
  const diff = editor.store.extractingChanges(() => {
    work = executeCommand(editor, command, actor);
  }) as unknown as RunDiff;
  const result = await work; // a failed command rolls back or throws before recording
  const changes = documentDiff(diff);
  if (!isEmptyDiff(changes)) ledger.add({ runId, op: command.op, actor, at: new Date().toISOString(), changes, undone: false });
  return result;
}
