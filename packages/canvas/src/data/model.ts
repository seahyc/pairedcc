import { z } from "zod";

// Data prototype for the first acceptance scenario in docs/canvas/working-spec.md:
// a dataset object, a chart view over it with direct filtering and selection, exact
// widget state an agent can read, and stale marking when an input changes.
// Pure functions only; the canvas shapes in ./shapes.tsx render and store this state.

const cell = z.union([z.string().max(500), z.number().finite()]);
export const columnSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["text", "number"]),
});
export const datasetSchema = z
  .object({
    title: z.string().max(200),
    /** Where the data came from; synthetic data says so. */
    source: z.string().max(500),
    columns: z.array(columnSchema).min(1).max(50),
    rows: z.array(z.record(z.string(), cell)).max(5000),
    /** Content version: bumps only when the data changes, never when the object moves. */
    version: z.number().int().nonnegative(),
  })
  .superRefine((d, ctx) => {
    const names = new Set(d.columns.map((c) => c.name));
    if (names.size !== d.columns.length) ctx.addIssue({ code: "custom", message: "Column names must be unique" });
    d.rows.forEach((row, i) => {
      for (const c of d.columns) {
        const v = row[c.name];
        if (v === undefined) ctx.addIssue({ code: "custom", path: ["rows", i, c.name], message: `Missing ${c.name}` });
        else if (c.type === "number" ? typeof v !== "number" : typeof v !== "string")
          ctx.addIssue({ code: "custom", path: ["rows", i, c.name], message: `${c.name} must be ${c.type}` });
      }
      for (const key of Object.keys(row))
        if (!names.has(key)) ctx.addIssue({ code: "custom", path: ["rows", i, key], message: `Unknown column ${key}` });
    });
  });
export type Dataset = z.infer<typeof datasetSchema>;
export type Row = Dataset["rows"][number];

export const chartStateSchema = z.object({
  /** Category column on the x axis. */
  x: z.string().min(1).max(100),
  /** Numeric measure; ignored by the count aggregate. */
  y: z.string().min(1).max(100),
  aggregate: z.enum(["sum", "mean", "count"]).default("sum"),
  /** Keep rows whose column value is one of the listed values. Empty means no filter. */
  filter: z.record(z.string(), z.array(cell).max(500)).default({}),
  /** Bars the person (or agent) has selected, by category key. */
  selected: z.array(z.string()).max(500).default([]),
});
export type ChartState = z.infer<typeof chartStateSchema>;

export type Bar = { key: string; value: number; count: number };

function column(data: Dataset, name: string) {
  const c = data.columns.find((c) => c.name === name);
  if (!c) throw new Error(`Unknown column: ${name}`);
  return c;
}

export function filteredRows(data: Dataset, state: ChartState): Row[] {
  const clauses = Object.entries(state.filter).filter(([, values]) => values.length);
  for (const [name] of clauses) column(data, name);
  return data.rows.filter((row) => clauses.every(([name, values]) => values.includes(row[name])));
}

