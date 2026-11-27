import { clusters, type Placed } from "./clusters";

/**
 * P3, part 2: see the whole board and what is settled (finding 4: whose is what and what state
 * it is in; the opposite of finding 8: rough means unfinished, so settled means done). The
 * overview (O) shows the board's groups as labelled boxes, each with how many thoughts in it are
 * still open and how many are settled; pressing one flies there. Groups are the person's frames
 * and the piles they made (objects within reach of each other, as `canvas_overview` reports them
 * to agents); a lone object is a group of one.
 */
export type OverviewItem = Placed & {
  /** A frame is a group of its own, labelled by its name. */
  frame?: string;
  /** Text an object shows (clipped later), for the label; empty when it has none. */
  text: string;
  heading?: boolean;
  /** Counted when it holds text: open unless settled. */
  thought: boolean;
  settled: boolean;
  /** For a frame: how many thoughts inside it are open and settled. */
  inside?: { open: number; settled: number };
};
export type OverviewGroup = {
  id: string;
  label: string;
  bounds: { x: number; y: number; w: number; h: number };
  count: number;
  open: number;
  settled: number;
};

/** How many groups the overview draws; the rest are counted, never silently dropped. */
export const OVERVIEW_LIMIT = 40;
const clip = (text: string, max = 48) => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** A group's label: a frame's name; else its heading; else its first words in reading order. */
export function groupLabel(members: OverviewItem[]) {
  const frame = members.find((m) => m.frame !== undefined);
  if (frame) return clip(frame.frame || "Frame");
  const ordered = [...members].sort((a, b) => a.y - b.y || a.x - b.x);
  const named = ordered.find((m) => m.heading && m.text.trim()) ?? ordered.find((m) => m.text.trim());
  return named ? clip(named.text) : members.length === 1 ? "Untitled" : `${members.length} things`;
}

/** The board's groups, largest first, at most `limit`; `more` counts the groups left out; `open` and `settled` are the whole page's. */
export function boardGroups(items: OverviewItem[], limit = OVERVIEW_LIMIT): { groups: OverviewGroup[]; more: number; open: number; settled: number } {
  const frames = items.filter((i) => i.frame !== undefined);
  const loose = items.filter((i) => i.frame === undefined);
  const byId = new Map(items.map((i) => [i.id, i]));
  const piles = clusters(loose, 60, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const grouped = new Set(piles.flatMap((p) => p.ids));
  const memberSets = [
    ...frames.map((f) => [f]),
    ...piles.map((p) => p.ids.map((id) => byId.get(id)!)),
    ...loose.filter((i) => !grouped.has(i.id)).map((i) => [i]),
  ];
  const groups = memberSets.map((members): OverviewGroup => {
    const x = Math.min(...members.map((m) => m.x)), y = Math.min(...members.map((m) => m.y));
    const w = Math.max(...members.map((m) => m.x + m.w)) - x, h = Math.max(...members.map((m) => m.y + m.h)) - y;
    let open = 0, settled = 0;
    for (const m of members) {
      if (m.inside) {
        open += m.inside.open;
        settled += m.inside.settled;
      }
      if (!m.thought) continue;
      if (m.settled) settled++;
      else open++;
    }
    return { id: members[0].id, label: groupLabel(members), bounds: { x, y, w, h }, count: members.length, open, settled };
  });
  // Largest first (by thoughts, then objects), then left to right, so the cut keeps what matters.
  groups.sort((a, b) => b.open + b.settled - (a.open + a.settled) || b.count - a.count || a.bounds.x - b.bounds.x);
  // The page's totals count every group, including those past the limit that are not drawn.
  const open = groups.reduce((n, g) => n + g.open, 0), settled = groups.reduce((n, g) => n + g.settled, 0);
  return { groups: groups.slice(0, limit), more: Math.max(0, groups.length - limit), open, settled };
}

/** What a group's counts say, in words. */
export function countsLabel(open: number, settled: number) {
  if (!open && !settled) return "nothing written";
  return [open ? `${open} open` : "", settled ? `${settled} settled` : ""].filter(Boolean).join(" · ");
}

/**
 * Where each group's box goes on a map of the board `width` px wide (and about `height` tall),
 * keeping the board's shape. Boxes are at least `minW` × `minH` so a label fits; a box that would
 * then cover one placed before it moves down until it is clear, so no label hides another.
 */
export function mapLayout(groups: OverviewGroup[], width: number, height: number, pad = 12, minW = 0, minH = 0, gap = 6) {
  if (!groups.length) return [];
  const x0 = Math.min(...groups.map((g) => g.bounds.x)), y0 = Math.min(...groups.map((g) => g.bounds.y));
  const x1 = Math.max(...groups.map((g) => g.bounds.x + g.bounds.w)), y1 = Math.max(...groups.map((g) => g.bounds.y + g.bounds.h));
  const scale = Math.min((width - pad * 2 - minW) / Math.max(1, x1 - x0), (height - pad * 2 - minH) / Math.max(1, y1 - y0));
  const scaled = groups.map((g) => {
    const w = Math.max(minW, Math.round(g.bounds.w * scale)), h = Math.max(minH, Math.round(g.bounds.h * scale));
    const left = Math.min(width - pad - w, Math.round(pad + (g.bounds.x - x0) * scale));
    return { id: g.id, left: Math.max(pad, left), top: Math.round(pad + (g.bounds.y - y0) * scale), width: w, height: h };
  });
  // Top to bottom, then left to right: each box clears the ones already placed.
  const placed: typeof scaled = [];
  const hits = (a: (typeof scaled)[number], b: (typeof scaled)[number]) =>
    a.left < b.left + b.width + gap && b.left < a.left + a.width + gap && a.top < b.top + b.height + gap && b.top < a.top + a.height + gap;
  for (const box of [...scaled].sort((a, b) => a.top - b.top || a.left - b.left)) {
    for (let blocker = placed.find((p) => hits(box, p)); blocker; blocker = placed.find((p) => hits(box, p))) box.top = blocker.top + blocker.height + gap;
    placed.push(box);
  }
  return groups.map((g) => placed.find((p) => p.id === g.id)!);
}
