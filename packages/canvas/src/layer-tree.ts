// Groups the page's shapes (sorted bottom to top) by parent once, so the layers panel
// renders in linear time. Filtering every shape for every row was quadratic and made a
// 10k-object board take over half a minute to open.

export function layerTree<S extends { id: string; parentId: string }>(sorted: readonly S[]) {
  const byParent = new Map<string, S[]>();
  for (let i = sorted.length - 1; i >= 0; i--) {
    const s = sorted[i];
    const list = byParent.get(s.parentId);
    if (list) list.push(s);
    else byParent.set(s.parentId, [s]);
  }
  return {
    /** Children of a parent, top-most first. */
    childrenOf: (parentId: string): readonly S[] => byParent.get(parentId) ?? [],
    hasChildren: (id: string) => byParent.has(id),
  };
}
