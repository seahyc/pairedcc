import type { Editor, TLShape } from "tldraw";

// Solveit: "hidden messages are excluded from AI context". The person can leave an object out
// of what asks give an agent: a draft, an aside, something private. Setting the mark is the
// `context` prototype (?prototype=context); a mark already on a board is always honoured and
// always drawn, so nothing is ever sent that the person chose to keep back, and nothing is kept
// back without the board showing it.

type Meta = Record<string, unknown> | undefined;

/** Whether the person left this object out of what asks give an agent. */
export function isLeftOut(meta: Meta) {
  return meta?.leftOut === true;
}

/**
 * What an ask may give an agent from the candidates around it. An object the person selected
 * for this ask is always given: choosing it is choosing to share it. Everything else marked
 * left out is withheld, and counted so the ask can say so.
 */
export function keepForAgent<T extends { id: string; meta?: Meta }>(candidates: T[], selected: Iterable<string> = []) {
  const chosen = new Set(selected);
  const kept: T[] = [];
  const withheld = new Set<string>();
  for (const c of candidates) {
    if (isLeftOut(c.meta) && !chosen.has(c.id)) withheld.add(c.id);
    else kept.push(c);
  }
  return { kept, withheld };
}

/** "1 left out" / "3 left out", or nothing. */
export function leftOutLabel(count: number) {
  return count > 0 ? `${count} left out` : "";
}

/** Next state for a selection: leave all out, or bring all back when every one is already out. */
export function nextLeftOut(metas: Meta[]) {
  return !metas.every((m) => isLeftOut(m));
}

/**
 * Solveit's pinned context: the person can pin an object so every ask on its page gives it,
 * selected or not (a brief, a goal, a constraint). Like leaving out, setting the mark is the
 * `context` prototype, and a pin already on a board is always honoured and always drawn.
 */
export function isPinned(meta: Meta) {
  return meta?.pinned === true;
}

/** How many pinned objects one ask gives; the rest are counted, not sent. */
export const PIN_LIMIT = 6;

/**
 * What an ask gives as pinned context, from the objects on its page: pinned ones it does not
 * already give, never hidden ones or asks, never one also left out (withholding wins), in
 * reading order (top to bottom, then left to right).
 */
export function pinnedFor<T extends { id: string; x: number; y: number; meta?: Meta; hidden?: boolean; ask?: boolean }>(
  shapes: T[],
  given: Iterable<string> = [],
  limit = PIN_LIMIT,
) {
  const skip = new Set(given);
  const found = shapes
    .filter((s) => isPinned(s.meta) && !isLeftOut(s.meta) && !s.hidden && !s.ask && !skip.has(s.id))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return { pinned: found.slice(0, limit), more: Math.max(0, found.length - limit) };
}

/** "1 pinned" / "3 pinned", or nothing. */
export function pinnedLabel(count: number) {
  return count > 0 ? `${count} pinned` : "";
}

/** Next state for a selection: pin all, or unpin all when every one is already pinned. */
export function nextPinned(metas: Meta[]) {
  return !metas.every((m) => isPinned(m));
}

type ContextMark = "leftOut" | "pinned";

/** An object's metadata with one context mark set or cleared. The two marks exclude each other. */
export function contextMarkUpdate(meta: Record<string, unknown>, mark: ContextMark, on: boolean) {
  const next = { ...meta };
  delete next.leftOut;
  delete next.pinned;
  if (on) next[mark] = true;
  else if (mark === "leftOut" && meta.pinned === true) next.pinned = true;
  else if (mark === "pinned" && meta.leftOut === true) next.leftOut = true;
  return next;
}

function toggleContextMark(editor: Editor, shapes: TLShape[], mark: ContextMark) {
  const targets = shapes.filter((s) => s.type !== "arrow");
  if (!targets.length) return;
  const metas = targets.map((s) => s.meta);
  const on = mark === "leftOut" ? nextLeftOut(metas) : nextPinned(metas);
  editor.markHistoryStoppingPoint(mark === "leftOut" ? (on ? "leave out" : "bring back") : on ? "pin to asks" : "unpin");
  editor.run(() => {
    for (const s of targets) {
      const meta = contextMarkUpdate(s.meta, mark, on);
      // updateShape merges metadata, so a removed key would survive; replace the record's meta instead.
      editor.store.update(s.id, (record) => ({ ...record, meta: meta as typeof record.meta }));
    }
  });
}

/** Leave the selection out of asks, or bring it back. One undo step. */
export function toggleLeftOut(editor: Editor, shapes: TLShape[]) {
  toggleContextMark(editor, shapes, "leftOut");
}

/** Pin the selection into every ask on its page, or unpin it. One undo step. */
export function togglePinned(editor: Editor, shapes: TLShape[]) {
  toggleContextMark(editor, shapes, "pinned");
}
