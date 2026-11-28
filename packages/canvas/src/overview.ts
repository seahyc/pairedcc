import { isLeftOut } from "./leave-out";
import { foldedForAgent, foldedPick } from "./fold";
import { reviewDate } from "./learning/recall";
import { z } from "zod";
import type { Editor, TLShape, TLShapeId } from "tldraw";
import { cardStyle, revision, richTextPlain, shapeName } from "./operations";
import { chartLine } from "./data/agent";
import { authorOf, collectMarks } from "./scratchbook";
import { clusters } from "./clusters";
import { coveredThoughts } from "./learning/check-ui";
import { groupLabel, liftedFrame, type OverviewItem } from "./board-overview";

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

/**
 * A group's name as the overview (O) shows it: a frame's name, else a heading in it, else its first
 * words in reading order. One function for the person's overview and for agents.
 */
export function groupName(editor: Editor, shapes: readonly TLShape[]) {
  // A thought Check me is covering never names a group, as in O: the name would give it away.
  const covered = new Set<string>(coveredThoughts(editor).map((c) => c.id));
  const items = shapes.flatMap((s): OverviewItem[] => {
    const b = editor.getShapePageBounds(s);
    if (!b) return [];
    const text = "richText" in s.props && !covered.has(s.id) ? richTextPlain(s.props.richText).trim() : "";
    const base = { id: s.id, x: b.x, y: b.y, w: b.w, h: b.h, text, thought: Boolean(text), settled: false };
    if (s.type === "frame") return [{ ...base, text: "", thought: false, frame: String((s.props as { name?: unknown }).name ?? "") }];
    return [{ ...base, heading: s.type === "card" && (s.props as { tone?: unknown }).tone === "heading", ...(s.meta.ask ? { ask: true } : {}) }];
  });
  // The overview (O) draws a frame as a group of its own and names the loose pile beside it
  // separately; a cluster that holds both is named after the pile, as that box is. A pile with
  // nothing to be named by but a question (one lifted out of its frame, item 132) is the frame's.
  const loose = items.filter((i) => i.frame === undefined);
  const pileNamed = loose.some((i) => !i.ask && i.text.trim());
  if (!pileNamed) {
    // The frame a card in the pile was lifted out of, before any neighbouring frame.
    const own = shapes.flatMap((s) => (typeof s.meta.within === "string" ? items.filter((i) => i.frame !== undefined && i.id === s.meta.within) : []))[0];
    if (own) return groupLabel([own]);
  }
  return items.length ? groupLabel(pileNamed || loose.length === items.length ? loose : items) : undefined;
}

/**
 * The groups the person's overview (O) draws at this level, as agents get them: piles the person
 * made (edges within 60 px, chained) and, as a group of its own, a frame with any card lifted out
 * of it (#155). A frame is never in one cluster with a loose pile beside it: O shows them as two
 * boxes, so the agent's name and members match the person's map. Largest first.
 */
function levelGroups(editor: Editor, level: readonly TLShape[], byId: Map<string, TLShape>) {
  const frameIds = new Set(level.filter((s) => s.type === "frame").map((s) => s.id as string));
  // The frame at this level a card was lifted out of, by the rule O uses.
  const ownFrame = (s: TLShape) => liftedFrame(s.meta.within, frameIds, (id) => editor.getShape(id as TLShapeId)?.parentId);
  const box = (s: TLShape) => {
    const b = s.type === "arrow" ? undefined : editor.getShapePageBounds(s);
    return b ? [{ id: s.id as string, x: b.x, y: b.y, w: b.w, h: b.h }] : [];
  };
  const loose = level.filter((s) => s.type !== "frame" && !ownFrame(s));
  const piles = clusters(loose.flatMap(box)).map((c) => ({ ...c, label: groupName(editor, c.ids.flatMap((id) => byId.get(id) ?? [])) }));
  const lifted = level.filter((s) => s.type !== "frame" && ownFrame(s));
  const frames = [...frameIds].flatMap((frameId) => {
    const members = [byId.get(frameId)!, ...lifted.filter((s) => ownFrame(s) === frameId)];
    if (members.length < 2) return [];
    const boxes = members.flatMap(box);
    if (!boxes.length) return [];
    const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
    const w = Math.max(...boxes.map((b) => b.x + b.w)) - x, h = Math.max(...boxes.map((b) => b.y + b.h)) - y;
    return [{ ids: members.slice(0, 50).map((m) => m.id as string), count: members.length, bounds: { x: round(x), y: round(y), w: round(w), h: round(h) }, label: groupName(editor, members.slice(0, 1)) }];
  });
  return [...piles, ...frames].sort((p, q) => q.count - p.count || p.bounds.x - q.bounds.x).slice(0, 50);
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
  const byId = new Map(level.map((s) => [s.id as string, s]));
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
        // The person chose to keep it out of asks (the context prototype): do not use it to answer one.
        ...(isLeftOut(s.meta) ? { leftOut: true } : {}),
        // A finished thread folded to one line on the board (the question and the pick).
        ...(foldedForAgent(editor, s) ? { folded: true } : {}),
        // On a folded thread's ask: the answer the person picked, as the folded line shows it.
        ...(foldedPick(editor, s) ? { pick: foldedPick(editor, s) } : {}),
        // What would otherwise take a full read: the person's judgement, the card's style, settled, what a chart shows.
        ...(s.meta.mark === "picked" || s.meta.mark === "rejected" ? { mark: s.meta.mark } : {}),
        ...(s.type === "card" && cardStyle((s.props as { tone?: unknown }).tone) ? { style: cardStyle((s.props as { tone?: unknown }).tone) } : {}),
        ...(s.meta.settled === true ? { settled: true } : {}),
        // A settled thought the person checked themselves on comes back for review on this date.
        ...(reviewDate(s.meta, authorOf(s)) ? { review: reviewDate(s.meta, authorOf(s)) } : {}),
        ...(s.type === "chart" ? { chart: chartLine(editor, s) } : {}),
        ...(snippet(s) ? { text: snippet(s) } : {}),
      };
    }),
    clusters: levelGroups(editor, level, byId),
    ...(next < level.length ? { nextCursor: String(next) } : {}),
  };
}
