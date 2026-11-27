import type { Editor, TLShape } from "tldraw";
import { shapeName } from "./operations";
import { clip } from "./text";

const NAME_MAX = 48;
import { executeCommand } from "./agent-operations";
import type { CanvasCommand } from "./protocol";
import { changedPaths, documentDiff, isEmptyDiff, planUndo, runsInput, undoRunInput, type RunDiff } from "./run-undo";

// Agent runs: every mutating agent command is captured as one run (who, what, which
// objects it created, changed or removed) so an agent, or the person, can undo that
// run as a unit without undoing anything else. See ./run-undo.ts for the rules.

const readOnly = new Set<CanvasCommand["op"]>(["read", "get", "overview", "feedback", "screenshot", "select", "focus", "runs"]);
export type AgentRun = {
  runId: string;
  op: string;
  actor: string;
  at: string;
  changes: RunDiff;
  undone: boolean;
  /** The pages whose objects this run changed. */
  pages?: string[];
};

/**
 * The pages a run touched, from the shapes it added, changed or removed. `pageOf` finds the page
 * of an id still on the board (a shape, or the frame a removed shape sat in).
 */
export function pagesOfRun(diff: RunDiff, pageOf: (id: string) => string | undefined): string[] {
  const found: string[] = [];
  const add = (page: string | undefined) => {
    if (page && !found.includes(page)) found.push(page);
  };
  const isShape = (r: unknown) => (r as { typeName?: string } | undefined)?.typeName === "shape";
  for (const [id, r] of Object.entries(diff.added)) if (isShape(r)) add(pageOf(id));
  for (const [id, pair] of Object.entries(diff.updated)) if (isShape((pair as unknown[])[1])) add(pageOf(id));
  for (const [, r] of Object.entries(diff.removed)) {
    if (!isShape(r)) continue;
    const parent = String((r as { parentId?: unknown }).parentId ?? "");
    add(parent.startsWith("page:") ? parent : pageOf(parent));
  }
  return found;
}

/** How many object ids each list in a `runs` listing shows; one run by `runId` shows them all. */
export const LISTED_IDS = 10;

/** A run as `runs` lists it: at most LISTED_IDS ids per list, with the full count when there are more. */
export type ListedRun = ReturnType<typeof summariseRun> & { createdCount?: number; updatedCount?: number; removedCount?: number };
export function briefRun(run: AgentRun): ListedRun {
  const full = summariseRun(run);
  const brief = (key: "created" | "updated" | "removed") =>
    full[key].length > LISTED_IDS ? { [key]: full[key].slice(0, LISTED_IDS), [`${key}Count`]: full[key].length } : { [key]: full[key] };
  const updated = full.updated.slice(0, LISTED_IDS);
  const out: ListedRun = {
    ...full,
    ...brief("created"),
    ...brief("updated"),
    fields: Object.fromEntries(updated.map((id) => [id, full.fields[id]])),
    ...brief("removed"),
  };
  const listed = new Set([...(out.created as string[]), ...(out.updated as string[]), ...(out.removed as string[])]);
  return { ...out, names: Object.fromEntries(Object.entries(full.names).filter(([id]) => listed.has(id))) };
}

/** The `runs` result: recent runs briefly, or one run in full when `runId` is given. */
export function runsResult(ledger: RunLedger, value: unknown, actor: string | undefined, currentPageId: string): { runs: ListedRun[] } {
  const input = runsInput.parse(value ?? {});
  if (input.runId) {
    const run = ledger.get(input.runId);
    return { runs: run && (actor === undefined || run.actor === actor) ? [summariseRun(run)] : [] };
  }
  return { runs: ledger.list(input.limit, actor, input.page === "current" ? currentPageId : undefined).map(briefRun) };
}

export function summariseRun(run: AgentRun) {
  return {
    runId: run.runId,
    op: run.op,
    actor: run.actor,
    at: run.at,
    created: Object.keys(run.changes.added),
    updated: Object.keys(run.changes.updated),
    /** For each updated object, the fields this run changed (derived fields left out). */
    fields: Object.fromEntries(Object.entries(run.changes.updated).map(([id, [from, to]]) => [id, changedPaths(from, to)])),
    removed: Object.keys(run.changes.removed),
    pages: run.pages ?? [],
    undone: run.undone,
    /** A short name for each object the run touched, as the run left it (a removed one as it was). */
    names: runNames(run),
  };
}

function runNames(run: AgentRun): Record<string, string> {
  const named: Record<string, string> = {};
  const add = (id: string, rec: unknown) => {
    const r = rec as TLShape | undefined;
    if (r?.typeName !== "shape" || !r.props || !r.meta) return;
    try {
      const name = shapeName(r);
      // A listing stays short: a name or first line longer than a label is cut, with an ellipsis.
      named[id] = name.length > NAME_MAX ? `${clip(name, NAME_MAX - 1)}…` : name;
    } catch {
      // A record too old or odd to name is listed by id alone.
    }
  };
  for (const [id, rec] of Object.entries(run.changes.added)) add(id, rec);
  for (const [id, [, to]] of Object.entries(run.changes.updated)) add(id, to);
  for (const [id, rec] of Object.entries(run.changes.removed)) add(id, rec);
  return named;
}

export function createRunLedger(max = 100) {
  const runs: AgentRun[] = [];
  return {
    add(run: AgentRun) {
      runs.push(run);
      if (runs.length > max) runs.shift();
    },
    get: (runId: string) => runs.find((r) => r.runId === runId),
    /** Newest first; with an actor, only that actor's runs; with a page, only runs that touched it. */
    list: (limit: number, actor?: string, pageId?: string) =>
      runs
        .filter((r) => (actor === undefined || r.actor === actor) && (pageId === undefined || !r.pages || r.pages.includes(pageId)))
        .slice(-limit)
        .reverse(),
  };
}
export type RunLedger = ReturnType<typeof createRunLedger>;

export function undoRun(editor: Editor, ledger: RunLedger, value: unknown, actor?: string) {
  const { runId } = undoRunInput.parse(value);
  const run = ledger.get(runId);
  if (!run) throw new Error(`Unknown run: ${runId}. canvas_runs lists recent runs in this tab.`);
  // Agents undo their own runs. The actor label is not authenticated, so this prevents
  // mistakes between cooperating agents rather than a determined one.
  if (actor !== undefined && run.actor !== actor) throw new Error(`Run ${runId} belongs to ${run.actor}. An agent can undo only its own runs.`);
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
  if (command.op === "runs") {
    return runsResult(ledger, command.input, actor, editor.getCurrentPageId());
  }
  if (command.op === "undo_run") return undoRun(editor, ledger, command.input, actor);
  if (readOnly.has(command.op)) return executeCommand(editor, command, actor);
  // Mutating operations finish synchronously, so every change lands inside this capture.
  let work: Promise<unknown> = Promise.resolve();
  const diff = editor.store.extractingChanges(() => {
    work = executeCommand(editor, command, actor);
  }) as unknown as RunDiff;
  const result = await work; // a failed command rolls back or throws before recording
  const changes = documentDiff(diff);
  if (!isEmptyDiff(changes)) {
    const pageOf = (id: string) => (id && editor.getShape(id as never) ? editor.getAncestorPageId(id as never) : undefined);
    ledger.add({ runId, op: command.op, actor, at: new Date().toISOString(), changes, undone: false, pages: pagesOfRun(changes, pageOf) });
  }
  return result;
}
