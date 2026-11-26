import { createShapeId, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { z } from "zod";
import { describeObject, revision } from "../operations";
import { aggregate, chartStateSchema, datasetSchema, describeChart, syntheticOrders } from "./model";
import { contentVersion, editCell, runChart, staleness, type ChartShape, type DatasetShape } from "./shapes";

// PROTOTYPE agent operations for the data acceptance scenario. Agents create datasets
// and charts, drive the same chart state the person clicks, edit inputs, read exactly
// what a chart shows, and record which inputs an explanation was derived from.

const box = {
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().min(160).max(4000).optional(),
  height: z.number().min(120).max(4000).optional(),
};
export const datasetInput = z.object({
  ...box,
  synthetic: z.literal("orders").optional().describe("Use the built-in synthetic café orders instead of supplying data."),
  title: z.string().max(200).optional(),
  source: z.string().max(500).optional().describe("Where the data came from. Say so if it is synthetic."),
  columns: datasetSchema.shape.columns.optional(),
  rows: datasetSchema.shape.rows.optional(),
});
export const chartInput = z.object({
  ...box,
  datasetId: z.string().startsWith("shape:"),
  state: chartStateSchema,
});
export const chartStateInput = z.object({
  id: z.string().startsWith("shape:"),
  expectedRevision: z.number().int().nonnegative(),
  state: z
    .object({
      x: chartStateSchema.shape.x.optional(),
      y: chartStateSchema.shape.y.optional(),
      aggregate: chartStateSchema.shape.aggregate.removeDefault().optional(),
      filter: chartStateSchema.shape.filter.removeDefault().optional(),
      selected: chartStateSchema.shape.selected.removeDefault().optional(),
    })
    .describe("Fields to change; omitted fields keep their current value. Replaces filter and selected wholesale."),
});
export const cellInput = z.object({
  id: z.string().startsWith("shape:"),
  expectedRevision: z.number().int().nonnegative(),
  row: z.number().int().nonnegative().describe("Zero-based row index."),
  column: z.string().min(1).max(100),
  value: z.union([z.string().max(500), z.number().finite()]),
});

function guarded(editor: Editor, id: string, expectedRevision: number, type: "dataset" | "chart") {
  const s = editor.getCurrentPageShapes().find((s) => s.id === id);
  if (!s) throw new Error(`Object not found: ${id}`);
  if (s.type !== type) throw new Error(`${id} is not a ${type}`);
  if (s.isLocked || editor.isShapeOrAncestorLocked(s)) throw new Error("Unlock this object before changing it");
  if (revision(s) !== expectedRevision) throw new Error("Object changed. Read its current revision before updating.");
  return s;
}

export function createDataset(editor: Editor, value: unknown, actor: string) {
  const input = datasetInput.parse(value);
  const data = input.synthetic
    ? syntheticOrders()
    : datasetSchema.parse({ title: input.title ?? "Dataset", source: input.source ?? "Supplied by an agent", columns: input.columns, rows: input.rows, version: 0 });
  const id = createShapeId();
  editor.markHistoryStoppingPoint("agent dataset");
  editor.createShape<DatasetShape>({
    id,
    type: "dataset",
    x: input.x,
    y: input.y,
    meta: { name: data.title, revision: 0, createdBy: actor },
    props: { w: input.width ?? 420, h: input.height ?? 460, data },
  });
  return describeData(editor, editor.getShape(id)!);
}

export function createChart(editor: Editor, value: unknown, actor: string) {
  const input = chartInput.parse(value);
  const dataset = editor.getCurrentPageShapes().find((s) => s.id === input.datasetId);
  if (dataset?.type !== "dataset") throw new Error("datasetId must be a dataset on the current page");
  const data = (dataset as DatasetShape).props.data;
  const bars = aggregate(data, input.state);
  const id = createShapeId();
  editor.markHistoryStoppingPoint("agent chart");
  editor.createShape<ChartShape>({
    id,
    type: "chart",
    x: input.x,
    y: input.y,
    meta: { name: `${input.state.aggregate} of ${input.state.y} by ${input.state.x}`, revision: 0, createdBy: actor },
    props: { w: input.width ?? 560, h: input.height ?? 420, datasetId: dataset.id, state: input.state, bars, inputVersion: data.version, version: 0 },
  });
  return describeData(editor, editor.getShape(id)!);
}

export function setChartState(editor: Editor, value: unknown) {
  const input = chartStateInput.parse(value);
  const chart = guarded(editor, input.id, input.expectedRevision, "chart") as ChartShape;
  editor.markHistoryStoppingPoint("agent chart state");
  runChart(editor, chart, chartStateSchema.parse({ ...chart.props.state, ...input.state }));
  return describeData(editor, editor.getShape(chart.id)!);
}

export function setDatasetCell(editor: Editor, value: unknown) {
  const input = cellInput.parse(value);
  const dataset = guarded(editor, input.id, input.expectedRevision, "dataset") as DatasetShape;
  editor.markHistoryStoppingPoint("agent edit cell");
  editCell(editor, dataset, input.row, input.column, input.value);
  return describeData(editor, editor.getShape(dataset.id)!);
}

/** Record the current content version of each input on a derived object. */
export function recordInputs(editor: Editor, ids: readonly string[]) {
  return ids.map((id) => {
    const s = editor.getCurrentPageShapes().find((s) => s.id === id);
    if (!s) throw new Error(`Input not found: ${id}`);
    return { id, version: contentVersion(s) };
  });
}

/**
 * Read-model fields for data objects. A dataset is summarised (rows only through
 * canvas_get). A chart reports exactly what it shows: if it is stale, the bars it
 * displays come from the older data, and the agent is told so.
 */
export function dataFields(editor: Editor, s: TLShape, full = false) {
  const stale = staleness(editor, s);
  const extra: Record<string, unknown> = stale.length ? { stale } : {};
  if (s.type === "dataset") {
    const { data } = (s as DatasetShape).props;
    extra.dataset = { title: data.title, source: data.source, columns: data.columns, rowCount: data.rows.length, version: data.version, ...(full ? { rows: data.rows } : {}) };
  }
  if (s.type === "chart") {
    const chart = s as ChartShape;
    const dataset = editor.getShape(chart.props.datasetId as TLShapeId) as DatasetShape | undefined;
    extra.widget = !stale.length && dataset
      ? { ...describeChart(dataset.props.data, chart.props.state), datasetId: chart.props.datasetId, datasetVersion: chart.props.inputVersion, version: chart.props.version }
      : {
          state: chart.props.state,
          bars: chart.props.bars,
          selected: chart.props.bars.filter((b) => chart.props.state.selected.includes(b.key)),
          datasetId: chart.props.datasetId,
          datasetVersion: chart.props.inputVersion,
          version: chart.props.version,
          note: "Stale: these bars were computed from an older dataset version. Set the chart state (even unchanged) to recompute.",
        };
  }
  return extra;
}

function describeData(editor: Editor, s: TLShape) {
  const object = describeObject(editor, s.id)!;
  const { props, ...rest } = object;
  const { data: _data, bars: _bars, ...size } = props as Record<string, unknown>;
  return { ...rest, props: size, ...dataFields(editor, s) };
}
