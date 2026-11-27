/**
 * The loop without a pointer: where a card written from the keyboard goes, and which object
 * Tab lands on first. Pure so the rules are tested without a browser.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GAP = 24;
const STEP = 40;

const clear = (a: Box, b: Box, gap: number) =>
  a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y;
const inside = (a: Box, view: Box) => a.x >= view.x && a.y >= view.y && a.x + a.w <= view.x + view.w && a.y + a.h <= view.y + view.h;

/**
 * Where N then Enter puts a new card: wholly in `view`, clear of every other object by a
 * gap, as close as possible to just under `near` (the object last selected) or else to the
 * middle of the view. With no clear room in view, the middle of the view.
 */
export function keyboardCardSpot(view: Box, others: Box[], size: { w: number; h: number }, near?: Box): { x: number; y: number } {
  const start = near
    ? { x: near.x, y: near.y + near.h + GAP }
    : { x: view.x + (view.w - size.w) / 2, y: view.y + (view.h - size.h) / 2 };
  const candidates: { x: number; y: number; d: number }[] = [];
  const reach = Math.ceil(Math.max(view.w, view.h) / STEP);
  for (let i = -reach; i <= reach; i++)
    for (let j = -reach; j <= reach; j++) {
      const x = start.x + i * STEP, y = start.y + j * STEP;
      // Prefer going down and right of the start, the way writing continues.
      const d = Math.hypot(i, j) + (j < 0 ? 0.5 : 0) + (i < 0 ? 0.25 : 0);
      candidates.push({ x, y, d });
    }
  candidates.sort((a, b) => a.d - b.d);
  for (const c of candidates) {
    const box = { x: c.x, y: c.y, w: size.w, h: size.h };
    if (inside(box, view) && others.every((o) => clear(box, o, GAP))) return { x: c.x, y: c.y };
  }
  return { x: view.x + (view.w - size.w) / 2, y: view.y + (view.h - size.h) / 2 };
}

/**
 * The first Tab stop when nothing is selected: the first object in reading order that is
 * wholly on screen, else the first partly on screen, else the first of all.
 */
export function firstTabStop<T extends { id: string; box: Box }>(list: T[], view: Box): string | undefined {
  const touches = (b: Box) => !clear(b, view, 0);
  return (list.find((o) => inside(o.box, view)) ?? list.find((o) => touches(o.box)) ?? list[0])?.id;
}

/** One selected object, as a screen reader needs it. */
export interface Stop {
  kind: "card" | "ask" | "answer" | "comment" | "other";
  /** For "answer": the agent asked a clarifying question back instead. */
  question?: boolean;
  /** Who made it: the person ("Human") or the agent's name. */
  author: string;
  human: boolean;
  text: string;
  /** For "other": the object's name, such as "Frame: Pricing". */
  name?: string;
  mark?: "picked" | "rejected";
  ask?: { state: string; agent?: string };
  index?: number;
  total?: number;
}

const SAY_MAX = 140;
const sentence = (text: string) => (/[.?!…]$/.test(text) ? text : `${text}.`);
function clipWords(text: string) {
  const plain = text.replace(/\s+/g, " ").trim();
  if (plain.length <= SAY_MAX) return plain;
  const cut = plain.slice(0, SAY_MAX);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), SAY_MAX / 2)).trimEnd()}…`;
}
const askState: Record<string, (agent?: string) => string> = {
  waiting: () => "Waiting for an agent.",
  working: (agent) => `${agent ?? "An agent"} is working on it.`,
  answered: (agent) => `Answered by ${agent ?? "an agent"}.`,
  failed: () => "It failed; Retry is under it.",
};

/**
 * What is said when one object is selected: who made it and what kind of thing it is, its
 * text, its state (an ask's progress, picked or crossed out) and its place in the Tab order.
 * Finding 4 for the ear: whose is what, and what state it is in.
 */
export function stopAnnouncement(stop: Stop): string {
  const body = clipWords(stop.text) || "(empty)";
  const lead =
    stop.kind === "ask" ? (stop.human ? "Your ask" : `Ask from ${stop.author}`)
    : stop.kind === "answer" ? `${stop.author} ${stop.question ? "asks back" : "answered"}`
    : stop.kind === "comment" ? (stop.human ? "Your comment" : `Note from ${stop.author}`)
    : stop.kind === "card" ? (stop.human ? "You wrote" : `${stop.author} wrote`)
    : undefined;
  const parts = [sentence(lead ? `${lead}: ${body}` : stop.name || body)];
  const state = stop.ask && askState[stop.ask.state];
  if (state) parts.push(state(stop.ask?.agent));
  if (stop.mark) parts.push(stop.mark === "picked" ? "Picked." : "Crossed out.");
  if (stop.index && stop.total) parts.push(`${stop.index} of ${stop.total}.`);
  return parts.join(" ");
}

/** What is said for a selection of several objects (one object is a `stopAnnouncement`). */
export function selectionAnnouncement(ids: string[]): string {
  return ids.length > 1 ? `${ids.length} objects selected.` : "";
}

/**
 * The Tab order with a folded thread's answers straight after its question. A folded thread is
 * open only while the person is on it, so reaching its answers by reading order (with something
 * else in between) would fold it away first; its answers are visited before moving on.
 */
export function keepThreadsTogether<T extends { id: string; replyTo?: string }>(stops: readonly T[], folded: (askId: string) => boolean): T[] {
  const replies = new Map<string, T[]>();
  for (const s of stops) if (s.replyTo && folded(s.replyTo)) replies.set(s.replyTo, [...(replies.get(s.replyTo) ?? []), s]);
  const moved = new Set([...replies.values()].flat().map((s) => s.id));
  return stops.flatMap((s) => (moved.has(s.id) ? [] : [s, ...(replies.get(s.id) ?? [])]));
}
