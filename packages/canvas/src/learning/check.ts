// "Check me" (P5, finding 9: understanding needs effort). On an agent's answer the person can
// ask to be checked: the answer is put away behind a prompt that asks them to explain it from
// memory, in their own words (self-explanation, retrieval); when they commit or skip, the answer
// comes back beside what they wrote, so the two can be compared. Pure rules here; the board
// side is in check-ui.ts.

type Shapeish = { type: string; text: string; author: string; meta: Record<string, unknown> };
type Box = { x: number; y: number; w: number; h: number };

/** The prompt's size on the board: the learning prompt's width, with room for the quoted ask. */
export const CHECK_SIZE = { w: 340, h: 300 } as const;
const GAP = 24;

/**
 * What a check on this object would quote, or null when Check me does not apply: an agent's
 * answer to an ask, or a thought the person settled; with text, and not one already waiting
 * behind an open check.
 */
export function checkTarget(shape: Shapeish, askText: (id: string) => string | undefined, waiting: (promptId: string) => boolean = () => false) {
  if (shape.type !== "card" || !shape.text.trim()) return null;
  // A thought the person settled: they can check they can still say why (it is covered while
  // they answer, never hidden or taken away). Their writing that is still rough is not checked.
  if (shape.author === "Human") {
    if (shape.meta.settled !== true) return null;
    const cover = shape.meta.coveredBy;
    if (typeof cover === "string" && waiting(cover)) return null;
    return { question: "", settled: true as const };
  }
  const replyTo = shape.meta.replyTo;
  if (typeof replyTo !== "string") return null;
  const behind = shape.meta.revealAfter;
  if (typeof behind === "string" && waiting(behind)) return null;
  return { question: (askText(replyTo) ?? "").trim() };
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The prompt's wording: recall and explain before looking again. */
export function checkQuestion(question: string, settled = false) {
  if (settled) return "Before you look again: what did you settle on here, and why? Say it in your own words.";
  const q = question.trim();
  return q
    ? `Before you look again: what was the answer to “${clip(q, 90)}”, and why? Say it in your own words.`
    : "Before you look again: what did this answer say, and why? Say it in your own words.";
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where the prompt goes: beside the answer (right, then left, then under), top aligned, so that
 * once the answer is shown the two sit side by side. Never on top of anything else on the page;
 * if all three are taken, further right until clear.
 */
export function checkPlacement(answer: Box, others: readonly Box[]) {
  const air = (s: { x: number; y: number }): Box => ({ x: s.x - 8, y: s.y - 8, w: CHECK_SIZE.w + 16, h: CHECK_SIZE.h + 16 });
  const free = (s: { x: number; y: number }) => !others.some((o) => overlaps(air(s), o));
  const tries = [
    { x: answer.x + answer.w + GAP, y: answer.y },
    { x: answer.x - GAP - CHECK_SIZE.w, y: answer.y },
    { x: answer.x, y: answer.y + answer.h + GAP },
  ];
  const found = tries.find(free);
  if (found) return found;
  const spot = { ...tries[0] };
  for (let i = 0; i < 200 && !free(spot); i++) spot.x += 40;
  return spot;
}
