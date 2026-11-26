import type { InputRef } from "./data/model";
import type { AgentRun } from "./agent-runs";

// PROTOTYPE: the working spec's proposed foundational primitives (Relationship, Source,
// Transformation, Agent run) as typed values. They are not stored separately: each is derived
// from what the board already records (arrow metadata, `meta.inputs`, a chart's dataset, a
// dataset's source note, an image's source URL, the run ledger), so there is one source of truth
// and no migration. Pure functions over plain records; tested in test/primitives.test.ts.

/** The fields of a tldraw record that the primitives read. */
export type PrimitiveRecord = {
  id: string;
  type: string;
  meta?: Record<string, unknown>;
  props?: Record<string, unknown>;
};

/** An arrow end bound to an object, as tldraw's arrow bindings record it. */
export type ArrowEnd = { arrowId: string; terminal: "start" | "end"; toId: string };

export type RelationshipKind = "derived-from" | "alternative" | "reference" | "feedback" | "depends-on" | "annotates" | "decorative";

/**
 * An inspectable connection from one object to another. `via` says where it is recorded:
 * an arrow on the board, a result's recorded inputs, a chart's dataset or an annotation's
 * target. A hand-drawn arrow with no relation is `decorative`: visible, but it means nothing
 * to the system.
 */
export type Relationship = {
  kind: RelationshipKind;
  from: string;
  to: string;
  via: "arrow" | "inputs" | "chart" | "annotation";
  /** The arrow's ID when `via` is arrow. */
  arrowId?: string;
  label?: string;
  author?: string;
};

const KINDS = new Set<RelationshipKind>(["derived-from", "alternative", "reference", "feedback", "depends-on"]);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const author = (r: PrimitiveRecord) => str(r.meta?.createdBy) ?? str(r.meta?.author);
const inputsOf = (r: PrimitiveRecord): InputRef[] =>
  Array.isArray(r.meta?.inputs) ? (r.meta!.inputs as unknown[]).filter((i): i is InputRef => !!i && typeof (i as InputRef).id === "string") : [];
const labelOf = (r: PrimitiveRecord) => {
  const text = (r.props?.richText as { content?: { content?: { text?: string }[] }[] } | undefined)?.content
    ?.flatMap((p) => p.content ?? [])
    .map((t) => t.text ?? "")
    .join("")
    .trim();
  return text || str(r.meta?.name);
};

/** Every relationship on a set of records. Arrow ends come from `ends` when given, else from arrow meta. */
export function relationships(records: readonly PrimitiveRecord[], ends: readonly ArrowEnd[] = []): Relationship[] {
  const out: Relationship[] = [];
  for (const r of records) {
    if (r.type === "arrow") {
      const start = ends.find((e) => e.arrowId === r.id && e.terminal === "start")?.toId ?? str(r.meta?.fromId);
      const end = ends.find((e) => e.arrowId === r.id && e.terminal === "end")?.toId ?? str(r.meta?.toId);
      if (!start || !end) continue; // an unbound arrow connects nothing
      const relation = str(r.meta?.relation) as RelationshipKind | undefined;
      const label = labelOf(r);
      out.push({
        kind: relation && KINDS.has(relation) ? relation : "decorative",
        from: start,
        to: end,
        via: "arrow",
        arrowId: r.id,
        ...(label && label !== "Arrow" ? { label } : {}),
        ...(author(r) ? { author: author(r) } : {}),
      });
    }
    for (const i of inputsOf(r)) out.push({ kind: "derived-from", from: r.id, to: i.id, via: "inputs", ...(author(r) ? { author: author(r) } : {}) });
    if (r.type === "chart" && str(r.props?.datasetId)) out.push({ kind: "depends-on", from: r.id, to: str(r.props!.datasetId)!, via: "chart" });
    if (r.meta?.role === "annotation") {
      const targets = new Set([str(r.meta.targetId), ...(Array.isArray(r.meta.targetIds) ? r.meta.targetIds.map(str) : [])].filter((t): t is string => !!t));
      for (const t of targets) out.push({ kind: "annotates", from: r.id, to: t, via: "annotation", ...(author(r) ? { author: author(r) } : {}) });
    }
  }
  return out;
}

/** The relationships that touch one object, split by direction. */
export function relationshipsOf(id: string, all: readonly Relationship[]) {
  return { outgoing: all.filter((r) => r.from === id), incoming: all.filter((r) => r.to === id) };
}

/**
 * Where an object's content came from. `generated` is true when an agent made the object and
 * names no outside origin, so generated interpretation stays distinguishable from source material.
 */
export type Source = { objectId: string; origin?: string; url?: string; version?: number; generated: boolean };

export function sourceOf(r: PrimitiveRecord): Source | undefined {
  const agentMade = !!author(r) && author(r) !== "Human";
  if (r.type === "dataset") {
    const data = r.props?.data as { source?: string; version?: number } | undefined;
    return { objectId: r.id, ...(str(data?.source) ? { origin: data!.source } : {}), ...(typeof data?.version === "number" ? { version: data.version } : {}), generated: agentMade && !str(data?.source) };
  }
  const url = str(r.meta?.sourceUrl);
  if (url) return { objectId: r.id, url, generated: false };
  if (r.type === "image") return { objectId: r.id, generated: agentMade };
  return undefined;
}

/**
 * Named inputs and parameters producing an output, with the input versions used. A chart is an
 * aggregation of its dataset with its state as parameters; any object with recorded inputs is a
 * derivation whose parameters are not recorded.
 */
export type Transformation = {
  output: string;
  name: "aggregate" | "derive";
  inputs: InputRef[];
  parameters?: Record<string, unknown>;
};

export function transformationOf(r: PrimitiveRecord): Transformation | undefined {
  if (r.type === "chart" && str(r.props?.datasetId))
    return {
      output: r.id,
      name: "aggregate",
      inputs: [{ id: str(r.props!.datasetId)!, version: typeof r.props!.inputVersion === "number" ? r.props!.inputVersion : 0 }],
      parameters: (r.props!.state as Record<string, unknown>) ?? {},
    };
  const inputs = inputsOf(r);
  return inputs.length ? { output: r.id, name: "derive", inputs } : undefined;
}

/**
 * An agent run as the spec describes it: the request, who made it, what it touched and whether
 * it can still be reversed. Operations are applied in one step, so progress is either done or
 * undone; there is nothing in flight to cancel.
 */
export type AgentRunPrimitive = {
  runId: string;
  request: string;
  actor: string;
  at: string;
  scope: string[];
  progress: "done" | "undone";
  changes: { created: string[]; updated: string[]; removed: string[] };
  /** Not yet undone. Undo may still refuse if a later edit conflicts (see run-undo.ts). */
  reversible: boolean;
};

export function agentRunOf(run: AgentRun): AgentRunPrimitive {
  const created = Object.keys(run.changes.added), updated = Object.keys(run.changes.updated), removed = Object.keys(run.changes.removed);
  return {
    runId: run.runId,
    request: run.op,
    actor: run.actor,
    at: run.at,
    scope: [...new Set([...created, ...updated, ...removed])],
    progress: run.undone ? "undone" : "done",
    changes: { created, updated, removed },
    reversible: !run.undone,
  };
}
