import type { Editor } from "tldraw";

// A board saved on one screen and opened on another (board sync, a new tab, a phone) keeps
// its objects where the first screen's view was, so it can open on an empty view. When none
// of the page's objects is in view, frame them, never zooming in past 100%.

type Box = { x: number; y: number; w: number; h: number };

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** True when there are objects and not one of them is even partly in view. */
export function needsReframe(view: Box, objects: readonly Box[]) {
  return objects.length > 0 && !objects.some((o) => overlaps(o, view));
}

/**
 * The objects that decide whether a board is "in view": visible top-level ones. A frame stands
 * for its children (which it may clip), and a result hidden behind a learning prompt does not count.
 */
export function framingCandidates<S extends { parentId: string }>(shapes: readonly S[], pageId: string, isHidden: (s: S) => boolean) {
  return shapes.filter((s) => s.parentId === pageId && !isHidden(s));
}

/** Room the ✦ on an agent's heading or caption takes left of its card (style.css `.scratch-spark`). */
export const MARK_ROOM = 22;
/** Screen pixels kept between the board and each edge of the canvas, or the tool strip. */
export const EDGE_MARGIN = 16;

/** The tool strip's right and bottom edges, in screen pixels from the canvas's top-left corner. */
export type Strip = { right: number; bottom: number };

export function toolStrip(editor: Editor): Strip | undefined {
  if (typeof document === "undefined") return undefined;
  const strip = document.querySelector(".tool-strip")?.getBoundingClientRect();
  if (!strip || strip.width === 0) return undefined;
  const canvas = editor.getContainer().getBoundingClientRect();
  return { right: Math.max(0, strip.right - canvas.left), bottom: Math.max(0, strip.bottom - canvas.top) };
}

/**
 * The camera that shows `bounds` (page units) whole in the canvas (`screen`, pixels), clear of the
 * tool strip, with the ✦ marks left of the cards and a margin on every side, never past 100%.
 * The board goes right of the strip or below it, whichever shows it larger.
 * tldraw's camera: screen = (page + camera) * z.
 */
export function fitCamera(bounds: Box, screen: { w: number; h: number }, strip?: Strip) {
  const b = { x: bounds.x - MARK_ROOM, y: bounds.y, w: bounds.w + MARK_ROOM, h: bounds.h };
  const fit = (left: number, top: number) => {
    const room = { w: screen.w - left - EDGE_MARGIN, h: screen.h - top - EDGE_MARGIN };
    const z = Math.max(0.05, Math.min(1, room.w / b.w, room.h / b.h));
    // Centred in the room that is left over.
    const sx = left + (room.w - b.w * z) / 2, sy = top + (room.h - b.h * z) / 2;
    return { x: sx / z - b.x, y: sy / z - b.y, z };
  };
  const right = fit((strip?.right ?? 0) + EDGE_MARGIN, EDGE_MARGIN);
  if (!strip) return right;
  const below = fit(EDGE_MARGIN, strip.bottom + EDGE_MARGIN);
  return below.z > right.z ? below : right;
}

export function bringContentIntoView(editor: Editor) {
  const objects = framingCandidates(editor.getCurrentPageShapes(), editor.getCurrentPageId(), (s) => editor.isShapeHidden(s))
    .map((s) => editor.getShapePageBounds(s))
    .filter((b): b is NonNullable<typeof b> => !!b);
  if (!needsReframe(editor.getViewportPageBounds(), objects)) return false;
  const bounds = editor.getCurrentPageBounds();
  if (!bounds) return false;
  const screen = editor.getViewportScreenBounds();
  editor.setCamera(fitCamera(bounds, screen, toolStrip(editor)), { immediate: true });
  return true;
}
