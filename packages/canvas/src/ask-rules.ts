// Rules for asks that need no editor, so they can be tested directly.

/** Cut an answer that runs long: one step, never a wall of text. */
export function capWords(text: string, max: number) {
  const words = text.trim().split(/\s+/);
  return words.length <= max ? text.trim() : `${words.slice(0, max).join(" ")}…`;
}

/**
 * The text of each answer card. Options are lettered; with dimensions, each option lists the
 * same dimensions in the same order under its headline (finding 6: compare down a line).
 */
export function answerTexts(input: { text?: string; alternatives?: string[]; dimensions?: string[]; values?: string[][] }) {
  if (!input.alternatives) return [capWords(input.text ?? "", 90)];
  return input.alternatives.map((text, i) => {
    // With dimensions each card is one line per field, so a field's own line breaks become spaces.
    const one = (t: string) => (input.dimensions ? t.replace(/\s+/g, " ").trim() : t);
    const head = `${"ABCD"[i]} · ${capWords(one(text), input.dimensions ? 30 : 60)}`;
    const lines = (input.dimensions ?? []).map((d, j) => `${one(d)}: ${capWords(one(input.values?.[i]?.[j] ?? ""), 12)}`);
    return [head, ...lines].join("\n");
  });
}

/**
 * An option card's rich text: its headline, `padLines` empty lines, then one paragraph per
 * dimension with the name in bold.
 */
export function optionRichText(text: string, dimensions: string[], padLines = 0) {
  const [head, ...lines] = text.split("\n");
  // An empty line is an empty paragraph: the editor refuses a text node with no text.
  const para = (content: { type: string; text: string; marks?: unknown[] }[]) => {
    const filled = content.filter((t) => t.text.length > 0);
    return filled.length ? { type: "paragraph", content: filled } : { type: "paragraph" };
  };
  return {
    type: "doc",
    content: [
      para([{ type: "text", text: head }]),
      // Empty lines under a short headline, so each dimension sits level with the other options'.
      ...Array.from({ length: padLines }, () => para([])),
      ...lines.map((line, j) => {
        const label = `${dimensions[j]}:`;
        return line.startsWith(label)
          ? para([{ type: "text", text: label, marks: [{ type: "bold" }] }, ...(line.length > label.length ? [{ type: "text", text: line.slice(label.length) }] : [])])
          : para([{ type: "text", text: line }]);
      }),
    ],
  };
}

export const ANSWER_W = 340;
export const OPTION_W = 250;
export const OPTION_GAP = 20;
/** Room under the ask for its status line. */
export const STATUS_ROOM = 46;

/** Narrowest an answer card gets on a small window. */
export const MIN_ANSWER_W = 200;
/** Screen room the canvas chrome takes beside an answer: the tool strip on the left, a margin on the right. */
export const ANSWER_CHROME = 104;

/**
 * How answers fit the room they land in (page units): a card narrows to the room on a phone,
 * and alternatives go as many to a row as fit, so none lands off screen.
 */
export function answerFit(count: number, available: number) {
  const multi = count > 1, full = multi ? OPTION_W : ANSWER_W;
  const w = Math.max(MIN_ANSWER_W, Math.min(full, Math.floor(available)));
  const perRow = multi ? Math.max(1, Math.min(count, Math.floor((available + OPTION_GAP) / (w + OPTION_GAP)))) : 1;
  return { w, perRow };
}

/**
 * Where answers go: under the ask, alternatives side by side so they can be compared, in as
 * many rows as the room (`available`, page units) needs.
 */
export function answerLayout(anchor: { x: number; y: number }, texts: string[], available = Infinity) {
  const count = texts.length, { w, perRow } = answerFit(count, available);
  const cards = Array.from({ length: count }, (_, i) => ({ dx: (i % perRow) * (w + OPTION_GAP), row: Math.floor(i / perRow), w }));
  // Roughly how tall each row's tallest card will be, so the answers are placed clear of what is below.
  const perLine = Math.max(12, Math.floor((w - 40) / 8.6));
  const tall = (t: string) => Math.max(Math.ceil(t.length / perLine) * 23 + 40, 70);
  const rows = Math.ceil(count / perRow);
  const heights = Array.from({ length: rows }, (_, r) => Math.max(...texts.slice(r * perRow, (r + 1) * perRow).map(tall)));
  const h = heights.reduce((sum, x) => sum + x, 0) + (rows - 1) * OPTION_GAP;
  const across = Math.min(count, perRow);
  return { box: { x: anchor.x, y: anchor.y + STATUS_ROOM, w: across * w + (across - 1) * OPTION_GAP, h }, cards };
}

