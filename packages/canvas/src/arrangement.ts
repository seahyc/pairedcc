// Arrangement carries meaning (docs/canvas/principles.md, findings 2 and 3): what the person
// put next to what is part of what they mean. An ask is given the group (cluster) its card sits
// in, each member with where it sits in words, so an agent with no picture of the board can
// still read "these three belong together, and the question is under them".
import { clusters, type Placed } from "./clusters";

/** How many members of the ask's group are given; the rest are counted. */
export const CLUSTER_GIVE = 8;
/** Edges within this distance chain objects into one group (as the overview's clusters). */
export const CLUSTER_GAP = 60;

export type Relation = "left of" | "right of" | "above" | "under" | "overlapping";

/** Where `a` sits relative to `ref`: the side with the larger gap, vertical on a tie. */
export function relation(a: Placed, ref: Placed): Relation {
  const dx = Math.max(ref.x - (a.x + a.w), a.x - (ref.x + ref.w));
  const dy = Math.max(ref.y - (a.y + a.h), a.y - (ref.y + ref.h));
  if (dx < 0 && dy < 0) return "overlapping";
  if (dx > dy) return a.x + a.w <= ref.x ? "left of" : "right of";
  return a.y + a.h <= ref.y ? "above" : "under";
}

const distance = (a: Placed, b: Placed) => {
  const dx = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.hypot(dx, dy);
};

/**
 * The other members of the group `hostId` sits in, nearest first, each with its relation to
 * the host, leaving out `skip` (what the ask already gives). An ask written on empty space
 * inside a pile joins that pile, so it is about the pile: beside a member (within the group gap),
 * or anywhere inside the pile's bounds when it is in no group of its own.
 */
export function clusterAround(items: readonly Placed[], hostId: string, skip: ReadonlySet<string> = new Set(), limit = CLUSTER_GIVE) {
  const host = items.find((i) => i.id === hostId);
  if (!host) return { members: [], more: 0 };
  const all = clusters(items, CLUSTER_GAP, Infinity, Infinity);
  const mine = all.find((c) => c.ids.includes(hostId)) ?? enclosing(all, host);
  if (!mine) return { members: [], more: 0 };
  const byId = new Map(items.map((i) => [i.id, i]));
  const others = mine.ids
    .filter((id) => id !== hostId && !skip.has(id))
    .map((id) => byId.get(id)!)
    .sort((a, b) => distance(a, host) - distance(b, host) || a.x - b.x || a.y - b.y);
  return { members: others.slice(0, limit).map((o) => ({ id: o.id, relation: relation(o, host) })), more: Math.max(0, others.length - limit) };
}

/**
 * "About everything over here": the group whose bounds hold the middle of a question that is in no
 * group of its own (written on the empty space inside a ring of cards, say). Inside more than one
 * (a pile within a wider ring), the smallest, which is the one it is most inside.
 */
function enclosing<G extends { bounds: { x: number; y: number; w: number; h: number } }>(groups: readonly G[], host: Placed) {
  const cx = host.x + host.w / 2, cy = host.y + host.h / 2;
  return groups
    .filter(({ bounds: b }) => cx > b.x && cx < b.x + b.w && cy > b.y && cy < b.y + b.h)
    .sort((a, b) => a.bounds.w * a.bounds.h - b.bounds.w * b.bounds.h)[0];
}
