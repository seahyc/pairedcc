// Spaced return (P5, finding 9: understanding needs effort and repetition). A thought the person
// settled and then checked themselves on (Check me) comes back for recall after a day, then after
// several days, then after a week or more: one quiet line at the board's edge, never a modal.
// Nothing comes back on a board where the person never used Check me on a settled thought.
// Pure rules here; the board side is in recall-ui.tsx.

const DAY = 24 * 60 * 60 * 1000;
/** Days until each return, after the first check and after each recall since. */
export const RECALL_DAYS = [1, 3, 7, 21] as const;

export type Recall = { step: number; due: number };

export function recallOf(meta: Record<string, unknown>): Recall | undefined {
  const r = meta.recall as Partial<Recall> | undefined;
  return r && typeof r.step === "number" && typeof r.due === "number" ? { step: r.step, due: r.due } : undefined;
}

/**
 * After the person checks themselves on a settled thought: when it comes back next, or undefined
 * when it has come back enough (after the last spacing it is left alone).
 */
export function nextRecall(previous: Recall | undefined, now: number): Recall | undefined {
  const step = previous ? previous.step + 1 : 0;
  if (step >= RECALL_DAYS.length) return undefined;
  return { step, due: now + RECALL_DAYS[step] * DAY };
}

/** "Not now": the same step, back tomorrow. */
export function snoozeRecall(current: Recall, now: number): Recall {
  return { step: current.step, due: now + DAY };
}

type Candidate = { id: string; settled: boolean; text: string; meta: Record<string, unknown> };
/** The one thought to bring back now: still settled, with text, due, the most overdue first. */
export function dueRecall(items: readonly Candidate[], now: number) {
  let best: { id: string; text: string; recall: Recall } | undefined;
  for (const item of items) {
    const recall = recallOf(item.meta);
    if (!recall || !item.settled || !item.text.trim() || recall.due > now) continue;
    if (!best || recall.due < best.recall.due) best = { id: item.id, text: item.text, recall };
  }
  return best;
}

const clip = (text: string, max: number) => {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

/** How long ago, in words a person says. */
export function ago(then: number, now: number) {
  const days = Math.floor((now - then) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return `${Math.floor(days / 7)} weeks ago`;
}

/** The line's words: what to recall, and when it was last looked at. */
export function recallLine(text: string, recall: Recall, now: number) {
  const since = recall.due - RECALL_DAYS[Math.min(recall.step, RECALL_DAYS.length - 1)] * DAY;
  return `Recall “${clip(text, 60)}” (checked ${ago(since, now)}): can you still say why?`;
}
