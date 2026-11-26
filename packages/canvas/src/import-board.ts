import { createShapeId, toRichText, type Editor, type TLRichText, type TLShape, type TLShapeId } from "tldraw";
import { z } from "zod";
import { atomic, connect } from "./agent-operations";
import { HUMAN } from "./scratchbook";
import { planImport, parseImport, summarise, type ImportAs, type ImportFormat, type ImportPlan } from "./import-parse";
import { sourceOf, type SourceMeta } from "./import-meta";
import { tableLayout } from "./table-shape";
import { planSideBySide, type RecordBox } from "./import-compare";
import { citationsOf, planCited, sectionKey, type SectionBox } from "./import-cite";

// Putting an import on the board. Everything made here is an ordinary object: it moves,
// can be edited, picked, crossed out, commented on and asked about. One import is one undo step.

type Box = { x: number; y: number; w: number; h: number };
export type ImportResult = {
  importId: string;
  kind: ImportPlan["kind"] | "image";
  summary: string;
  /** Records or sections in reading order: what the stepper walks through. */
  stepIds: string[];
  /** What to bring into view first: the heading and the first one or two records. */
  focus: Box;
};

const FIELD_W = [0, 560, 440, 350, 300];
const GAP = 16;
const RECORD_GAP = 84;
const PROSE_W = 520;
const COLUMN_H = 1500;

/** Bold column name on the first line, then the text. */
function labelled(label: string | undefined, text: string): TLRichText {
  const body = toRichText(text) as unknown as { type: string; content: Record<string, unknown>[] };
  if (!label) return body as unknown as TLRichText;
  const head = toRichText(label) as unknown as { content: { content?: Record<string, unknown>[] }[] };
  const first = { ...head.content[0], content: head.content[0].content?.map((node) => ({ ...node, marks: [{ type: "bold" }] })) };
  return { ...body, content: [first, ...(text ? body.content : [])] } as unknown as TLRichText;
}

const heightOf = (editor: Editor, id: TLShapeId) => (editor.getShape(id)?.props as { h?: number } | undefined)?.h ?? 0;
const chipRoom = (chips: { label: string }[]) => chips.reduce((w, c) => w + c.label.length * 7.4 + 30, chips.length ? 10 : 0);
const stamp = (at: number) => new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Clear board below everything already there, or the corner of the view on an empty board. */
function startPoint(editor: Editor) {
  const page = editor.getCurrentPageBounds(), view = editor.getViewportPageBounds();
  return page ? { x: Math.round(page.x), y: Math.round(page.maxY + 220) } : { x: Math.round(view.x + 140), y: Math.round(view.y + 140) };
}

