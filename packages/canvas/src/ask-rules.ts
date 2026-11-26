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

/** What an ask shows under itself, for each state. */
export function askStatusLine(
  ask: { state: string; agent?: string; note?: string; error?: string; read?: string; askedAt: number; startedAt?: number; answeredAt?: number },
  opts: { listeners: string[] | null; now: number; given: string },
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
  if (opts.listeners === null) return { tone: "waiting", text: "Waiting for your agent to read the queue. Menu → Connect an agent." };
  if (!opts.listeners.length)
    return { tone: "nobody", text: "No agent is listening. Start one: pnpm --filter @pairedcc/canvas agent", retry: true };
  return { tone: "waiting", text: `Waiting for ${opts.listeners[0]} · ${secs(ask.askedAt, opts.now)}` };
}
