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

/** Leave the selection out of asks, or bring it back. One undo step. */
export function toggleLeftOut(editor: Editor, shapes: TLShape[]) {
  const targets = shapes.filter((s) => s.type !== "arrow");
  if (!targets.length) return;
  const out = nextLeftOut(targets.map((s) => s.meta));
  editor.markHistoryStoppingPoint(out ? "leave out" : "bring back");
  editor.run(() => {
    for (const s of targets) {
      const meta = { ...s.meta };
      if (out) meta.leftOut = true;
      else delete meta.leftOut;
      // updateShape merges metadata, so a removed key would survive; replace the record's meta instead.
      editor.store.update(s.id, (record) => ({ ...record, meta }));
    }
  });
}
