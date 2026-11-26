// Rules for asks that need no editor, so they can be tested directly.

/** Cut an answer that runs long: one step, never a wall of text. */
export function capWords(text: string, max: number) {
  const words = text.trim().split(/\s+/);
  return words.length <= max ? text.trim() : `${words.slice(0, max).join(" ")}…`;
}

export const ANSWER_W = 340;
export const OPTION_W = 250;
export const OPTION_GAP = 20;
/** Room under the ask for its status line. */
export const STATUS_ROOM = 46;

/** Where answers go: under the ask, alternatives in one row so they can be compared. */
export function answerLayout(anchor: { x: number; y: number }, texts: string[]) {
  const count = texts.length, w = count > 1 ? OPTION_W : ANSWER_W;
  const cards = Array.from({ length: count }, (_, i) => ({ dx: i * (w + OPTION_GAP), w }));
  // Roughly how tall the tallest card will be, so the row is placed clear of what is below.
  const perLine = Math.max(12, Math.floor((w - 40) / 8.6));
  const h = Math.max(...texts.map((t) => Math.ceil(t.length / perLine) * 23 + 40), 70);
  return { box: { x: anchor.x, y: anchor.y + STATUS_ROOM, w: count * w + (count - 1) * OPTION_GAP, h }, cards };
}

/** A sensible first question for what is selected: a question is answered, a thought is probed. */
export function suggestQuestion(selectedText: string) {
  return /\?\s*$/.test(selectedText.trim()) ? "Answer this" : "";
}

export const starters = ["What's missing?", "Give me alternatives", "Poke holes in this"];
/** An imported record is an argument to judge, so its first starter asks exactly that. */
export const recordStarters = ["Is this point valid?", "Is the defence enough?", "Poke holes in this"];

/**
 * Starters chosen from what is selected, so the person recognises a next step rather than
 * recalling one. Several objects invite comparison on stated dimensions, not a verdict.
 */
export function startersFor(selection: readonly { type: string; text: string }[], record = false): string[] {
  if (record) return recordStarters;
  if (selection.length > 1) return ["Compare these", "What dimensions do these differ on?", "What do they have in common?"];
  const [only] = selection;
  if (!only) return starters;
  // A frame is what the person put together, and its contents are sent with the ask (`inside`).
  if (only.type === "frame") return ["What do these have in common?", "What is missing from this group?", "Which of these matters most?"];
  // No chart starters yet: an ask about a chart does not send its data, so they would promise
  // what the agent lacks.
  if (/\?\s*$/.test(only.text.trim())) return ["Answer this", "What would change the answer?", "Give me alternatives"];
  return starters;
}
/** How long an agent that acted on the tab counts as still connected. */
export const RECENT_MS = 10 * 60_000;

/** What an ask shows under itself, for each state. */
export function askStatusLine(
  ask: { state: string; agent?: string; note?: string; error?: string; read?: string; askedAt: number; startedAt?: number; answeredAt?: number },
  opts: {
    listeners: string[] | null;
    hosted?: boolean;
    now: number;
    given: string;
    /** The last agent that acted on this tab (any operation), if any. */
    recent?: { actor: string; at: number } | null;
  },
) {
  const secs = (from: number, to: number) => `${Math.max(1, Math.round((to - from) / 1000))}s`;
  if (ask.state === "answered")
    return { tone: "done", text: `${ask.agent ?? "Agent"} answered in ${secs(ask.askedAt, ask.answeredAt ?? opts.now)} · given ${opts.given}` };
  if (ask.state === "failed") return { tone: "failed", text: `No answer: ${ask.error ?? "something went wrong"}`, retry: true };
  if (ask.state === "working") {
    // An agent that says nothing for two minutes has stopped; offer the way out.
    if (opts.now - (ask.startedAt ?? ask.askedAt) > 120_000) return { tone: "failed", text: `${ask.agent ?? "The agent"} went quiet.`, retry: true };
    return { tone: "working", text: `${ask.agent ?? "Agent"}: ${ask.note ?? "thinking"} · ${secs(ask.startedAt ?? ask.askedAt, opts.now)}` };
  }
  // Nothing watches for asks, but an agent connected to this tab acted recently: it is there
  // and will answer when the person asks it in their own chat. Say that, not "no agent".
  const seen = !opts.listeners?.length && opts.recent && opts.now - opts.recent.at < RECENT_MS ? opts.recent : null;
  if (seen) {
    const ago = opts.now - seen.at < 60_000 ? secs(seen.at, opts.now) : `${Math.round((opts.now - seen.at) / 60_000)} min`;
    const text = `${seen.actor} was here ${ago} ago. In your chat, ask it to answer this.`;
    return opts.listeners === null ? { tone: "waiting", text } : { tone: "nobody", text, retry: true };
  }
  if (opts.listeners === null) return { tone: "waiting", text: "No agent is listening for this account. Connect yours to get an answer: Menu → Connect an agent." };
  if (!opts.listeners.length && opts.hosted)
    return { tone: "nobody", text: "No agent is listening right now. This ask is answered when one is back; or Menu → Connect an agent.", retry: true };
  if (!opts.listeners.length)
    return { tone: "nobody", text: "No agent is listening. Start one: pnpm --filter @pairedcc/canvas agent", retry: true };
  return { tone: "waiting", text: `Waiting for ${opts.listeners[0]} · ${secs(ask.askedAt, opts.now)}` };
}

/** The person's judgement on an object, as the board shows it: boxed (picked) or struck through (crossed out). */
export type AskMark = "picked" | "rejected";
export function markOf(meta: Record<string, unknown>): AskMark | undefined {
  return meta.mark === "picked" || meta.mark === "rejected" ? meta.mark : undefined;
}

export type HistoryEntry = { who: string; said: string; id?: string; mark?: AskMark };
/**
 * One thread from several selected answers: each earlier object once, in order, and none
 * that is already among the selected objects (those are given with their own marks).
 */
export function mergeHistory(entries: HistoryEntry[], targetIds: string[]) {
  const skip = new Set(targetIds), seen = new Set<string>();
  return entries.filter((e) => {
    if (e.id && skip.has(e.id)) return false;
    const key = e.id ?? `${e.who}\u0000${e.said}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * What to tell the person when an ask on a page they are not looking at is answered or fails:
 * the agent responded, so it must be seen (never silence). Nothing when the ask is on screen,
 * where its own status line says it, or when its state did not just change to an outcome.
 */
export function elsewhereNotice(
  before: { state: string } | undefined,
  after: { state: string; agent?: string } | undefined,
  where: { onScreen: boolean; question: string; pageName: string },
) {
  if (!after || where.onScreen || before?.state === after.state) return undefined;
  const asked = `“${where.question.length > 40 ? `${where.question.slice(0, 39)}…` : where.question}”`;
  const page = `on the page “${where.pageName}”`;
  if (after.state === "answered") return `✦ ${after.agent ?? "Your agent"} answered ${asked} ${page}.`;
  if (after.state === "failed") return `Your ask ${asked} ${page} could not be answered. Open that page to retry.`;
  return undefined;
}
