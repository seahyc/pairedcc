import type { Editor, TLShape } from "tldraw";

/**
 * Settled (finding 8's opposite: rough means unfinished, so settled means done). The person marks
 * a thought settled with S, and again to unsettle it. A settled card of theirs is shown in a clean
 * print style with a small check instead of rough handwriting; agents read it as `settled: true`.
 */
export const isSettled = (meta: Record<string, unknown>) => meta.settled === true;

/** What S does to a selection: settle all of it, unless all of it is already settled. */
export function settleAll(metas: Record<string, unknown>[]) {
  return !metas.every(isSettled);
}

/** Settle or unsettle the selection (connectors aside), as one undo step. */
export function toggleSettled(editor: Editor, shapes: TLShape[]) {
  const targets = shapes.filter((s) => s.type !== "arrow");
  if (!targets.length) return;
  const settle = settleAll(targets.map((s) => s.meta));
  editor.markHistoryStoppingPoint(settle ? "settle" : "unsettle");
  editor.run(() => {
    for (const s of targets) {
      const meta = { ...s.meta };
      if (settle) Object.assign(meta, { settled: true, settledAt: Date.now() });
      else {
        delete meta.settled;
        delete meta.settledAt;
      }
      // updateShape merges metadata, so a removed key would survive; replace the record's meta.
      editor.store.update(s.id, (record) => ({ ...record, meta }));
    }
  });
}
