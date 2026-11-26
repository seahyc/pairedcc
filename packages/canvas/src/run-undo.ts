import { z } from "zod";
import { isDerivedField } from "./revision";

export const runsInput = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  page: z.enum(["current", "all"]).default("all").describe("current: only runs that changed something on the page open in the tab. all (default): runs on every page."),
});
export const undoRunInput = z.object({ runId: z.string().min(1).max(100) });

// Selective undo for one agent run. A run's store diff is reversed field by field,
// but only where nobody has changed those fields since: if the human (or another
// run) edited anything the run touched, the whole undo is rejected and the
// conflicts are reported. Human work is never silently replaced.

type Rec = { id: string; typeName: string; type?: string } & Record<string, unknown>;
export type RunDiff = {
  added: Record<string, Rec>;
  updated: Record<string, [from: Rec, to: Rec]>;
  removed: Record<string, Rec>;
};
export type UndoConflict = { id: string; reason: string; fields?: string[] };
export type UndoPlan = { put: Rec[]; remove: string[]; conflicts: UndoConflict[] };

/** Records that belong to the shared document, as opposed to one tab's camera, pointer or selection. */
export const documentTypes = new Set(["shape", "binding", "asset", "page"]);

export function documentDiff(diff: RunDiff): RunDiff {
  const keep = <T>(m: Record<string, T>, rec: (v: T) => Rec) =>
    Object.fromEntries(Object.entries(m).filter(([, v]) => documentTypes.has(rec(v).typeName)));
  return {
    added: keep(diff.added, (r) => r),
    updated: keep(diff.updated, ([, to]) => to),
    removed: keep(diff.removed, (r) => r),
  };
}

export const isEmptyDiff = (d: RunDiff) =>
  !Object.keys(d.added).length && !Object.keys(d.updated).length && !Object.keys(d.removed).length;

function ignored(rec: Rec, path: string) {
  if (isDerivedField(rec.type, path)) return true;
  // A connector that follows its ends re-picks its anchor sides and bend when an end moves
  // (src/connector-follow.ts); that re-route is derived, not an edit to the connector.
  if (rec.typeName === "binding" && path === "props.normalizedAnchor" && (rec.meta as { followed?: unknown } | undefined)?.followed) return true;
  if (rec.typeName === "binding" && path === "meta.followed") return true;
  const meta = rec.meta as { fromId?: unknown; fixedAnchors?: unknown } | undefined;
  return rec.typeName === "shape" && rec.type === "arrow" && path === "props.bend" && typeof meta?.fromId === "string" && !meta.fixedAnchors;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const nested = new Set(["props", "meta"]);
function get(rec: Rec, path: string): unknown {
  const [head, tail] = path.split(/\.(.*)/s);
  return tail === undefined ? rec[head] : (rec[head] as Record<string, unknown> | undefined)?.[tail];
}
function set(rec: Rec, path: string, value: unknown): Rec {
  const [head, tail] = path.split(/\.(.*)/s);
  if (tail === undefined) {
    const next = { ...rec };
    if (value === undefined) delete next[head];
    else next[head] = value;
    return next;
  }
  const inner = { ...(rec[head] as Record<string, unknown>) };
  if (value === undefined) delete inner[tail];
  else inner[tail] = value;
  return { ...rec, [head]: inner };
}

/** Field paths (top-level, props.*, meta.*) that differ between two versions of a record. */
export function changedPaths(a: Rec, b: Rec): string[] {
  const paths = new Set<string>();
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (nested.has(key)) {
      const pa = (a[key] ?? {}) as Record<string, unknown>, pb = (b[key] ?? {}) as Record<string, unknown>;
      for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)])) if (!equal(pa[k], pb[k])) paths.add(`${key}.${k}`);
    } else if (!equal(a[key], b[key])) paths.add(key);
  }
  return [...paths].filter((p) => !ignored(b, p));
}

const order = ["page", "asset", "shape", "binding"];
const rank = (r: Rec) => order.indexOf(r.typeName);

/** Work out how to reverse a run against the current document, or why it cannot be. */
export function planUndo(diff: RunDiff, current: (id: string) => Rec | undefined): UndoPlan {
  const put: Rec[] = [], remove: string[] = [], conflicts: UndoConflict[] = [];
  for (const [id, created] of Object.entries(diff.added)) {
    const now = current(id);
    if (!now) continue; // already gone
    const fields = changedPaths(created, now);
    if (fields.length) conflicts.push({ id, reason: "changed after the run created it", fields });
    else remove.push(id);
  }
  for (const [id, [from, to]] of Object.entries(diff.updated)) {
    const now = current(id);
    if (!now) {
      conflicts.push({ id, reason: "deleted after the run changed it" });
      continue;
    }
    const paths = changedPaths(from, to);
    // A lock set since the run means hands off, the same as for any other agent write.
    if (now.isLocked && to.isLocked !== true) {
      conflicts.push({ id, reason: "locked after the run changed it" });
      continue;
    }
    const fields = paths.filter((p) => !equal(get(now, p), get(to, p)));
    if (fields.length) conflicts.push({ id, reason: "changed again after the run", fields });
    else if (paths.length) put.push(paths.reduce((rec, p) => set(rec, p, get(from, p)), now));
  }
  for (const [id, deleted] of Object.entries(diff.removed)) {
    if (current(id)) conflicts.push({ id, reason: "recreated after the run deleted it" });
    else put.push(deleted);
  }
  // What comes back must not point at something deleted since: a shape needs its parent
  // frame or page, a binding both of its ends, either still there or restored with it.
  const present = (ref: unknown) => typeof ref !== "string" || !!current(ref) || ref in diff.removed;
  for (const rec of put) {
    if (!(rec.id in diff.removed)) continue;
    if (rec.typeName === "shape" && !present(rec.parentId))
      conflicts.push({ id: rec.id, reason: `its parent ${String(rec.parentId)} was deleted after the run` });
    if (rec.typeName === "binding")
      for (const end of [rec.fromId, rec.toId])
        if (!present(end)) conflicts.push({ id: rec.id, reason: `it connects ${String(end)}, which was deleted after the run` });
  }
  if (conflicts.length) return { put: [], remove: [], conflicts };
  put.sort((a, b) => rank(a) - rank(b));
  // Remove bindings before the shapes they connect.
  const removeRank = (id: string) => -order.indexOf(diff.added[id]?.typeName ?? "shape");
  remove.sort((a, b) => removeRank(a) - removeRank(b));
  return { put, remove, conflicts };
}
