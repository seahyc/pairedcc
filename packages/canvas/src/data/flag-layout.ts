// Where a stale flag goes, given the object it marks and what part of the board is on screen.
// Pure, so it can be tested: the board passes the camera's viewport in page units and the zoom.

type Box = { x: number; y: number; w: number; h: number };

/** Screen pixels the selection bar takes above a selected object; an opened reason goes above it. */
export const SELECTION_BAR_ROOM = 52;

/** Screen pixels an opened reason needs: about five wrapped lines. */
export const FLAG_ROOM = 120;

export function flagLayout(object: Box, viewport: Box, zoom: number) {
  // The compact flag sits on the object's top edge, at its right end.
  const flagX = object.x + object.w, flagY = object.y - 12;
  const inView = flagX > viewport.x && object.x < viewport.x + viewport.w && flagY + 20 / zoom > viewport.y && flagY < viewport.y + viewport.h;
  const below = (viewport.y + viewport.h - (object.y + object.h)) * zoom;
  const above = (object.y - viewport.y) * zoom - SELECTION_BAR_ROOM;
  return {
    inView,
    // Selected: open under the object (clear of the selection bar), unless there is no room.
    openBelow: below >= FLAG_ROOM || below >= above,
    // Focused from the keyboard: grow upward from the flag's line, unless the top edge is near.
    growDown: above < FLAG_ROOM,
  };
}
