import { useLayoutEffect, useRef } from "react";
import { BaseBoxShapeUtil, HTMLContainer, T, type RecordProps, type TLShape } from "tldraw";
import { isNumeric } from "./import-parse";

// An imported grid that should stay a grid: mostly numbers or short labels. Read-only for
// now; it moves, can be picked, crossed out, commented on and asked about like anything else.
declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    datatable: { w: number; h: number; title: string; columns: string[]; rows: string[][] };
  }
}
export type DataTableShape = TLShape<"datatable">;

/** Rows drawn on the board; the rest stay in the object's data. */
export const TABLE_ROWS_SHOWN = 200;
const CHAR = 7.2, PAD = 22, MIN = 56, MAX = 300, ROW = 27, LINE = 18;

/** Column widths from the content, and a first estimate of the height. */
export function tableLayout(columns: string[], rows: string[][], title: string) {
  const shown = rows.slice(0, TABLE_ROWS_SHOWN);
  const widths = columns.map((c, i) => {
    const longest = Math.max(c.length, ...shown.map((r) => (r[i] ?? "").length));
    return Math.round(Math.min(MAX, Math.max(MIN, longest * CHAR + PAD)));
  });
  const lines = (cells: string[]) => Math.max(1, ...cells.map((c, i) => Math.ceil(((c ?? "").length * CHAR) / (widths[i] - PAD + 1))));
  const body = shown.reduce((h, r) => h + (ROW - LINE) + lines(r) * LINE, 0);
  const h = (title ? 36 : 0) + (ROW - LINE) + lines(columns) * LINE + body + (rows.length > shown.length ? ROW : 0) + 4;
  return { widths, w: widths.reduce((a, b) => a + b, 0) + 2, h: Math.ceil(h) };
}

export class DataTableShapeUtil extends BaseBoxShapeUtil<DataTableShape> {
  static override type = "datatable" as const;
  static override props: RecordProps<DataTableShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    columns: T.arrayOf(T.string),
    rows: T.arrayOf(T.arrayOf(T.string)),
  };
  override canEdit() {
    return false;
  }
  override canResize() {
    return false;
  }
  override getDefaultProps(): DataTableShape["props"] {
    return { w: 320, h: 120, title: "", columns: [], rows: [] };
  }
  override component(shape: DataTableShape) {
    const { title, columns, rows } = shape.props;
    const { widths } = tableLayout(columns, rows, title);
    const shown = rows.slice(0, TABLE_ROWS_SHOWN);
    const numeric = columns.map((_, i) => shown.length > 0 && shown.every((r) => !r[i] || isNumeric(r[i])));
    const ref = useRef<HTMLDivElement>(null);
    const { editor } = this;
    // The estimate is close; the rendered height is the truth.
    useLayoutEffect(() => {
      const el = ref.current;
      if (!el) return;
      const sync = () => {
        const h = Math.ceil(el.scrollHeight);
        const now = editor.getShape<DataTableShape>(shape.id);
        if (!h || !el.offsetParent || !now || Math.abs(now.props.h - h) < 1) return;
        editor.run(() => editor.updateShape<DataTableShape>({ id: shape.id, type: "datatable", props: { h } }), { history: "ignore" });
      };
      sync();
      const observer = new ResizeObserver(sync);
      observer.observe(el);
      return () => observer.disconnect();
    }, [editor, shape.id, shape.props.h, columns, rows]);
    return (
      <HTMLContainer style={{ width: shape.props.w, height: shape.props.h }}>
        <div className="source-table-wrap">
          <div ref={ref} className="source-table">
            {title && <div className="source-table-title">{title}</div>}
            <table>
              <colgroup>
                {widths.map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {columns.map((c, i) => (
                    <th key={i} className={numeric[i] ? "num" : ""}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, y) => (
                  <tr key={y}>
                    {columns.map((_, i) => (
                      <td key={i} className={numeric[i] ? "num" : ""}>
                        {r[i] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length > shown.length && (
                  <tr>
                    <td colSpan={columns.length} className="more">
                      … {rows.length - shown.length} more rows, kept in this object
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </HTMLContainer>
    );
  }
  override getIndicatorPath(shape: DataTableShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 8);
    return path;
  }
}