/** A card that ends in a question mark is a question, and is sent as soon as it is written. */
export const isQuestion = (text: string) => /[?？]\s*$/.test(text.trim());

/** A sensible first question for what is selected: a question is answered, a thought is probed. */
export function suggestQuestion(selectedText: string) {
  return /\?\s*$/.test(selectedText.trim()) ? "Answer this" : "";
}

export const starters = ["What's missing?", "Give me alternatives", "Poke holes in this"];
/** An imported record is an argument to judge, so its first starter asks exactly that. */
export const recordStarters = ["Is this point valid?", "Is the defence enough?", "Poke holes in this"];

/** A whole word in any script: no letter, mark or digit right before or after it. */
const word = (alternatives: string) => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${alternatives})(?![\\p{L}\\p{M}\\p{N}])`, "iu");
/** Abstract nouns: a short thought made of them is a claim that needs an example. */
const ABSTRACT = word("\\p{L}+(?:ity|ness|ism|ance|ence)|quality|quantity|value|strategy|vision|culture|growth|freedom|focus");
const REASON = word("because|since|so|therefore|thus|hence");
const PROPOSAL = word("should|must|ought|need to|needs to|let['’]s");

/**
 * What one thought's own words invite, if anything (principles row 7, recognising beats
 * recalling; and row 5, concrete before abstract): a list, which matters most; a number, where it
 * comes from; a reason, the strongest objection; a proposal, what would make it wrong; a short
 * abstract claim, a concrete example. English cue words only: other text keeps the kind's starters.
 */
export function textCue(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const lines = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) return "Which of these matters most?";
  if (/\p{Nd}/u.test(t)) return "Where does this number come from?";
  if (REASON.test(t)) return "What's the strongest objection?";
  if (PROPOSAL.test(t)) return "What would make this wrong?";
  const words = t.split(/\s+/).length;
  if (words <= 6 && ABSTRACT.test(t)) return "Give me a concrete example";
  return undefined;
}

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
  // A chart's bars, filter and selection, and a dataset's columns and first rows, go with the ask.
  if (only.type === "chart") return ["What does this show?", "What stands out here?", "What could explain this?"];
  if (only.type === "dataset") return ["What is in this data?", "What would be worth charting?", "What looks odd here?"];
  if (/\?\s*$/.test(only.text.trim())) return ["Answer this", "What would change the answer?", "Give me alternatives"];
  // One thought: what its words invite comes first, then the usual next step.
  const cue = textCue(only.text);
  if (cue) return [cue, starters[0], starters[1]];
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
    return { tone: "done", text: `${ask.agent ?? "Agent"} answered in ${secs(ask.askedAt, ask.answeredAt ?? opts.now)}${opts.given ? ` · also read ${opts.given}` : ""}` };
  if (ask.state === "failed") return { tone: "failed", text: `No answer: ${ask.error ?? "something went wrong"}`, retry: true };
  if (ask.state === "working") {
    // An agent that says nothing for two minutes has stopped; offer the way out.
    if (opts.now - (ask.startedAt ?? ask.askedAt) > QUIET_MS) return { tone: "failed", text: `${ask.agent ?? "The agent"} went quiet.`, retry: true };
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

/** How recent an answer must be to count as landing now (a board loaded later is not "landing"). */
export const LANDING_MS = 5_000;

/**
 * Asks whose answer has just landed in this tab: answered, not seen answered before (the key
 * includes the answer time, so a retry's answer lands again), and answered within LANDING_MS.
 * Every key is added to `seen`.
 */
export function landedAnswers(asks: readonly { id: string; answeredAt?: number }[], seen: Set<string>, now: number) {
  const landed: string[] = [];
  for (const a of asks) {
    if (a.answeredAt === undefined) continue;
    const key = `${a.id}@${a.answeredAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (now - a.answeredAt <= LANDING_MS) landed.push(a.id);
  }
  return landed;
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
  if (after.state === "failed") return `Your ask ${asked} ${page} could not be answered. Show it to retry.`;
  return undefined;
}

