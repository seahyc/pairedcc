import { useMemo } from "react";
import { useEditor, useValue, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { boardGroups, countsLabel, liftedFrame, mapLayout, type OverviewItem } from "./board-overview";
import { useDialogFocus } from "./focus-keys";
import { richTextPlain } from "./operations";
import { isSettled } from "./settled";
import { hiddenFromAgents } from "./fold";
import { coveredThoughts } from "./learning/check-ui";

const textOf = (s: TLShape) => ("richText" in s.props ? richTextPlain(s.props.richText as never).trim() : "");
const MAP_W = 760, MAP_H = 420, BOX_W = 132, BOX_H = 46;
/** The map's width: 760 px, or what the window leaves inside the dialog (a phone is 390 px wide). */
const mapWidth = () => Math.max(BOX_W + 24, Math.min(MAP_W, (typeof window === "undefined" ? MAP_W : window.innerWidth) - 24 - 50));

/** The open page as overview items: its top-level objects, a frame counting the thoughts inside it. */
export function overviewItems(editor: Editor): OverviewItem[] {
  const pageId = editor.getCurrentPageId();
  const thoughtsIn = (frame: TLShape) => {
    let open = 0, settled = 0;
    // A settled group (an imported record settled from the record stepper) settles what it holds.
    const walk = (parent: TLShape, settledAbove: boolean) => {
      for (const id of editor.getSortedChildIdsForParent(parent.id)) {
        const child = editor.getShape(id);
        // A folded thread is on the board as one line, so it counts here as it does on the page;
        // a result behind a learning prompt does not.
        if (!child || child.type === "arrow" || hiddenFromAgents(editor, child)) continue;
        const done = settledAbove || isSettled(child.meta);
        if (textOf(child)) {
          if (done) settled++;
          else open++;
        }
        walk(child, done);
      }
    };
    walk(frame, frame.type === "group" && isSettled(frame.meta));
    return { open, settled };
  };
  // A settled thought covered by an open Check me still counts, but never names a group: O would
  // give away what the person is recalling.
  const covered = new Set<string>(coveredThoughts(editor).map((c) => c.id));
  const words = (s: TLShape) => (covered.has(s.id) ? "" : textOf(s));
  const top = editor.getSortedChildIdsForParent(pageId);
  // A lifted card goes in the box of the page-level frame it belongs to, by the rule agents get.
  const frameIds = new Set<string>(top.filter((id) => editor.getShape(id)?.type === "frame"));
  const ownFrame = (s: TLShape) => liftedFrame(s.meta.within, frameIds, (id) => editor.getShape(id as TLShapeId)?.parentId);
  return top.flatMap((id): OverviewItem[] => {
    const s = editor.getShape(id);
    // A finished thread folded to one line is still on the board, so it counts; a result behind a
    // learning prompt does not.
    if (!s || s.type === "arrow" || hiddenFromAgents(editor, s)) return [];
    const b = editor.getShapePageBounds(s);
    if (!b) return [];
    const base = { id: s.id, x: b.x, y: b.y, w: b.w, h: b.h, text: words(s), thought: Boolean(textOf(s)), settled: isSettled(s.meta) };
    if (s.type === "frame") return [{ ...base, text: "", thought: false, frame: String((s.props as { name?: unknown }).name ?? ""), inside: thoughtsIn(s) }];
    // An imported record is a group of cards: its title counts once, the cards inside it are its thoughts.
    if (s.type === "group") {
      // Labelled by its first words (an imported record's title), in reading order.
      const first = editor.getSortedChildIdsForParent(s.id).flatMap((c) => editor.getShape(c) ?? []).filter((c) => !hiddenFromAgents(editor, c)).map((c) => ({ c, b: editor.getShapePageBounds(c) })).filter((x) => x.b && words(x.c)).sort((a, b) => a.b!.y - b.b!.y || a.b!.x - b.b!.x)[0];
      return [{ ...base, text: first ? words(first.c) : "", inside: thoughtsIn(s) }];
    }
    return [{ ...base, heading: s.type === "card" && (s.props as { tone?: unknown }).tone === "heading", ...(s.meta.ask ? { ask: true } : {}), ...(ownFrame(s) ? { within: ownFrame(s) } : {}) }];
  });
}

/**
 * The overview (O): the board's groups as labelled boxes laid out as they sit on the board, each
 * saying how many thoughts in it are open and how many settled. Press one to fly there.
 */
export function BoardOverview({ onClose }: { onClose: () => void }) {
  const editor = useEditor();
  const focus = useDialogFocus<HTMLElement>(onClose);
  // Read once when it opens: the overview is a look at the board, not a live panel.
  const items = useValue("overview items", () => overviewItems(editor), [editor]);
  const { groups, more, open, settled } = useMemo(() => boardGroups(items), [items]);
  const width = mapWidth(), height = Math.round(MAP_H * Math.min(1, width / MAP_W) + (width < MAP_W ? 120 : 0));
  const boxes = useMemo(() => new Map(mapLayout(groups, width, height, 12, BOX_W, BOX_H).map((b) => [b.id, b])), [groups, width, height]);
  const fly = (id: string) => {
    const g = groups.find((x) => x.id === id);
    onClose();
    if (!g) return;
    // Never zoom in past 100%: the group is shown whole, at most at its own size.
    const pad = 60;
    editor.zoomToBounds({ x: g.bounds.x - pad, y: g.bounds.y - pad, w: g.bounds.w + pad * 2, h: g.bounds.h + pad * 2 }, { targetZoom: 1, animation: { duration: 220 } });
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section {...focus} className="agent-dialog overview-dialog" role="dialog" aria-modal="true" aria-label="Overview of the board" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-heading">
          <h2>The whole board</h2>
          <span className="overview-total">{countsLabel(open, settled)}</span>
          <button type="button" className="subtle-button overview-close" onClick={onClose} aria-label="Close the overview">
            Esc
          </button>
        </div>
        {groups.length === 0 ? (
          <p className="overview-empty">Nothing on this page yet.</p>
        ) : (
          <div className="overview-map" style={{ width, height: Math.max(height, ...[...boxes.values()].map((b) => b.top + b.height + 12)) }} data-overview-map>
            {groups.map((g) => {
              const b = boxes.get(g.id)!;
              const done = g.settled > 0 && g.open === 0;
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`overview-group${done ? " settled" : ""}`}
                  data-overview-group={g.id}
                  style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
                  title={`Go to ${g.label}`}
                  onClick={() => fly(g.id)}
                >
                  <span className="overview-label">{g.label}</span>
                  <span className="overview-counts">{countsLabel(g.open, g.settled)}</span>
                </button>
              );
            })}
          </div>
        )}
        {more > 0 && <p className="overview-more">and {more} smaller {more === 1 ? "group" : "groups"} not shown</p>}
      </section>
    </div>
  );
}