export function aggregate(data: Dataset, state: ChartState): Bar[] {
  column(data, state.x);
  if (state.aggregate !== "count" && column(data, state.y).type !== "number")
    throw new Error(`${state.y} is not numeric`);
  const groups = new Map<string, Row[]>();
  for (const row of filteredRows(data, state)) {
    const key = String(row[state.x]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([key, rows]) => {
    const total = rows.reduce((n, r) => n + Number(r[state.y]), 0);
    const value = state.aggregate === "count" ? rows.length : state.aggregate === "mean" ? total / rows.length : total;
    return { key, value, count: rows.length };
  });
}

function toggle<T>(list: readonly T[], value: T) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function toggleFilter(state: ChartState, name: string, value: string | number): ChartState {
  const next = toggle(state.filter[name] ?? [], value);
  const filter = { ...state.filter };
  if (next.length) filter[name] = next;
  else delete filter[name];
  return { ...state, filter };
}

export function toggleSelection(state: ChartState, key: string): ChartState {
  return { ...state, selected: toggle(state.selected, key) };
}

export function describeFilter(state: ChartState) {
  const parts = Object.entries(state.filter)
    .filter(([, v]) => v.length)
    .map(([name, values]) => `${name} = ${values.join(" or ")}`);
  return parts.length ? parts.join(", ") : "no filter";
}

/** Exactly what the chart shows, in a form an agent can read and cite. */
export function describeChart(data: Dataset, state: ChartState) {
  const rows = filteredRows(data, state);
  const bars = aggregate(data, state);
  const measure = state.aggregate === "count" ? "count of rows" : `${state.aggregate} of ${state.y}`;
  return {
    state,
    summary: `${measure} by ${state.x}; ${describeFilter(state)}; ${rows.length} of ${data.rows.length} rows`,
    rowsInView: rows.length,
    bars,
    selected: bars
      .filter((b) => state.selected.includes(b.key))
      .map((b) => ({ ...b, rows: rows.filter((r) => String(r[state.x]) === b.key) })),
  };
}

/** Distinct values of a column, in first-seen order, for filter controls. */
export function distinctValues(data: Dataset, name: string) {
  column(data, name);
  return [...new Set(data.rows.map((r) => r[name]))];
}

export function setCell(data: Dataset, index: number, name: string, value: string | number): Dataset {
  const c = column(data, name);
  if (index < 0 || index >= data.rows.length || !Number.isInteger(index)) throw new Error(`Row ${index} does not exist`);
  if (c.type === "number" && (typeof value !== "number" || !Number.isFinite(value)))
    throw new Error(`${name} must be a number`);
  if (c.type === "text" && typeof value !== "string") throw new Error(`${name} must be text`);
  const rows = data.rows.map((r, i) => (i === index ? { ...r, [name]: value } : r));
  return { ...data, rows, version: data.version + 1 };
}

/** An input recorded by a derived object: which object, at which content version. */
export const inputRefSchema = z.object({ id: z.string().startsWith("shape:"), version: z.number().int().nonnegative() });
export type InputRef = z.infer<typeof inputRefSchema>;
/**
 * A stale input. `current` differs from `recorded` when the input itself changed (`null` when
 * it was deleted). When the input is unchanged but is itself stale, `upstream` says why.
 */
export type StaleInput = { id: string; recorded: number; current: number | null; upstream?: StaleInput[] };

/** Inputs whose content has changed since they were used, or that no longer exist. */
export function staleInputs(inputs: readonly InputRef[], versions: ReadonlyMap<string, number>): StaleInput[] {
  return inputs
    .map((i) => ({ id: i.id, recorded: i.version, current: versions.get(i.id) ?? null }))
    .filter((i) => i.current !== i.recorded);
}

/**
 * Why an object is stale, for the person: the root cause first (the input that actually
 * changed), then the path it came through. `nameOf` gives an object's display name.
 */
export function staleReason(stale: readonly StaleInput[], nameOf: (id: string) => string | undefined): string {
  if (!stale.length) return "";
  const quote = (id: string) => (nameOf(id) ? `“${nameOf(id)}”` : undefined);
  // Every root cause (an input that itself changed or was deleted), with the path to it.
  const causes: { s: StaleInput; via: string[] }[] = [];
  const walk = (s: StaleInput, via: string[]) => {
    if (s.upstream?.length) for (const u of s.upstream) walk(u, [...via, s.id]);
    else causes.push({ s, via });
  };
  for (const s of stale) walk(s, []);
  const { s: root, via } = causes[0];
  const what = root.current === null ? (quote(root.id) ? `${quote(root.id)} was deleted` : "an input was deleted") : `${quote(root.id) ?? "an input"} changed`;
  const path = via.map(quote).filter(Boolean);
  const first = path.length ? `${what} (via ${path.join(", ")})` : what;
  const more = causes.length - 1;
  return more ? `${first}, and ${more} more input${more > 1 ? "s" : ""}` : first;
}

/** What staleChain needs to know about an object: its content version and recorded inputs. */
export type Derivation = { version: number; inputs: readonly InputRef[] };

/**
 * Stale inputs, followed up the chain: a note derived from a chart is stale when the chart's
 * dataset changed, even before the chart is recomputed. Cycles are not stale by themselves.
 */
export function staleChain(
  inputs: readonly InputRef[],
  lookup: (id: string) => Derivation | undefined,
  seen: ReadonlySet<string> = new Set(),
): StaleInput[] {
  return inputs.flatMap((i): StaleInput[] => {
    const node = lookup(i.id);
    if (!node) return [{ id: i.id, recorded: i.version, current: null }];
    if (node.version !== i.version) return [{ id: i.id, recorded: i.version, current: node.version }];
    if (seen.has(i.id)) return [];
    const upstream = staleChain(node.inputs, lookup, new Set([...seen, i.id]));
    return upstream.length ? [{ id: i.id, recorded: i.version, current: node.version, upstream }] : [];
  });
}

// Small deterministic PRNG so the synthetic data is identical on every machine.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Synthetic café orders: 4 regions × 3 products × 4 months. Invented numbers. */
export function syntheticOrders(): Dataset {
  const random = mulberry32(27);
  const months = ["Jan", "Feb", "Mar", "Apr"], regions = ["North", "South", "East", "West"];
  const products = { Coffee: 120, Tea: 60, Cake: 40 } as const;
  const rows: Row[] = [];
  for (const region of regions)
    for (const [product, base] of Object.entries(products))
      for (const [m, month] of months.entries())
        rows.push({ month, region, product, orders: Math.round(base * (1 + m * 0.08) * (0.7 + random() * 0.6)) });
  return {
    title: "Café orders (synthetic)",
    source: "Generated by syntheticOrders() in packages/canvas/src/data/model.ts; not real data.",
    columns: [
      { name: "month", type: "text" },
      { name: "region", type: "text" },
      { name: "product", type: "text" },
      { name: "orders", type: "number" },
    ],
    rows,
    version: 0,
  };
}
