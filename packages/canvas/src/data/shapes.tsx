import { prototypeEnabled } from "../prototype-flags";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  PageRecordType,
  T,
  createShapeId,
  toRichText,
  useEditor,
  useValue,
  type Editor,
  type RecordProps,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import type { PointerEvent as ReactPointerEvent } from "react";
import { revision, shapeName } from "../operations";
import { flagLayout, SELECTION_BAR_ROOM } from "./flag-layout";
import {
  aggregate,
  chartStateSchema,
  datasetSchema,
  distinctValues,
  inputRefSchema,
  setCell,
  staleChain,
  staleReason,
  syntheticOrders,
  toggleFilter,
  toggleSelection,
  type Bar,
  type ChartState,
  type Dataset,
  type InputRef,
  type StaleInput,
} from "./model";

// PROTOTYPE (working spec: "Proposed first end-to-end acceptance scenario").
// A dataset object and a chart view over it. Both shapes are always registered so a
// saved board containing them still loads; the page that creates them is behind
// the ?prototype=data flag.

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    dataset: { w: number; h: number; data: Dataset };
    chart: { w: number; h: number; datasetId: string; state: ChartState; bars: Bar[]; inputVersion: number; version: number };
  }
}
export type DatasetShape = TLShape<"dataset">;
export type ChartShape = TLShape<"chart">;

export function dataPrototypeEnabled(search = typeof location === "undefined" ? "" : location.search) {
  return prototypeEnabled("data", search);
}

const keepToCanvas = (editor: Editor) => (e: ReactPointerEvent) => editor.markEventAsHandled(e);
const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString("en-GB") : n.toLocaleString("en-GB", { maximumFractionDigits: 1 }));

/** Version of an object's content: data for a dataset, state for a chart, revision otherwise. */
export function contentVersion(shape: TLShape) {
  if (shape.type === "dataset") return (shape as DatasetShape).props.data.version;
  if (shape.type === "chart") return (shape as ChartShape).props.version;
  return revision(shape);
}

/** Inputs a derived object recorded: a chart's dataset, or `meta.inputs` on any other object. */
export function recordedInputs(shape: TLShape): InputRef[] {
  if (shape.type === "chart") {
    const p = (shape as ChartShape).props;
    return p.datasetId ? [{ id: p.datasetId, version: p.inputVersion }] : [];
  }
  // Most objects record no inputs; skip validation for them (this runs for every shape).
  if (shape.meta.inputs === undefined) return [];
  const parsed = inputRefsSchema.safeParse(shape.meta.inputs);
  return parsed.success ? parsed.data : [];
}
const inputRefsSchema = inputRefSchema.array();

export function staleness(editor: Editor, shape: TLShape): StaleInput[] {
  const inputs = recordedInputs(shape);
  if (!inputs.length) return [];
  return staleChain(inputs, (id) => {
    const s = editor.getShape(id as TLShapeId);
    return s && { version: contentVersion(s), inputs: recordedInputs(s) };
  }, new Set([shape.id]));
}

function datasetOf(editor: Editor, chart: ChartShape) {
  const s = editor.getShape(chart.props.datasetId as TLShapeId);
  return s?.type === "dataset" ? (s as DatasetShape) : undefined;
}

/** Re-run the chart on its dataset's current data with a new state; records the input version used. */
export function runChart(editor: Editor, chart: ChartShape, state: ChartState = chart.props.state) {
  const data = datasetOf(editor, chart);
  if (!data) throw new Error("This chart's dataset is missing");
  const parsed = chartStateSchema.parse(state);
  const bars = aggregate(data.props.data, parsed);
  editor.updateShape<ChartShape>({
    id: chart.id,
    type: "chart",
    props: { state: parsed, bars, inputVersion: data.props.data.version, version: chart.props.version + 1 },
  });
}

export function editCell(editor: Editor, dataset: DatasetShape, row: number, column: string, value: string | number) {
  const data = setCell(dataset.props.data, row, column, value);
  editor.updateShape<DatasetShape>({ id: dataset.id, type: "dataset", props: { data } });
}

export class DatasetShapeUtil extends BaseBoxShapeUtil<DatasetShape> {
  static override type = "dataset" as const;
  static override props: RecordProps<DatasetShape> = {
    w: T.number,
    h: T.number,
    data: T.jsonValue.check((v) => {
      datasetSchema.parse(v);
    }) as unknown as T.Validator<Dataset>,
  };
  override getDefaultProps(): DatasetShape["props"] {
    return { w: 420, h: 460, data: syntheticOrders() };
  }
  override canEdit() {
    return false;
  }
  override component(shape: DatasetShape) {
    return <DatasetView shape={shape} />;
  }
  override getIndicatorPath(shape: DatasetShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 8);
    return path;
  }
}