export function placeImport(editor: Editor, plan: ImportPlan, origin: { from: string; at?: number }): ImportResult {
  const at = origin.at ?? Date.now(), importId = `import:${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const base = { importId, from: origin.from, at: new Date(at).toISOString() };
  const pageId = editor.getCurrentPageId();
  const fromLabel = origin.from === "pasted" ? "paste" : origin.from;
  const summary = summarise(plan, fromLabel);
  const card = (x: number, y: number, w: number, tone: "source" | "sourceTitle" | "sourceNote", richText: TLRichText, name: string, source: Omit<SourceMeta, "importId" | "from" | "at">) => {
    const id = createShapeId();
    editor.createShape({ id, type: "card", parentId: pageId, x, y, meta: { name: name.slice(0, 80), revision: 0, source: { ...base, ...source } }, props: { w, richText, tone } });
    return id;
  };
  editor.setCurrentTool("select");
  editor.selectNone();
  const start = startPoint(editor);
  return atomic(editor, "import", () => {
    const stepIds: TLShapeId[] = [];
    let focusBottom = start.y, width = PROSE_W;

    /** Heading, where it came from and (for records) the legend. Returns the y under it. */
    const header = (title: string | undefined, note: string, w: number, legend?: { column: string; chips: { label: string; level: number | null }[] } | null) => {
      let y = start.y;
      const ids: TLShapeId[] = [];
      if (title) {
        const id = card(start.x, y, w, "sourceTitle", toRichText(title), title, { kind: "header" });
        ids.push(id);
        y += heightOf(editor, id) + 6;
      }
      const noteId = card(start.x, y, Math.min(w, 760), "sourceNote", toRichText(note), "Imported from", { kind: "header" });
      ids.push(noteId);
      y += heightOf(editor, noteId) + 10;
      if (legend?.chips.length) {
        const text = `${legend.column}:`;
        const id = card(start.x, y, Math.round(text.length * 7.6 + 8), "sourceNote", toRichText(text), "Legend", { kind: "legend", chips: legend.chips });
        ids.push(id);
        y += heightOf(editor, id) + 10;
      }
      return y + 26;
    };

    if (plan.kind === "records") {
      const columns = Math.min(4, Math.max(1, ...plan.records.map((r) => r.fields.length)));
      const w = FIELD_W[columns], rowW = columns * w + (columns - 1) * GAP;
      width = rowW;
      const verdict = plan.verdictColumns.length
        ? `\n“${plan.verdictColumns.join("”, “")}” was empty in the source: pick (P), cross out (X) or comment (C) on a record instead.`
        : "";
      const count = `${plan.records.length} record${plan.records.length === 1 ? "" : "s"}`;
      let y = header(
        plan.title ?? (origin.from === "pasted" ? undefined : origin.from),
        `${plan.note ? `${plan.note}\n` : ""}${count} from ${fromLabel} · ${stamp(at)}${plan.sorted ? " · most severe first" : ""}${verdict}`,
        rowW,
        plan.legend,
      );
      plan.records.forEach((record, order) => {
        const top = y;
        const titleText = record.details ? `${record.title}\n${record.details}` : record.title;
        const titleId = card(start.x, y, Math.max(200, Math.round(rowW - chipRoom(record.chips))), "sourceTitle", toRichText(titleText), record.title, {
          kind: "title",
          row: record.row,
          values: record.values,
          chips: record.chips,
          level: record.level,
        });
        y += heightOf(editor, titleId) + 10;
        const ids = [titleId];
        for (let i = 0; i < record.fields.length; i += 4) {
          const row = record.fields.slice(i, i + 4).map((field, j) =>
            card(start.x + j * (w + GAP), y, w, "source", labelled(field.column, field.text), `${field.column} · ${record.title}`, {
              kind: "field",
              row: record.row,
              column: field.column,
              level: record.level,
            }),
          );
          ids.push(...row);
          y += Math.max(...row.map((id) => heightOf(editor, id))) + 12;
        }
        const record_ = { kind: "record" as const, order, row: record.row, values: record.values, level: record.level, verdictColumns: plan.verdictColumns };
        let stepId = titleId;
        if (ids.length > 1) {
          stepId = createShapeId();
          editor.groupShapes(ids, { groupId: stepId, select: false });
          editor.updateShape({ id: stepId, type: "group", meta: { name: record.title.slice(0, 80), revision: 0, source: { ...base, ...record_ } } });
        } else editor.updateShape({ id: titleId, type: "card", meta: { ...editor.getShape(titleId)!.meta, source: { ...base, ...record_, chips: record.chips } } });
        stepIds.push(stepId);
        // First view: the heading and the first record, and the second when it is close.
        if (order === 0 || (order === 1 && y - start.y < 760)) focusBottom = y;
        y = Math.max(y, top) + RECORD_GAP - 12;
      });
    } else if (plan.kind === "prose") {
      const count = `${plan.sections.length} section${plan.sections.length === 1 ? "" : "s"}`;
      const top = header(plan.title ?? (origin.from === "pasted" ? undefined : origin.from), `${count} from ${fromLabel} · ${stamp(at)} · in reading order`, PROSE_W);
      let x = start.x, y = top;
      plan.sections.forEach((section, order) => {
        const id = card(x, y, PROSE_W, "source", labelled(section.heading, section.text), section.heading ?? section.text.slice(0, 48), { kind: "section", order });
        stepIds.push(id);
        y += heightOf(editor, id) + GAP;
        if (x === start.x && y - start.y < 900) focusBottom = y;
        // A long document continues in the next column, still in reading order.
        if (y - top > COLUMN_H && order < plan.sections.length - 1) {
          x += PROSE_W + 48;
          y = top;
          width = x + PROSE_W - start.x;
        }
      });
    } else {
      const title = plan.table.title ?? (origin.from === "pasted" ? "" : origin.from);
      const layout = tableLayout(plan.table.columns, plan.table.rows, title);
      const id = createShapeId();
      editor.createShape({
        id,
        type: "datatable",
        parentId: pageId,
        x: start.x,
        y: start.y,
        meta: { name: title || "Table", revision: 0, source: { ...base, kind: "table" } },
        props: { w: layout.w, h: layout.h, title, columns: plan.table.columns, rows: plan.table.rows.slice(0, 2000) },
      });
      width = layout.w;
      focusBottom = start.y + Math.min(layout.h, 900);
    }
    return { importId, kind: plan.kind, summary, stepIds, focus: { x: start.x, y: start.y, w: width, h: Math.max(160, focusBottom - start.y) } };
  });
}

/** Bring a box into view, never closer than actual size, clear of the bars around the board. */
export function showBox(editor: Editor, box: Box) {
  editor.zoomToBounds({ x: box.x - 50, y: box.y - 100, w: box.w + 100, h: box.h + 170 }, { targetZoom: 1, inset: 30, animation: { duration: 220 } });
}

/** Every object of one import, on any page. */
export function importShapes(editor: Editor, importId: string) {
  return editor.store.allRecords().filter((r): r is TLShape => r.typeName === "shape" && sourceOf(r as TLShape)?.importId === importId);
}

export function removeImport(editor: Editor, importId: string) {
  const ids = importShapes(editor, importId).map((s) => s.id);
  if (!ids.length) return;
  editor.markHistoryStoppingPoint("remove import");
  editor.deleteShapes(ids);
}

/** Dropped or chosen pictures: placed by the canvas as images, then marked with where they came from. */
export async function importImages(editor: Editor, files: File[], point?: { x: number; y: number }): Promise<ImportResult> {
  const at = Date.now(), importId = `import:${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const before = new Set(editor.getCurrentPageShapeIds());
  const mark = editor.markHistoryStoppingPoint("import");
  await editor.putExternalContent({ type: "files", files, point: point ?? editor.getViewportPageBounds().center });
  const made = [...editor.getCurrentPageShapeIds()].filter((id) => !before.has(id)).flatMap((id) => editor.getShape(id) ?? []);
  if (!made.length) throw new Error("Could not import that image");
  made.forEach((shape, i) =>
    editor.updateShape({
      id: shape.id,
      type: shape.type,
      meta: { ...shape.meta, name: files[i]?.name ?? "Image", source: { importId, from: files[i]?.name ?? "pasted", at: new Date(at).toISOString(), kind: "image" } },
    }),
  );
  editor.squashToMark(mark);
  const boxes = made.flatMap((s) => editor.getShapePageBounds(s) ?? []);
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  const names = files.length === 1 ? files[0].name : `${files.length} files`;
  return {
    importId,
    kind: "image",
    summary: `${made.length} image${made.length === 1 ? "" : "s"} from ${names}`,
    stepIds: [],
    focus: { x, y, w: Math.max(...boxes.map((b) => b.maxX)) - x, h: Math.max(...boxes.map((b) => b.maxY)) - y },
  };
}

export const importInput = z.object({
  content: z.string().min(1).max(2_000_000).describe("The table or document as text: CSV, TSV, an HTML table, Markdown, a JSON array of objects, or plain prose."),
  format: z.enum(["auto", "csv", "tsv", "html", "markdown", "json", "text"]).default("auto").describe("auto works it out from the content; name the format for CSV with few columns."),
  name: z.string().min(1).max(120).optional().describe("Where it came from, recorded on every object and shown to the human: a file name or a short description."),
  as: z.enum(["auto", "cards", "table"]).default("auto").describe("auto: rows of prose become record cards, grids of numbers stay one table. Force either with cards or table."),
  focus: z.boolean().default(true).describe("Move the view to the first records."),
});

function autoFormat(content: string): ImportFormat {
  const head = content.trimStart();
  if (/^</.test(head) && /<table/i.test(head)) return "html";
  if (/^[[{]/.test(head)) {
    try {
      JSON.parse(content);
      return "json";
    } catch {
      // not JSON: read it as text
    }
  }
  return "text";
}

/** Parse, decide the shape and place it: the one importer behind paste, drop, the file chooser and agents. */
export function importContent(editor: Editor, value: { content: string; format?: ImportFormat | "auto"; from: string; as?: ImportAs }) {
  const format = !value.format || value.format === "auto" ? autoFormat(value.content) : value.format;
  const plan = planImport(parseImport(value.content, format), value.as ?? "auto");
  return { plan, result: placeImport(editor, plan, { from: value.from }) };
}

/** The agent operation: bring a table or document onto the board as source material. */
export function importForAgent(editor: Editor, value: unknown, actor: string) {
  const input = importInput.parse(value);
  const { plan, result } = importContent(editor, { content: input.content, format: input.format, as: input.as, from: input.name ?? `from ${actor}` });
  if (input.focus) showBox(editor, result.focus);
  return {
    importId: result.importId,
    kind: result.kind,
    summary: result.summary,
    ...(plan.kind === "records" ? { verdictColumns: plan.verdictColumns, sortedBySeverity: plan.sorted } : {}),
    objects: result.stepIds.map((id) => {
      const shape = editor.getShape(id as TLShapeId);
      return { id, name: typeof shape?.meta.name === "string" ? shape.meta.name : "", row: sourceOf(shape)?.row };
    }),
  };
}

/** The record an object belongs to: the record itself, or the record its title or field card sits in. */
export function recordOf(editor: Editor, shape: TLShape | undefined): TLShape | undefined {
  const kind = sourceOf(shape)?.kind;
  if (!shape || !kind) return undefined;
  if (kind === "record") return shape;
  if (kind !== "title" && kind !== "field") return undefined;
  const parent = editor.getShape(shape.parentId as TLShapeId);
  return sourceOf(parent)?.kind === "record" ? parent : undefined;
}

/** The distinct records the selection touches, in selection order. */
export function selectedRecords(editor: Editor): TLShape[] {
  const seen = new Map<string, TLShape>();
  for (const shape of editor.getSelectedShapes()) {
    const record = recordOf(editor, shape);
    if (record && !seen.has(record.id)) seen.set(record.id, record);
  }
  return [...seen.values()];
}

/**
 * Put two records of one import next to each other, the same columns lined up, as one undo
 * step; then select both and bring them into view. Returns why not when it cannot.
 */
export function sideBySide(editor: Editor, a: TLShape, b: TLShape): { ok: true } | { ok: false; reason: string } {
  const importId = sourceOf(a)?.importId;
  const boxes: RecordBox[] = editor.getCurrentPageShapes().flatMap((shape) => {
    const source = sourceOf(shape), bounds = editor.getShapePageBounds(shape);
    return source?.kind === "record" && bounds && source.importId === importId
      ? [{ id: shape.id, importId: source.importId, x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h }]
      : [];
  });
  if (sourceOf(b)?.importId !== importId) boxes.push({ id: b.id, importId: sourceOf(b)?.importId ?? "", x: 0, y: 0, w: 0, h: 0 });
  const plan = planSideBySide(boxes, a.id, b.id);
  if (!plan.ok) return plan;
  const ids = [plan.upper, plan.lower] as TLShapeId[];
  // One step: the moves and the selection squash into a single undo entry.
  atomic(editor, "side by side", () => {
    for (const move of plan.moves) {
      const shape = editor.getShape(move.id as TLShapeId);
      if (shape) editor.updateShape({ id: shape.id, type: shape.type, x: shape.x + move.dx, y: shape.y + move.dy });
    }
    editor.select(...ids);
  });
  const box = editor.getSelectionPageBounds();
  if (box) showBox(editor, { x: box.x, y: box.y, w: box.w, h: box.h });
  return { ok: true };
}

/** Sections on this page whose heading starts with a code ("Q56. Fleet costs"), in reading order. */
function codedSections(editor: Editor): SectionBox[] {
  return editor
    .getCurrentPageShapes()
    .flatMap((shape) => {
      const source = sourceOf(shape), key = source?.kind === "section" ? sectionKey(String(shape.meta.name ?? "")) : undefined;
      const bounds = key ? editor.getShapePageBounds(shape) : undefined;
      return key && bounds && source ? [{ id: shape.id, key, x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, at: source.at, order: source.order ?? 0 }] : [];
    })
    .sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);
}

/** What a record cites, and which of those codes head a section on this page. */
export function citedBy(editor: Editor, record: TLShape): { codes: string[]; found: string[] } {
  const codes = citationsOf(sourceOf(record)?.values ?? {});
  if (!codes.length) return { codes, found: [] };
  const keys = new Set(codedSections(editor).map((s) => s.key));
  return { codes, found: codes.filter((code) => keys.has(code)) };
}

/**
 * Move the sections a record cites into one column beside it, each linked from the record's title
 * line by a reference arrow, as one undo step. Running it again re-gathers them without new arrows.
 */
export function bringCited(editor: Editor, record: TLShape): { ok: true; moved: number; missing: string[] } | { ok: false; reason: string } {
  const codes = citationsOf(sourceOf(record)?.values ?? {});
  const box = editor.getShapePageBounds(record);
  if (!codes.length || !box) return { ok: false, reason: "This record does not cite any section by code." };
  const obstacles = editor.getCurrentPageShapes().flatMap((shape) => {
    const b = shape.type === "arrow" || shape.parentId !== editor.getCurrentPageId() ? undefined : editor.getShapePageBounds(shape);
    return b ? [{ id: shape.id as string, x: b.x, y: b.y, w: b.w, h: b.h }] : [];
  });
  const plan = planCited({ id: record.id, x: box.x, y: box.y, w: box.w, h: box.h }, codes, codedSections(editor), obstacles);
  if (!plan.moves.length) return { ok: false, reason: `No section headed ${codes.join(", ")} is on this page. Import the document it cites first.` };
  // Arrows leave from the record's right edge (its first row's last card), so they run through
  // the clear gap to the sections and never across the record's own text.
  const children = record.type === "group" ? editor.getSortedChildIdsForParent(record.id).flatMap((id) => editor.getShape(id) ?? []) : [];
  const edge = (shape: TLShape) => editor.getShapePageBounds(shape);
  const firstRow = children.filter((s) => sourceOf(s)?.kind === "field").sort((a, b) => edge(a)!.y - edge(b)!.y || edge(b)!.maxX - edge(a)!.maxX);
  const title = firstRow[0] ?? children.find((s) => sourceOf(s)?.kind === "title") ?? record;
  const linked = new Set(
    editor
      .getCurrentPageShapes()
      .filter((s) => s.type === "arrow" && s.meta.fromId === title.id && s.meta.relation === "reference")
      .map((s) => String(s.meta.toId)),
  );
  atomic(editor, "bring cited sections", () => {
    for (const move of plan.moves) {
      const shape = editor.getShape(move.id as TLShapeId), now = shape && editor.getShapePageBounds(shape);
      if (shape && now) editor.updateShape({ id: shape.id, type: shape.type, x: shape.x + move.x - now.x, y: shape.y + move.y - now.y });
    }
    for (const move of plan.moves)
      if (!linked.has(move.id)) connect(editor, { fromId: title.id, toId: move.id, relation: "reference" }, HUMAN, { start: { x: 1, y: 0.5 }, end: { x: 0, y: 0.5 } });
    editor.select(record.id, ...plan.moves.map((m) => m.id as TLShapeId));
  });
  const all = editor.getSelectionPageBounds();
  if (all) showBox(editor, { x: all.x, y: all.y, w: all.w, h: all.h });
  return { ok: true, moved: plan.moves.length, missing: plan.missing };
}
