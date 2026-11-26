// Where a stale flag goes, given the object it marks and what part of the board is on screen.
// Pure, so it can be tested: the board passes the camera's viewport in page units and the zoom.

type Box = { x: number; y: number; w: number; h: number };

/** Screen pixels the selection bar takes above a selected object; an opened reason goes above it. */
export const SELECTION_BAR_ROOM = 52;

/** Screen pixels an opened reason needs: about five wrapped lines. */
export const FLAG_ROOM = 120;

export function flagLayout(object: Box, viewport: Box, zoom: number, open = false) {
  // The compact flag sits on the object's top edge, at its right end. When the object's top edge
  // is just above the view, the flag slides down (by its own height at most) to stay whole.
  const flagX = object.x + object.w;
  const flagY = Math.min(Math.max(object.y - 12, viewport.y + 4 / zoom), object.y + 8 / zoom);
  const below = (viewport.y + viewport.h - (object.y + object.h)) * zoom;
  const above = (object.y - viewport.y) * zoom - SELECTION_BAR_ROOM;
  const openBelow = below >= FLAG_ROOM || below >= above;
  // Tab eligibility follows the flag as drawn: opened, it starts at the object's left edge, under
  // or over the object; compact, it ends at the object's right edge.
  const across = open ? object.x < viewport.x + viewport.w && object.x + 420 > viewport.x : flagX > viewport.x && flagX <= viewport.x + viewport.w;
  const lineY = open ? (openBelow ? object.y + object.h + 8 : object.y - (8 + SELECTION_BAR_ROOM) / zoom) : flagY;
  const inView = across && (open && !openBelow ? lineY > viewport.y : lineY + 20 / zoom > viewport.y) && lineY < viewport.y + viewport.h;
  return {
    inView,
    flagY,
    // Selected: open under the object (clear of the selection bar), unless there is no room.
    openBelow,
    // Focused from the keyboard: grow upward from the flag's line, unless the top edge is near.
    growDown: above < FLAG_ROOM,
  };
}
