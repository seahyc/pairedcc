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

export function bringContentIntoView(editor: Editor) {
  const objects = [...editor.getCurrentPageShapeIds()]
    .map((id) => editor.getShapePageBounds(id))
    .filter((b): b is NonNullable<typeof b> => !!b);
  if (!needsReframe(editor.getViewportPageBounds(), objects)) return false;
  const bounds = editor.getCurrentPageBounds();
  if (!bounds) return false;
  editor.zoomToBounds(bounds, { targetZoom: 1, inset: 32, animation: { duration: 0 } });
  return true;
}
