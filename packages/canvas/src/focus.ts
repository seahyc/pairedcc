import { atom, type Editor, type TLShape, type TLShapeId } from "tldraw";

/**
 * P1, few things in view (finding 1: working memory holds about four things). Select a frame or
 * a thread (an ask or one of its answers) and press F: everything else on the board dims until
 * Esc. Focus is a way of looking, not a change to the board: it is not saved, not undoable and
 * never moves anything. F with anything else selected (or nothing) stays the Frame tool.
 */
type Item = { id: string; type: string; ask: boolean; replyTo?: string };

/** What F would focus on for this selection: a frame, or the ask whose thread it is; else nothing. */
export function focusRoot(selected: Item[], byId: (id: string) => Item | undefined): string | undefined {
  if (!selected.length) return undefined;
  if (selected.length === 1 && selected[0].type === "frame") return selected[0].id;
  // Every selected object must belong to one thread: its ask, or an answer to that ask.
  const roots = new Set(
    selected.map((s) => {
      if (s.ask) return s.id;
      const parent = s.replyTo ? byId(s.replyTo) : undefined;
      return parent?.ask ? parent.id : "";
    }),
  );
  return roots.size === 1 && !roots.has("") ? [...roots][0] : undefined;
}

/** The ids a focus on this root keeps in view: the frame, or the ask with its answers. */
export function focusMembers(root: Item, all: Item[]): string[] {
  if (root.type === "frame") return [root.id];
  return [root.id, ...all.filter((s) => s.replyTo === root.id).map((s) => s.id)];
}

type Box = { x: number; y: number; maxX: number; maxY: number };
/** One rectangle around what is in focus, with a margin, so the rest can be dimmed around it. */
export function focusBox(boxes: Box[], margin = 24) {
  if (!boxes.length) return undefined;
  const x = Math.min(...boxes.map((b) => b.x)) - margin, y = Math.min(...boxes.map((b) => b.y)) - margin;
  return { x, y, w: Math.max(...boxes.map((b) => b.maxX)) + margin - x, h: Math.max(...boxes.map((b) => b.maxY)) + margin - y };
}

/** The root of the current focus (a frame or an ask), or null when the whole board is in view. */
export const focusAtom = atom<string | null>("canvas focus", null);

const item = (s: TLShape): Item => ({
  id: s.id,
  type: s.type,
  ask: Boolean(s.meta.ask && typeof s.meta.ask === "object"),
  replyTo: typeof s.meta.replyTo === "string" ? s.meta.replyTo : undefined,
});

/** What F would focus on in this editor now. */
export function focusable(editor: Editor) {
  return focusRoot(editor.getSelectedShapes().map(item), (id) => {
    const s = editor.getShape(id as TLShapeId);
    return s ? item(s) : undefined;
  });
}

/** Start focus on the selection's frame or thread. Returns false when there is nothing to focus. */
export function startFocus(editor: Editor) {
  const root = focusable(editor);
  if (!root) return false;
  focusAtom.set(root);
  return true;
}

export const endFocus = () => focusAtom.set(null);

/** The rectangle in focus on the open page, or undefined (no focus, or its root is gone). */
export function focusRect(editor: Editor) {
  const id = focusAtom.get();
  if (!id) return undefined;
  const root = editor.getShape(id as TLShapeId);
  if (!root || editor.getAncestorPageId(root) !== editor.getCurrentPageId()) return undefined;
  const members = focusMembers(item(root), editor.getCurrentPageShapes().map(item));
  return focusBox(members.flatMap((m) => editor.getShapePageBounds(m as TLShapeId) ?? []));
}
