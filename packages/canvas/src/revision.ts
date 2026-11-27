// Which changes the revision counter ignores. A revision guards against stale writes, so it
// must move only when someone changes an object, not when the canvas re-derives a value.


/** Fields derived by the canvas rather than set by anyone (revision counter, text-edit timestamp, the frame a lifted card goes with, the space that levels option cards' dimension lines, auto-sized card or table height). */
export function isDerivedField(type: unknown, path: string) {
  return path === "meta.revision" || path === "meta.updatedAt" || path === "meta.within" || path === "meta.levelPads" || ((type === "card" || type === "datatable") && path === "props.h");
}

/** True when two versions of a record differ only in derived fields. */
export function onlyDerivedChange(before: object, after: object) {
  const prev = before as Record<string, unknown>, next = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    if (prev[key] === next[key]) continue;
    if (key !== "props" && key !== "meta") return false;
    const a = (prev[key] ?? {}) as Record<string, unknown>, b = (next[key] ?? {}) as Record<string, unknown>;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (a[k] !== b[k] && !isDerivedField(next.type, `${key}.${k}`)) return false;
  }
  return true;
}