/**
 * What Show selects on the ask's page: the answers to the ask (board order, hidden ones left
 * out), or the ask itself when it failed or its answers are gone, so Retry or the ask's status
 * is on the selection. Nothing for a state that is not an outcome.
 */
export function elsewhereShow(
  state: string,
  askId: string,
  shapes: { id: string; replyTo?: unknown; hidden?: boolean }[],
): string[] {
  if (state === "failed") return [askId];
  if (state !== "answered") return [];
  const answers = shapes.filter((s) => s.replyTo === askId && !s.hidden).map((s) => s.id);
  return answers.length ? answers : [askId];
}

/** How long a notice stays: long enough to read, and to press its button when it has one. */
export const noticeMs = (hasAction: boolean) => (hasAction ? 12000 : 3500);

/**
 * When a notice goes: never while the pointer is over it or focus is in it (the person is
 * reading it or about to press Show), and its full time again once they leave it.
 */
export const noticeDelay = (hasAction: boolean, held: boolean) => (held ? null : noticeMs(hasAction));

/** Gap kept between the selection bar and the window's edges. */
export const BAR_MARGIN = 8;
/** Left edge that keeps the bar clear of the tool strip, when the window has room for that. */
export const TOOLS_CLEAR = 70;
/** Height of the bar when its buttons fit on one row. */
export const BAR_ROW = 44;

/**
 * Where the selection bar (or the Ask box) goes, given its real width and the window's width:
 * at the selection's left edge, above it if there is room, never past either edge of the
 * window. On a phone it narrows to the window and may cover the tool strip rather than run off
 * screen, because a send button nobody can reach is worse than a strip hidden for a moment.
 */
export function placeBar(sel: { x: number; y: number; bottom: number }, barWidth: number, viewWidth: number, barHeight = BAR_ROW) {
  const width = Math.min(barWidth, viewWidth - 2 * BAR_MARGIN);
  const right = viewWidth - width - BAR_MARGIN;
  const minLeft = right >= TOOLS_CLEAR ? TOOLS_CLEAR : BAR_MARGIN;
  const left = Math.max(minLeft, Math.min(sel.x, right));
  // A bar whose buttons wrap to a second row (a phone) is taller: it is lifted by its real
  // height, so it never covers the top of what is selected.
  const lift = Math.max(BAR_ROW, barHeight) + 6;
  const top = sel.y - lift > 52 ? sel.y - lift : sel.bottom + 12;
  return { left, top, width };
}

/** An ask's state line wraps within its card's width (page units): readable, never a long strip. */
export function statusWidth(cardWidth: number) {
  return Math.min(640, Math.max(260, Math.round(cardWidth)));
}

/** Gap between an ask and an answer placed beside it. */
export const BESIDE_GAP = 40;
/** How far an answer may slide down from under its ask before beside is tried. */
export const ANSWER_SLIDE = 28;

/**
 * Under the ask, or beside it: an answer belongs next to its own ask. Under is the default; when
 * the space under the ask is taken (later asks stacked below it), the answer would slide down
 * past them and sit under someone else's question, so it goes beside its ask instead, unless
 * beside would slide further.
 */
export function pickAnswerSpot(underSlide: number, besideSlide: number): "under" | "beside" {
  return underSlide <= ANSWER_SLIDE || underSlide <= besideSlide ? "under" : "beside";
}

/**
 * What a screen reader is told when an ask's state changes, once per change: sent and
 * waiting, taken by an agent, answered (and where), or failed (and that Retry is there).
 * Undefined when nothing changed, so the ticking clock on the state line is never read out.
 */
export function askAnnouncement(
  previous: string | undefined,
  ask: { state: string; question?: string; agent?: string; note?: string; error?: string },
  answers: number,
): string | undefined {
  if (previous === ask.state) return undefined;
  const who = ask.agent ?? "An agent";
  switch (ask.state) {
    case "waiting":
      return `Asked “${ask.question ?? ""}”. Waiting for an agent.`;
    case "working":
      return `${ask.agent ?? "An agent"} is working on your ask${ask.note ? `: ${ask.note}` : ""}.`;
    case "answered":
      return `${who} answered${answers > 1 ? ` with ${answers} options` : ""}, under your ask.`;
    case "failed":
      return `Your ask failed${ask.error ? `: ${ask.error}` : ""}. Retry is under the ask.`;
    case "quiet":
      return `${who} went quiet. Retry is under the ask.`;
    default:
      return undefined;
  }
}

