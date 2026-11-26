// Moving things is thinking (docs/canvas/principles.md, finding 2): what the person put next
// to what carries meaning. Clusters are objects at one level whose edges are within `gap`
// of a neighbour, linked in chains, so an agent can see the piles without screenshots.

export type Placed = { id: string; x: number; y: number; w: number; h: number };
/** `ids` lists at most `maxIds` members; `count` is how many the cluster holds. */
export type Cluster = { ids: string[]; count: number; bounds: { x: number; y: number; w: number; h: number } };

export function clusters(items: readonly Placed[], gap = 60, max = 50, maxIds = 50): Cluster[] {
  // Union-find, iterative with path compression and union by size: a long chain of
  // neighbours (a row of thousands) must not grow the call stack.
  const parent = items.map((_, i) => i), size = items.map(() => 1);
  const root = (i: number) => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) {
      const next = parent[i];
      parent[i] = r;
      i = next;
    }
    return r;
  };
  const join = (a: number, b: number) => {
    let ra = root(a), rb = root(b);
    if (ra === rb) return;
    if (size[ra] < size[rb]) [ra, rb] = [rb, ra];
    parent[rb] = ra;
    size[ra] += size[rb];
  };
  // Sweep by left edge: only objects starting within reach of this one's right edge can touch it.
  const order = items.map((_, i) => i).sort((a, b) => items[a].x - items[b].x);
  for (let k = 0; k < order.length; k++) {
    const a = items[order[k]];
    for (let m = k + 1; m < order.length; m++) {
      const b = items[order[m]];
      if (b.x > a.x + a.w + gap) break;
      const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
      if (dy <= gap) join(order[k], order[m]);
    }
  }
  const groups = new Map<number, number[]>();
  items.forEach((_, i) => {
    const r = root(i), group = groups.get(r);
    if (group) group.push(i);
    else groups.set(r, [i]);
  });
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const x = Math.min(...g.map((i) => items[i].x)), y = Math.min(...g.map((i) => items[i].y));
      const right = Math.max(...g.map((i) => items[i].x + items[i].w)), bottom = Math.max(...g.map((i) => items[i].y + items[i].h));
      // A pile of thousands must not turn the overview into a full-board dump.
      return { ids: g.slice(0, maxIds).map((i) => items[i].id), count: g.length, bounds: { x: Math.round(x), y: Math.round(y), w: Math.round(right - x), h: Math.round(bottom - y) } };
    })
    .sort((p, q) => q.count - p.count || p.bounds.x - q.bounds.x)
    .slice(0, max);
}
