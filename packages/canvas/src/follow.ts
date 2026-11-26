// Comments, agent notes and replies stay with what they are about: when the person moves an
// object, everything attached to it (meta.targetId, transitively) moves by the same amount.
// Comments about several objects stay put, and anything also being moved is left alone.

type Attached = { id: string; meta: Record<string, unknown> };

/** IDs that should move with `moved`, given the shapes on the page and what is being moved. */
export function followers(moved: readonly string[], shapes: readonly Attached[], movingAnyway: ReadonlySet<string>): string[] {
  const byTarget = new Map<string, string[]>();
  for (const s of shapes) {
    const target = s.meta.targetId, many = s.meta.targetIds;
    if (typeof target !== "string" || (Array.isArray(many) && many.length > 1)) continue;
    byTarget.set(target, [...(byTarget.get(target) ?? []), s.id]);
  }
  const out: string[] = [], seen = new Set(moved);
  const queue = [...moved];
  while (queue.length) {
    for (const id of byTarget.get(queue.shift()!) ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(id);
      if (!movingAnyway.has(id)) out.push(id);
    }
  }
  return out;
}
