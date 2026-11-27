// P4: suggestions on the board, not in a box. When the person pauses on a selection of their own
// material, at most two faint suggestions are written under it. They are chosen by the same
// starters logic that once filled the question box (`startersFor`), never shown on an agent's
// work, never while typing, and never on top of anything on the board.
import { startersFor } from "./ask-rules";

/** How long a selection must stay still before suggestions are written under it. */
export const SUGGEST_PAUSE_MS = 1200;
/** Never more than two: one obvious next step, and one alternative. */
export const MAX_SUGGESTIONS = 2;

/** What the rules need to know of one selected object. */
export type Selected = {
  type: string;
  text: string;
  /** Made by the person (their writing, their import, their frame or chart). */
  byPerson: boolean;
  /** A first-board card the person has not written over. */
  untouchedSeed?: boolean;
  /** An ask, an answer, a comment, a caption or a learning prompt: part of a conversation already. */
  conversation?: boolean;
  /** Holds text (a card) but nothing is written in it yet. */
  blank?: boolean;
};

/**
 * The suggestions for a selection, or none. Only the person's own material gets them: one agent
 * object in the selection, a first-board card nobody wrote over, an empty card, or anything that
 * is already part of an ask or a comment, and nothing is suggested.
 */
export function suggestionsFor(selection: readonly Selected[], record = false): string[] {
  if (!selection.length) return [];
  if (selection.some((s) => !s.byPerson || s.untouchedSeed || s.conversation || s.blank)) return [];
  return startersFor(selection, record).slice(0, MAX_SUGGESTIONS);
}

export type Rect = { x: number; y: number; w: number; h: number };

/** Air kept between the suggestions and anything else on the board. */
export const SUGGEST_AIR = 10;
/** Gap from the selection's edge to the suggestions. */
export const SUGGEST_GAP = 14;
/** How far suggestions may slide down past something under the selection before trying beside it. */
const SLIDE = 3;
const STEP = 28;

const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Text size on screen, in px: legible whatever the zoom. */
export const SUGGEST_FONT = 19;
/** Line height on screen, in px; on a touch screen each line is a tap target. */
export const SUGGEST_LINE = 26;
export const SUGGEST_LINE_TOUCH = 34;
/** Page units per screen px: suggestions keep one size on screen at every zoom. */
export const suggestScale = (zoom: number) => 1 / (zoom > 0 ? zoom : 1);

/** The page-space size the suggestions take: one line each, in the board's handwriting. */
export function suggestSize(texts: readonly string[], opts: { scale?: number; touch?: boolean } = {}): { w: number; h: number } {
  const scale = opts.scale ?? 1, line = opts.touch ? SUGGEST_LINE_TOUCH : SUGGEST_LINE;
  const longest = Math.max(0, ...texts.map((t) => t.length + 2));
  return { w: Math.ceil(longest * SUGGEST_FONT * 0.5 + 24) * scale, h: (texts.length * line + 8) * scale };
}

/**
 * Where the suggestions go: under the selection, sliding down a little past something in the
 * way, then beside it on the right. `others` is everything else on the board (not the selection,
 * not a frame it sits in) and the window's own controls, in page units. With a `view`, a spot
 * must lie wholly inside it. Gaps are screen sizes times `scale`. Returns null when there is no
 * clear place nearby: then nothing is shown, because a suggestion must never cover anything.
 */
export function suggestSpot(
  selection: Rect,
  size: { w: number; h: number },
  others: readonly Rect[],
  opts: { under?: number; view?: Rect; scale?: number } = {},
): { x: number; y: number } | null {
  const scale = opts.scale ?? 1, air = SUGGEST_AIR * scale, gap = SUGGEST_GAP * scale, step = STEP * scale, view = opts.view;
  const clear = (x: number, y: number) => {
    if (view && (x < view.x || y < view.y || x + size.w > view.x + view.w || y + size.h > view.y + view.h)) return false;
    const box = { x: x - air, y: y - air, w: size.w + 2 * air, h: size.h + 2 * air };
    return !others.some((o) => hits(box, o));
  };
  const below = selection.y + selection.h + gap + (opts.under ?? 0);
  for (let i = 0; i <= SLIDE; i++) if (clear(selection.x, below + i * step)) return { x: selection.x, y: below + i * step };
  const right = selection.x + selection.w + gap;
  for (let i = 0; i <= SLIDE; i++) if (clear(right, selection.y + i * step)) return { x: right, y: selection.y + i * step };
  return null;
}

/** A key for "this selection, as it stands": suggestions are offered once per selection. */
export const selectionKey = (ids: readonly string[]) => [...ids].sort().join(",");
