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

/** The page-space size two suggestions take: one line each, in the board's handwriting. */
export function suggestSize(texts: readonly string[], charWidth = 9.5, lineHeight = 30): { w: number; h: number } {
  const longest = Math.max(0, ...texts.map((t) => t.length + 2));
  return { w: Math.ceil(longest * charWidth + 24), h: texts.length * lineHeight + 8 };
}

/**
 * Where the suggestions go: under the selection, sliding down a little past something in the
 * way, then beside it on the right. `others` is everything else on the board (not the selection,
 * not a frame it sits in). Returns null when there is no clear place nearby: then nothing is
 * shown, because a suggestion must never cover the person's objects.
 */
export function suggestSpot(selection: Rect, size: { w: number; h: number }, others: readonly Rect[], under = 0): { x: number; y: number } | null {
  const clear = (x: number, y: number) => {
    const box = { x: x - SUGGEST_AIR, y: y - SUGGEST_AIR, w: size.w + 2 * SUGGEST_AIR, h: size.h + 2 * SUGGEST_AIR };
    return !others.some((o) => hits(box, o));
  };
  const below = selection.y + selection.h + SUGGEST_GAP + under;
  for (let i = 0; i <= SLIDE; i++) if (clear(selection.x, below + i * STEP)) return { x: selection.x, y: below + i * STEP };
  const right = selection.x + selection.w + SUGGEST_GAP;
  for (let i = 0; i <= SLIDE; i++) if (clear(right, selection.y + i * STEP)) return { x: right, y: selection.y + i * STEP };
  return null;
}

/** A key for "this selection, as it stands": suggestions are offered once per selection. */
export const selectionKey = (ids: readonly string[]) => [...ids].sort().join(",");
