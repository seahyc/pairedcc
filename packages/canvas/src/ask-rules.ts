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
  // No group or chart starters yet: an ask about a frame does not send its children, and one
  // about a chart does not send its data, so those starters would promise what the agent lacks.
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

/** Gap kept between the selection bar and the window's edges. */
export const BAR_MARGIN = 8;
/** Left edge that keeps the bar clear of the tool strip, when the window has room for that. */
export const TOOLS_CLEAR = 70;

/**
 * Where the selection bar (or the Ask box) goes, given its real width and the window's width:
 * at the selection's left edge, above it if there is room, never past either edge of the
 * window. On a phone it narrows to the window and may cover the tool strip rather than run off
 * screen, because a send button nobody can reach is worse than a strip hidden for a moment.
 */
export function placeBar(sel: { x: number; y: number; bottom: number }, barWidth: number, viewWidth: number) {
  const width = Math.min(barWidth, viewWidth - 2 * BAR_MARGIN);
  const right = viewWidth - width - BAR_MARGIN;
  const minLeft = right >= TOOLS_CLEAR ? TOOLS_CLEAR : BAR_MARGIN;
  const left = Math.max(minLeft, Math.min(sel.x, right));
  const top = sel.y - 50 > 52 ? sel.y - 50 : sel.bottom + 12;
  return { left, top, width };
}

/** An ask's state line wraps within its card's width (page units): readable, never a long strip. */
export function statusWidth(cardWidth: number) {
  return Math.min(640, Math.max(260, Math.round(cardWidth)));
}
