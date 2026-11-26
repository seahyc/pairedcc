// Where a stale flag goes, given the object it marks and what part of the board is on screen.
// Pure, so it can be tested: the board passes the camera's viewport in page units, the zoom and
// the flag's text.
//
// The flag sits on the canvas layer, so it scales with the board: its size below is in page units
// (CSS pixels at 100%), and only the selection bar and the edge margin are in screen pixels.

type Box = { x: number; y: number; w: number; h: number };

/** Screen pixels the selection bar takes above a selected object; an opened reason goes above it. */
export const SELECTION_BAR_ROOM = 52;

/** Screen pixels an opened reason is assumed to need when its text is not known: about five lines. */
export const FLAG_ROOM = 120;

/** The flag's type, as drawn by `.stale-flag` in style.css: 11 px JetBrains Mono. */
export const FLAG_CHAR_W = 6.6;
export const FLAG_LINE_H = 14;
/** Padding and border across (7 + 1 on each side) and down (1 + 1 on each side). */
const PAD_X = 16, PAD_Y = 4;
export const FLAG_COMPACT_MAX_W = 320;
export const FLAG_OPEN_MAX_W = 420;
/** Screen pixels kept between a flag and the canvas edge. */
const EDGE = 4;

/** Lines a reason wraps to in the opened flag, by words as the browser does (an unbroken word runs on). */
function wrap(text: string, perLine: number) {
  let lines = 1, used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const need = used ? used + 1 + word.length : word.length;
    if (need <= perLine || !used) used = need;
    else { lines += 1; used = word.length; }
  }
  return { lines, chars: used };
}

/** The flag's drawn size in page units: one line when compact, the whole reason when open or focused. */
export function flagSize(text: string, open: boolean) {
  if (!open) return { w: Math.min(FLAG_COMPACT_MAX_W, text.length * FLAG_CHAR_W + PAD_X), h: FLAG_LINE_H + PAD_Y };
  const { lines, chars } = wrap(text, Math.floor((FLAG_OPEN_MAX_W - PAD_X) / FLAG_CHAR_W));
  // Its width is max-content up to the cap, so a reason that wraps takes the whole cap.
  return { w: lines > 1 ? FLAG_OPEN_MAX_W : Math.min(FLAG_OPEN_MAX_W, chars * FLAG_CHAR_W + PAD_X), h: lines * FLAG_LINE_H + PAD_Y };
}

/** Page units of `a` that lie inside `b` along one axis. */
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

export function flagLayout(object: Box, viewport: Box, zoom: number, open = false, text?: string) {
  const compact = text === undefined ? { w: FLAG_COMPACT_MAX_W, h: FLAG_LINE_H + PAD_Y } : flagSize(text, false);
  // Opened (selected) or focused, the whole reason shows. Without the text, assume FLAG_ROOM.
  const whole = text === undefined ? { w: FLAG_OPEN_MAX_W, h: FLAG_ROOM / zoom } : flagSize(text, true);
  const top = viewport.y + EDGE / zoom, bottom = viewport.y + viewport.h - EDGE / zoom;
  const left = viewport.x + EDGE / zoom, right = viewport.x + viewport.w - EDGE / zoom;

  // The compact flag sits on the object's top edge, at its right end. When the object's top edge
  // is just above the view, the flag slides down (by its own height at most) to stay whole.
  const flagX = object.x + object.w;
  const flagY = Math.min(Math.max(object.y - 12, top), object.y + 8 / zoom);

  // Selected: the reason opens under the object (clear of the selection bar above it), or above
  // it when only that side has room for the reason as drawn at this zoom.
  const below = (viewport.y + viewport.h - (object.y + object.h)) * zoom;
  const above = (object.y - viewport.y) * zoom - SELECTION_BAR_ROOM;
  const need = text === undefined ? FLAG_ROOM : (whole.h + 8) * zoom + EDGE;
  const openBelow = below >= need || (above < need && below >= above);
  const openY = openBelow ? object.y + object.h + 8 : object.y - (8 + SELECTION_BAR_ROOM) / zoom - whole.h;

  // Focused from the keyboard, a compact flag grows upward from its line, unless that would cross
  // the top of the view; then it grows down, from no higher than the top edge.
  const growDown = text === undefined ? above < FLAG_ROOM : flagY + compact.h - whole.h < top;
  const focusY = growDown ? Math.max(0, top - flagY) : 0;
  // It grows leftward from the object's right end, so keep it inside the left and right edges.
  const focusX = flagX - whole.w < left ? Math.min(left - (flagX - whole.w), Math.max(0, right - flagX)) : Math.min(0, right - flagX);

  // A Tab stop is a flag the person can see as drawn: half its width and half a line on screen.
  const drawn = open ? { x: object.x, y: openY, ...whole } : { x: flagX - compact.w, y: flagY, ...compact };
  const inView =
    overlap(drawn.x, drawn.x + drawn.w, viewport.x, viewport.x + viewport.w) >= drawn.w / 2 &&
    overlap(drawn.y, drawn.y + drawn.h, viewport.y, viewport.y + viewport.h) >= Math.min(drawn.h, FLAG_LINE_H) / 2;
  return { inView, flagY, openBelow, growDown, focusX, focusY };
}
