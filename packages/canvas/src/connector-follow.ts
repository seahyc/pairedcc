import type { Editor, TLArrowBinding, TLShape, TLShapeId } from "tldraw";

// Connectors made by `connect` (agent connections, annotations, feedback) attach to the sides
// of their two objects that face each other. When either object moves or resizes, the
// connector re-picks those sides, so it never takes the long way round after a move.
// Connectors created with explicit anchors (meta.fixedAnchors) keep them.

export type Anchor = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

/** The facing sides of two boxes: top/bottom when mostly stacked, left/right otherwise. */
export function chooseAnchors(a: Box, b: Box): { start: Anchor; end: Anchor; vertical: boolean; dx: number; dy: number } {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2), dy = b.y + b.h / 2 - (a.y + a.h / 2);
  const vertical = Math.abs(dy) >= Math.abs(dx) * 0.6;
  return {
    start: vertical ? { x: 0.5, y: dy > 0 ? 1 : 0 } : { x: dx > 0 ? 1 : 0, y: 0.5 },
    end: vertical ? { x: 0.5, y: dy > 0 ? 0 : 1 } : { x: dx > 0 ? 0 : 1, y: 0.5 },
    vertical,
    dx,
    dy,
  };
}

/** The bend `connect` gives a connector between those sides. */
export function bendFor({ vertical, dx, dy }: { vertical: boolean; dx: number; dy: number }) {
  return Math.max(-60, Math.min(60, (vertical ? dx : -dy) * 0.12)) * (vertical ? (dy > 0 ? 1 : -1) : dx > 0 ? 1 : -1);
}

const same = (p: Anchor | undefined, q: Anchor) => !!p && p.x === q.x && p.y === q.y;

/** Re-pick the facing sides for one connector; returns whether anything changed. */
export function reanchor(editor: Editor, arrow: TLShape): boolean {
  if (arrow.type !== "arrow" || arrow.meta.fixedAnchors || typeof arrow.meta.fromId !== "string" || typeof arrow.meta.toId !== "string") return false;
  const from = editor.getShape(arrow.meta.fromId as TLShapeId), to = editor.getShape(arrow.meta.toId as TLShapeId);
  const a = from && editor.getShapePageBounds(from), b = to && editor.getShapePageBounds(to);
  if (!a || !b) return false;
  const want = chooseAnchors(a, b);
  const bindings = editor.getBindingsFromShape<TLArrowBinding>(arrow.id, "arrow");
  let changed = false;
  for (const binding of bindings) {
    const anchor = binding.props.terminal === "start" ? want.start : want.end;
    if (same(binding.props.normalizedAnchor, anchor)) continue;
    editor.updateBinding({ ...binding, props: { ...binding.props, normalizedAnchor: anchor } });
    changed = true;
  }
  if (changed && "bend" in arrow.props) editor.updateShape({ id: arrow.id, type: "arrow", props: { bend: bendFor(want) } });
  return changed;
}

/** Keep connectors on facing sides as objects move. Returns the unregister function. */
export function followConnectors(editor: Editor) {
  return editor.sideEffects.registerAfterChangeHandler("shape", (previous, next) => {
    if (next.type === "arrow") return;
    const moved = previous.x !== next.x || previous.y !== next.y || previous.rotation !== next.rotation || previous.parentId !== next.parentId ||
      (previous.props as { w?: number }).w !== (next.props as { w?: number }).w || (previous.props as { h?: number }).h !== (next.props as { h?: number }).h;
    if (!moved) return;
    for (const binding of editor.getBindingsToShape<TLArrowBinding>(next.id, "arrow")) {
      const arrow = editor.getShape(binding.fromId);
      if (arrow) reanchor(editor, arrow);
    }
  });
}