function DatasetView({ shape }: { shape: DatasetShape }) {
  const editor = useEditor();
  const { data } = shape.props;
  const stop = keepToCanvas(editor);
  return (
    <HTMLContainer className="data-object" style={{ width: shape.props.w, height: shape.props.h }}>
      <div className="data-head">
        <span className="data-kind">Dataset · prototype</span>
        <strong>{data.title}</strong>
        <span className="data-meta">
          {data.rows.length} rows · v{data.version}
        </span>
        <span className="data-source">{data.source}</span>
      </div>
      <div className="data-table" onPointerDown={stop} onWheelCapture={(e) => e.stopPropagation()}>
        <table>
          <thead>
            <tr>
              {data.columns.map((c) => (
                <th key={c.name} className={c.type === "number" ? "num" : ""}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i}>
                {data.columns.map((c) =>
                  c.type === "number" ? (
                    <td key={c.name} className="num">
                      <input
                        aria-label={`${c.name}, row ${i + 1}`}
                        type="number"
                        defaultValue={row[c.name]}
                        key={`${data.version}-${row[c.name]}`}
                        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                        onBlur={(e) => {
                          const value = Number(e.currentTarget.value);
                          if (e.currentTarget.value === "" || !Number.isFinite(value) || value === row[c.name]) return;
                          editor.markHistoryStoppingPoint("edit cell");
                          editCell(editor, shape, i, c.name, value);
                        }}
                      />
                    </td>
                  ) : (
                    <td key={c.name}>{row[c.name]}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </HTMLContainer>
  );
}

export class ChartShapeUtil extends BaseBoxShapeUtil<ChartShape> {
  static override type = "chart" as const;
  static override props: RecordProps<ChartShape> = {
    w: T.number,
    h: T.number,
    datasetId: T.string,
    state: T.jsonValue as unknown as T.Validator<ChartState>,
    bars: T.jsonValue as unknown as T.Validator<Bar[]>,
    inputVersion: T.number,
    version: T.number,
  };
  override getDefaultProps(): ChartShape["props"] {
    return { w: 520, h: 400, datasetId: "", state: chartStateSchema.parse({ x: "region", y: "orders" }), bars: [], inputVersion: 0, version: 0 };
  }
  override canEdit() {
    return false;
  }
  override component(shape: ChartShape) {
    return <ChartView shape={shape} />;
  }
  override getIndicatorPath(shape: ChartShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 8);
    return path;
  }
}

function ChartView({ shape }: { shape: ChartShape }) {
  const editor = useEditor();
  const { state, bars } = shape.props;
  const stale = useValue("chart stale", () => staleness(editor, editor.getShape(shape.id) ?? shape), [editor, shape]);
  const data = useValue("chart dataset", () => datasetOf(editor, shape)?.props.data, [editor, shape.props.datasetId]);
  const stop = keepToCanvas(editor);
  const act = (name: string, next: ChartState) => {
    editor.markHistoryStoppingPoint(name);
    runChart(editor, shape, next);
  };
  const facets = data ? data.columns.filter((c) => c.type === "text" && c.name !== state.x) : [];
  const max = Math.max(1, ...bars.map((b) => b.value));
  const measure = state.aggregate === "count" ? "rows" : `${state.aggregate} of ${state.y}`;
  return (
    <HTMLContainer className={`data-object chart${stale.length ? " is-stale" : ""}`} style={{ width: shape.props.w, height: shape.props.h }}>
      <div className="data-head">
        <span className="data-kind">Chart · prototype</span>
        <strong>
          {measure} by {state.x}
        </strong>
        {stale.length > 0 && (
          <span className="data-stale" role="status">
            Stale: {stale[0].current === null ? "dataset removed" : `dataset changed (v${stale[0].recorded} → v${stale[0].current})`}
            {stale[0].current !== null && (
              <button onPointerDown={stop} onClick={() => act("recompute chart", state)}>
                Recompute
              </button>
            )}
          </span>
        )}
      </div>
      <div className="chart-filters" onPointerDown={stop}>
        {data &&
          facets.map((c) => (
            <div key={c.name} className="chart-facet">
              <span>{c.name}</span>
              {distinctValues(data, c.name).map((v) => {
                const on = (state.filter[c.name] ?? []).includes(v);
                return (
                  <button key={String(v)} className={on ? "chip on" : "chip"} aria-pressed={on} onClick={() => act("filter chart", toggleFilter(state, c.name, v))}>
                    {v}
                  </button>
                );
              })}
            </div>
          ))}
      </div>
      <div className="chart-bars" onPointerDown={stop}>
        {bars.map((b) => {
          const on = state.selected.includes(b.key);
          return (
            <button
              key={b.key}
              className={on ? "bar on" : "bar"}
              aria-pressed={on}
              aria-label={`${b.key}: ${fmt(b.value)}`}
              onClick={() => act("select bar", toggleSelection(state, b.key))}
            >
              <span className="bar-value">{fmt(b.value)}</span>
              <span className="bar-fill" style={{ height: `${(b.value / max) * 100}%` }} />
              <span className="bar-key">{b.key}</span>
            </button>
          );
        })}
        {!bars.length && <p className="chart-empty">No rows match this filter.</p>}
      </div>
    </HTMLContainer>
  );
}

/** Stale badge for derived objects other than charts (e.g. an agent's explanation card). */
export function DataLayer() {
  const editor = useEditor();
  const items = useValue(
    "stale derived objects",
    () => {
      const selected = new Set<string>(editor.getSelectedShapeIds());
      const viewport = editor.getViewportPageBounds(), zoom = editor.getZoomLevel();
      return editor.getCurrentPageShapes().flatMap((s) => {
        if (s.type === "chart" || editor.isShapeHidden(s)) return [];
        const stale = staleness(editor, s);
        const b = stale.length ? editor.getShapePageBounds(s) : undefined;
        if (!b) return [];
        const nameOf = (id: string) => {
          const shape = editor.getShape(id as TLShapeId);
          // A result still hidden behind a learning prompt is not named before the person answers.
          return shape && !editor.isShapeHidden(shape) ? shapeName(shape) : undefined;
        };
        const layout = { ...flagLayout(b, viewport, zoom), zoom };
        return [{ id: s.id, x: b.x, y: b.y, w: b.w, h: b.h, name: shapeName(s), reason: staleReason(stale, nameOf), open: selected.has(s.id), ...layout }];
      });
    },
    [editor],
  );
  // The flag says which input changed, so the person knows what to recheck. On the board a
  // long reason is cut short; selecting the object, or reaching the flag with Tab, shows all of it.
  return (
    <div className="scratch-layer">
      {items.map((i) => (
        <span
          key={i.id}
          className={["stale-flag", i.open && "open", i.growDown && "grow-down"].filter(Boolean).join(" ")}
          data-shape-id={i.id}
          role="note"
          // Only flags on screen are Tab stops: focus does not move the camera.
          tabIndex={i.inView ? 0 : -1}
          aria-label={`${i.name} is out of date: ${i.reason}`}
          title={`Out of date: ${i.reason}`}
          // Selected, the whole reason opens under the object, clear of the selection bar above it,
          // or above the object when the bottom of the view is too close.
          style={{
            transform: !i.open
              ? `translate(${i.x + i.w}px, ${i.y - 12}px) translateX(-100%)`
              : i.openBelow
                ? `translate(${i.x}px, ${i.y + i.h + 8}px)`
                : `translate(${i.x}px, ${i.y - (8 + SELECTION_BAR_ROOM) / i.zoom}px) translateY(-100%)`,
          }}
        >
          stale · {i.reason}
        </span>
      ))}
    </div>
  );
}

/** Create a "Data prototype" page with the synthetic dataset, a chart and a human question. */
export function createDataPrototypePage(editor: Editor) {
  const page = PageRecordType.createId();
  const datasetId = createShapeId(), chartId = createShapeId();
  editor.markHistoryStoppingPoint("data prototype page");
  editor.run(() => {
    editor.createPage({ id: page, name: "Data prototype" });
    editor.setCurrentPage(page);
    editor.createShape({
      id: createShapeId(),
      type: "card",
      x: 0,
      y: -150,
      meta: { name: "Data prototype heading", createdBy: "Paired" },
      props: { w: 900, richText: toRichText("Data prototype (proposed): filter the chart, edit a number, watch the chart go stale"), tone: "heading" },
    });
    const data = syntheticOrders();
    editor.createShape<DatasetShape>({ id: datasetId, type: "dataset", x: 0, y: 0, meta: { name: "Café orders" }, props: { w: 420, h: 460, data } });
    const state = chartStateSchema.parse({ x: "region", y: "orders" });
    editor.createShape<ChartShape>({
      id: chartId,
      type: "chart",
      x: 480,
      y: 0,
      meta: { name: "Orders by region" },
      props: { w: 560, h: 420, datasetId, state, bars: aggregate(data, state), inputVersion: data.version, version: 0 },
    });
    editor.createShape({
      id: createShapeId(),
      type: "card",
      x: 1080,
      y: 20,
      meta: { name: "Question" },
      props: { w: 240, richText: toRichText("Why is cake so much lower than tea?"), tone: "human" },
    });
  });
  editor.zoomToFit();
  return { page, datasetId, chartId };
}
