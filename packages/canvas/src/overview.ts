import { z } from "zod";
import type { Editor, TLShape } from "tldraw";
import { revision, richTextPlain, shapeName } from "./operations";
import { authorOf, collectMarks } from "./scratchbook";

// Overview-then-detail: a compact, paginated listing of one level of the board, so an
// agent can find what matters and then canvas_read/canvas_get only those IDs.

export const overviewInput = z.object({
  parentId: z.string().optional().describe("List the children of this frame or group. Defaults to the page's top level."),
  limit: z.number().int().min(1).max(500).default(100),
  cursor: z.string().optional().describe("nextCursor from a previous overview call."),
});

const round = (n: number) => Math.round(n);
export const snippetLength = 80;

export function snippet(shape: TLShape) {
  if (!("richText" in shape.props)) return undefined;
  const text = richTextPlain(shape.props.richText).replace(/\s+/g, " ").trim();
  return text.length > snippetLength ? `${text.slice(0, snippetLength - 1)}…` : text || undefined;
}

export function overview(editor: Editor, value: unknown = {}) {
  const input = overviewInput.parse(value);
  const page = editor.getCurrentPage();
  const all = editor.getCurrentPageShapesSorted();
  const parentId = input.parentId ?? page.id;
  if (input.parentId && !all.some((s) => s.id === input.parentId)) throw new Error(`Object not found: ${input.parentId}`);
  const level = all.filter((s) => s.parentId === parentId);
  const start = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
  if (!Number.isInteger(start) || start < 0 || start > level.length) throw new Error("Invalid cursor");
  const slice = level.slice(start, start + input.limit);
  const childCount = new Map<string, number>();
  for (const s of all) childCount.set(s.parentId, (childCount.get(s.parentId) ?? 0) + 1);
  const byType: Record<string, number> = {};
  for (const s of all) byType[s.type] = (byType[s.type] ?? 0) + 1;
  const marks = collectMarks(editor);
  const next = start + slice.length;
  return {
    page: { id: page.id, name: page.name },
    pages: editor.getPages().map((p) => ({ id: p.id, name: p.name })),
    counts: { objects: all.length, byType, openMarks: marks.filter((m) => m.status === "open").length },
    selection: editor.getSelectedShapeIds(),
    parentId,
    total: level.length,
    objects: slice.map((s) => {
      const b = editor.getShapePageBounds(s);
      return {
        id: s.id,
        type: s.type,
        name: shapeName(s),
        author: authorOf(s),
        revision: revision(s),
        bounds: b ? { x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) } : undefined,
        ...(childCount.get(s.id) ? { children: childCount.get(s.id) } : {}),
        // A child of a locked frame is locked too: agents cannot change it.
        ...(editor.isShapeOrAncestorLocked(s) ? { locked: true } : {}),
        ...(snippet(s) ? { text: snippet(s) } : {}),
      };
    }),
    ...(next < level.length ? { nextCursor: String(next) } : {}),
  };
}
