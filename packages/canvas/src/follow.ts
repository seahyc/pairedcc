// Comments, agent notes and replies stay with what they are about: when the person moves an
// object, everything attached to it (meta.targetId, transitively) moves by the same amount.
// A comment about several objects stays put unless all of them move together (their frame or
// group was moved). Anything also being moved is left alone, and so is
// what hangs off it: its own move brings those, so nothing moves twice.

type Attached = { id: string; meta: Record<string, unknown> };

/** Set while an operation moves shapes and their followers itself, so the drag follower stays out. */
export const followPause = { active: false };

/** IDs that should move with `moved`, given the shapes on the page and what is being moved. */
export function followers(moved: readonly string[], shapes: readonly Attached[], movingAnyway: ReadonlySet<string>): string[] {
  const byTarget = new Map<string, string[]>();
  const out: string[] = [], seen = new Set(moved);
  const queue = [...moved];
  for (const s of shapes) {
    // A card lifted out of a frame so the frame would not cut it off still goes with that frame.
    const target = typeof s.meta.targetId === "string" ? s.meta.targetId : s.meta.within, many = s.meta.targetIds;
    if (typeof target !== "string") continue;
    if (Array.isArray(many) && many.length > 1) {
      // About several objects: it comes along only when one move carries every one of them.
      if (seen.has(s.id) || !many.every((id) => typeof id === "string" && moved.includes(id))) continue;
      seen.add(s.id);
      if (movingAnyway.has(s.id)) continue;
      queue.push(s.id);
      out.push(s.id);
      continue;
    }
    byTarget.set(target, [...(byTarget.get(target) ?? []), s.id]);
  }
  while (queue.length) {
    for (const id of byTarget.get(queue.shift()!) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      // Something moving anyway brings its own followers when its move is handled.
      if (movingAnyway.has(id)) continue;
      queue.push(id);
      out.push(id);
    }
  }
  return out;
}

type Shape = { id: string; type: string; x: number; y: number; isLocked?: boolean; meta: Record<string, unknown> };
export type Mover = {
  getShape(id: string): Shape | undefined;
  getShapeAndDescendantIds(ids: string[]): Set<string>;
  getCurrentPageShapes(): Shape[];
  updateShapes(partials: { id: string; type: string; x: number; y: number }[]): unknown;
};

/**
 * Move shapes by a program (side by side, show cited) with everything attached to them, as the
 * person's own drag would. Call with nothing selected, inside one undo step: the drag follower
 * only handles selected shapes, so this does it for shapes that are not.
 */
export function moveWithAttached(editor: Mover, moves: readonly { id: string; dx: number; dy: number }[]) {
  const moving = editor.getShapeAndDescendantIds(moves.map((m) => m.id));
  const shapes = editor.getCurrentPageShapes();
  const updates = new Map<string, { id: string; type: string; x: number; y: number }>();
  const shift = (id: string, dx: number, dy: number, force = false) => {
    const s = editor.getShape(id);
    if (!s || updates.has(id) || (!force && s.isLocked)) return;
    updates.set(id, { id: s.id, type: s.type, x: s.x + dx, y: s.y + dy });
  };
  for (const m of moves) {
    if (!m.dx && !m.dy) continue;
    shift(m.id, m.dx, m.dy, true);
    for (const id of followers([...editor.getShapeAndDescendantIds([m.id])], shapes, moving)) shift(id, m.dx, m.dy);
  }
  if (updates.size) editor.updateShapes([...updates.values()]);
}
