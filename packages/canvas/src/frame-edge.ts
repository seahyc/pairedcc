import type { Editor, TLShapeId } from "tldraw";

/**
 * Text never leaves its container, and a frame never hides the person's words. A card the person
 * wrote that lies across a frame's edge would be cut off by the frame (tldraw parents it into the
 * frame and masks what sticks out). Such a card is lifted onto the page where it is: same place
 * on screen, nothing cut off. Cards wholly inside a frame stay in it.
 */
type Box = { x: number; y: number; maxX: number; maxY: number };
export const wholly = (inner: Box, outer: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.maxX <= outer.maxX && inner.maxY <= outer.maxY;

/** Lift a card out of the frame that would cut it off. Returns true if it moved to the page. */
export function unclipFromFrame(editor: Editor, id: string) {
  const shape = editor.getShape(id as TLShapeId);
  if (!shape) return false;
  const parent = editor.getShape(shape.parentId as TLShapeId);
  if (!parent || parent.type !== "frame") return false;
  const box = editor.getShapePageBounds(shape), frame = editor.getShapePageBounds(parent);
  if (!box || !frame || wholly(box, frame)) return false;
  const pageId = editor.getAncestorPageId(shape);
  if (!pageId) return false;
  // Not a change the person made: it keeps their card where they put it, so it is off the undo stack.
  // It still belongs with the frame: `meta.within` makes it move when the frame moves.
  editor.run(() => {
    editor.reparentShapes([shape.id], pageId);
    const lifted = editor.getShape(shape.id)!;
    editor.updateShape({ id: lifted.id, type: lifted.type, meta: { ...lifted.meta, within: parent.id } });
  }, { history: "ignore" });
  return true;
}