/** How long a working agent may say nothing before the ask is treated as gone quiet. */
export const QUIET_MS = 120_000;

/**
 * The state an announcement is about: the ask's own state, or "quiet" once a working agent has
 * said nothing past the timeout (its line then offers Retry, so that change is news too).
 */
export function announceState(ask: { state: string; askedAt: number; startedAt?: number }, now: number) {
  return ask.state === "working" && now - (ask.startedAt ?? ask.askedAt) > QUIET_MS ? "quiet" : ask.state;
}

/**
 * Text for a polite live region. The same words twice in a row would leave the region unchanged
 * and unspoken, so a repeat alternates a trailing no-break space that changes the text, not the words.
 */
export function liveText(previous: string, text: string) {
  return previous === text ? `${text}\u00a0` : text;
}

/**
 * How many cards the latest answer to an ask placed: one card, or two to four options. Cards an
 * answer places share its `answeredAt`, so an earlier clarifying question or round of options is
 * not counted with it. Cards from before that stamp are grouped by creation within two seconds.
 */
export function optionsInLatestRound(replies: { answeredAt?: number; at?: number; option?: unknown }[]) {
  if (!replies.length) return 0;
  const stamped = replies.filter((r) => typeof r.answeredAt === "number");
  if (stamped.length) {
    const latest = Math.max(...stamped.map((r) => r.answeredAt!));
    return stamped.filter((r) => r.answeredAt === latest).length;
  }
  const latest = Math.max(...replies.map((r) => r.at ?? 0));
  return replies.filter((r) => (r.at ?? 0) >= latest - 2000).length;
}

/**
 * What the selection bar's first button does for one selected ask: an ask that failed, went
 * quiet or was not heard is sent again (its state line offers the same), anything else is asked
 * about. Undefined: Ask as usual.
 */
export function retryLabel(line: { tone: string; retry?: boolean }): "Retry" | "Send again" | undefined {
  if (!line.retry) return undefined;
  return line.tone === "nobody" ? "Send again" : "Retry";
}

/**
 * An image or video as an ask gives it: the agent answers from text only, so it gets the file
 * name, size, caption and alt text the board holds, and is told plainly when there is none.
 */
export function describeImage(i: { kind: "image" | "video"; name?: string; w?: number; h?: number; caption?: string; alt?: string }) {
  const label = i.kind === "video" ? "Video" : "Image";
  const name = i.name?.trim(), caption = i.caption?.trim(), alt = i.alt?.trim();
  const size = i.w && i.h ? `${Math.round(i.w)}×${Math.round(i.h)} px` : "";
  if (!name && !caption && !alt) return size ? `${label}, ${size}.` : `${label} with no file name, caption or alt text: you cannot see it.`;
  const head = [`${label}${name ? ` "${name}"` : ""}`, size].filter(Boolean).join(", ");
  return [`${head}.`, caption ? `Caption: "${caption}".` : "", alt ? `Alt text: "${alt}".` : ""].filter(Boolean).join(" ");
}

type Rect = { x: number; y: number; maxX: number; maxY: number };
const union = (boxes: readonly Rect[]): Rect => ({
  x: Math.min(...boxes.map((b) => b.x)),
  y: Math.min(...boxes.map((b) => b.y)),
  maxX: Math.max(...boxes.map((b) => b.maxX)),
  maxY: Math.max(...boxes.map((b) => b.maxY)),
});
/**
 * What to bring into view when an answer lands: the ask with its answer, or, when the two are
 * taller than the room on screen, the answer alone, so the news is what is seen (its top first),
 * not the question the person already knows.
 */
export function landingBox(ask: Rect, answers: readonly Rect[], roomHeight: number): Rect {
  const both = union([ask, ...answers]);
  if (!answers.length || both.maxY - both.y <= roomHeight) return both;
  return union(answers);
}

/**
 * How many empty lines each option card needs under its headline so its first dimension line sits
 * level with the lowest one in its row. `offsets` are where each card's first dimension line starts
 * below the card's top, `rows` which row each card is in, and `line` one line's height, all in the
 * same units.
 */
export function levelPads(offsets: number[], rows: number[], line: number) {
  return offsets.map((o, i) => {
    const lowest = Math.max(...offsets.filter((_, j) => rows[j] === rows[i]));
    return line > 0 ? Math.max(0, Math.round((lowest - o) / line)) : 0;
  });
}
