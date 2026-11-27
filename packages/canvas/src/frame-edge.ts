import type { Editor, TLShapeId } from "tldraw";

/**
 * Text never leaves its container, and a frame never hides the person's words. A card the person
 * wrote that a frame would cut off (tldraw parents it into the frame and masks what sticks out)
 * is lifted onto the page where it is: same place on screen, nothing cut off. Cards wholly inside
 * their frames stay in them.
 */
type Box = { x: number; y: number; maxX: number; maxY: number };
type Point = { x: number; y: number };
export const wholly = (inner: Box, outer: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.maxX <= outer.maxX && inner.maxY <= outer.maxY;

/** Is the point inside the polygon (or on its edge)? Ray casting, with a little slack for edges. */
export function insidePolygon(p: Point, poly: readonly Point[], slack = 0.5) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    // On an edge counts as inside.
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    if (Math.abs(cross) / len <= slack && p.x >= Math.min(a.x, b.x) - slack && p.x <= Math.max(a.x, b.x) + slack && p.y >= Math.min(a.y, b.y) - slack && p.y <= Math.max(a.y, b.y) + slack) return true;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Would the clip (the intersection of every frame above it, as a polygon) cut off any corner? */
export function cutOff(corners: readonly Point[], clip: readonly Point[] | undefined) {
  return Boolean(clip && clip.length >= 3 && corners.some((c) => !insidePolygon(c, clip)));
}

/**
 * Lift a card out of the frames that would cut it off. Returns true if it moved to the page. It
 * is recorded with the step before it (no undo stop of its own), so undo and redo of the person's
 * writing bring the card back as they left it, never clipped.
 */
export function unclipFromFrame(editor: Editor, id: string) {
  const shape = editor.getShape(id as TLShapeId);
  if (!shape) return false;
  const frame = editor.findShapeAncestor(shape, (s) => s.type === "frame");
  if (!frame) return false;
  const corners = editor.getShapePageTransform(shape.id).applyToPoints(editor.getShapeGeometry(shape).bounds.corners);
  if (!cutOff(corners, editor.getShapeMask(shape.id))) return false;
  const pageId = editor.getAncestorPageId(shape);
  if (!pageId) return false;
  // It still belongs with its nearest frame: `meta.within` makes it move when the frame moves.
  editor.run(() => {
    editor.reparentShapes([shape.id], pageId);
    const lifted = editor.getShape(shape.id)!;
    editor.updateShape({ id: lifted.id, type: lifted.type, meta: { ...lifted.meta, within: frame.id } });
  });
  return true;
}
