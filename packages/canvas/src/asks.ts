import { type Editor, type TLShape, type TLShapeId } from "tldraw";
import { z } from "zod";
import { answerInput, askStates, askStatusInput, asksInput, type AskState } from "./protocol";
import { describeObject, revision, richTextPlain, shapeName } from "./operations";
import { HUMAN, authorOf, resolveMark } from "./scratchbook";
import { atomic, createCard, createComment, freeSpot } from "./agent-operations";
import { answerLayout, capWords, isQuestion } from "./ask-rules";
import { sourceAuthor, sourceOf, sourceText } from "./import-meta";

// An ask is the human's question to an agent, attached to what they selected. It is a
// pink card on the board (so it is in the feedback queue like any comment) that carries
// its own state: waiting, working, answered or failed. Nothing about it is hidden.

const askMeta = z.object({
  state: z.enum(askStates),
  attempt: z.number().int().nonnegative(),
  contextIds: z.array(z.string()),
  askedAt: z.number(),
  startedAt: z.number().optional(),
  answeredAt: z.number().optional(),
  agent: z.string().optional(),
  note: z.string().optional(),
  error: z.string().optional(),
  read: z.string().optional(),
  /** The words that were sent, when the ask is the person's own card: an edit after that is a new ask. */
  sent: z.string().optional(),
});
export type AskMeta = z.infer<typeof askMeta>;

export function askOf(shape: TLShape | undefined): AskMeta | undefined {
  const parsed = askMeta.safeParse(shape?.meta.ask);
  return parsed.success ? parsed.data : undefined;
}

const textOf = (s: TLShape) => ("richText" in s.props ? richTextPlain(s.props.richText).trim() : "");
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const frameOf = (editor: Editor, shape: TLShape) => editor.findShapeAncestor(shape, (s) => s.type === "frame");
const targetsOf = (shape: TLShape) =>
  Array.isArray(shape.meta.targetIds) ? shape.meta.targetIds.filter((id): id is string => typeof id === "string") : [];

function setAsk(editor: Editor, shape: TLShape, ask: AskMeta) {
  // The agent's progress is not the human's edit: keep it off their undo stack.
  // Board metadata must be plain JSON, so absent fields are left out rather than set to undefined.
  const clean = Object.fromEntries(Object.entries(ask).filter(([, value]) => value !== undefined));
  editor.run(() => editor.updateShape({ id: shape.id, type: shape.type, meta: { ...shape.meta, ask: clean } }), { history: "ignore" });
}

/** How close another object must be to count as "beside" what was written. */
const NEAR = 48;

/** What sits right beside a card: position carries meaning, so the agent is given it too. */
function beside(editor: Editor, host: TLShape, skip: Set<string>) {
  const box = editor.getShapePageBounds(host);
  if (!box) return [];
  const gap = (b: { x: number; y: number; maxX: number; maxY: number }) =>
    Math.max(0, b.x - box.maxX, box.x - b.maxX) + Math.max(0, b.y - box.maxY, box.y - b.maxY);
  return editor
    .getCurrentPageShapes()
    .filter((s) => !skip.has(s.id) && s.parentId === host.parentId && s.type !== "arrow" && s.type !== "frame" && !s.meta.seed && s.meta.replyTo !== host.id && textOf(s))
    .flatMap((s) => {
      const b = editor.getShapePageBounds(s);
      return b && gap(b) <= NEAR ? [{ s, d: gap(b) }] : [];
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, 4)
    .map((n) => n.s);
}

/**
 * The card is the question. Whatever the person wrote is sent as it stands, with the other
 * selected objects and what sits right beside it as context. No second card, no box.
 */
export function askDirect(editor: Editor, hostId: string, otherIds: string[] = []) {
  const host = editor.getShape(hostId as TLShapeId);
  const question = host ? textOf(host) : "";
  if (!host || !question) throw new Error("Write something first, then ask");
  const earlier = askOf(host);
  if (earlier && earlier.sent === question && (earlier.state === "waiting" || earlier.state === "working")) return host.id;
  const others = otherIds.flatMap((id) => editor.getShape(id as TLShapeId) ?? []).filter((s) => s.id !== host.id && s.type !== "arrow");
  // A card that already points at something (a comment, an ask written beside a selection) keeps its targets.
  const kept = targetsOf(host).flatMap((id) => editor.getShape(id as TLShapeId) ?? []);
  const skip = new Set<string>([host.id, ...others.map((s) => s.id), ...kept.map((s) => s.id)]);
  const targets = [...kept, ...others, ...beside(editor, host, skip)];
  const frame = frameOf(editor, host);
  const ask: AskMeta = {
    state: "waiting",
    attempt: earlier ? earlier.attempt + 1 : 0,
    contextIds: [...targets.map((t) => t.id), ...(frame ? [frame.id] : [])],
    askedAt: Date.now(),
    sent: question,
  };
  editor.run(
    () => editor.updateShape({ id: host.id, type: host.type, meta: { ...host.meta, targetIds: targets.map((t) => t.id), ask } }),
    { history: "ignore" },
  );
  return host.id;
}

/** True when a card the person just finished writing should go to the agent by itself. */
export function shouldSend(editor: Editor, shape: TLShape | undefined) {
  if (!shape || authorOf(shape) !== HUMAN) return false;
  const text = textOf(shape), ask = askOf(shape);
  if (!text) return false;
  if (ask) return ask.sent !== undefined && ask.sent !== text;
  return shape.meta.askWhenWritten === true || isQuestion(text);
}

/**
 * Asking about something the person did not write (an agent's answer, imported material):
 * a pink card opens beside it, already pointing at it. What is written there is sent when
 * the person finishes writing.
 */
export function createAsk(editor: Editor, value: { targetIds: string[] }) {
  const targets = value.targetIds.flatMap((id) => editor.getShape(id as TLShapeId) ?? []).filter((s) => s.type !== "arrow");
  if (!targets.length) throw new Error("Select what you mean first, then ask");
  return createComment(editor, { targetIds: targets.map((t) => t.id), text: "" }, { name: "Ask", askWhenWritten: true }) as TLShapeId;
}

/** Send a failed or stuck ask again. */
export function retryAsk(editor: Editor, id: string) {
  const shape = editor.getShape(id as TLShapeId), ask = askOf(shape);
  if (!shape || !ask) throw new Error("Not an ask");
  setAsk(editor, shape, { ...ask, state: "waiting", attempt: ask.attempt + 1, askedAt: Date.now(), startedAt: undefined, error: undefined, note: undefined });
  if (shape.meta.role === "annotation" && shape.meta.status === "resolved") resolveMark(editor, editor.getShape(shape.id)!, "open", HUMAN);
}

type Given = { id: string; type: string; author: string; text: string };
// Imported material is given with its column names and where it came from.
const given = (s: TLShape, max = 2000): Given => {
  const source = sourceOf(s);
  return { id: s.id, type: s.type, author: source ? sourceAuthor(source) : authorOf(s), text: clip(sourceText(s, textOf(s)) || textOf(s) || `(${shapeName(s)}, no text)`, max) };
};
/** A grouped record is given as its parts: the title line, then each field in column order. */
const parts = (editor: Editor, s: TLShape): TLShape[] => {
  if (s.type !== "group") return [s];
  const children = editor.getSortedChildIdsForParent(s.id).flatMap((id) => editor.getShape(id) ?? []).filter((c) => c.type !== "arrow");
  return children.length ? children.flatMap((c) => parts(editor, c)) : [s];
};

/** The exchange that led here, oldest first, when the human asks about an agent's answer. */
function thread(editor: Editor, shape: TLShape, depth = 0, seen = new Set<string>()): { who: string; said: string }[] {
  if (depth > 4 || seen.has(shape.id)) return [];
  seen.add(shape.id);
  const parent = typeof shape.meta.replyTo === "string" ? editor.getShape(shape.meta.replyTo as TLShapeId) : undefined;
  if (!parent || !askOf(parent)) return [];
  const about = targetsOf(parent).flatMap((id) => editor.getShape(id as TLShapeId) ?? []);
  const earlier = about.flatMap((t) => thread(editor, t, depth + 1, seen));
  return [
    ...earlier,
    ...about.map((t) => ({ who: authorOf(t), said: clip(textOf(t), 600) })),
    { who: `${HUMAN} asked`, said: clip(textOf(parent), 600) },
  ];
}

/** Everything an agent is given for one ask: exactly what the board shows as its context. */
export function describeAsk(editor: Editor, shape: TLShape) {
  const ask = askOf(shape);
  if (!ask) throw new Error("Not an ask");
  const page = editor.getPage(editor.getAncestorPageId(shape)!);
  const selected = targetsOf(shape).flatMap((id) => editor.getShape(id as TLShapeId) ?? []);
  const targets = selected.flatMap((s) => parts(editor, s));
  const frame = frameOf(editor, selected[0] ?? shape);
  const skip = new Set<string>([shape.id, ...targets.map((t) => t.id)]);
  return {
    id: shape.id,
    revision: revision(shape),
    question: textOf(shape),
    state: ask.state,
    attempt: ask.attempt,
    askedAt: new Date(ask.askedAt).toISOString(),
    ...(ask.agent ? { agent: ask.agent } : {}),
    ...(ask.note ? { note: ask.note } : {}),
    ...(ask.error ? { error: ask.error } : {}),
    pageId: page?.id,
    pageName: page?.name,
    targets: targets.map((t) => given(t)),
    history: targets.flatMap((t) => thread(editor, t)),
    ...(frame
      ? {
          frame: {
            id: frame.id,
            name: shapeName(frame),
            objects: editor
              .getSortedChildIdsForParent(frame.id)
              .flatMap((id) => editor.getShape(id) ?? [])
              .filter((s) => !skip.has(s.id) && s.type !== "arrow" && !askOf(s) && textOf(s))
              .slice(0, 12)
              .map((s) => given(s, 400)),
          },
        }
      : {}),
  };
}
export type AskView = ReturnType<typeof describeAsk>;

const allAsks = (editor: Editor) =>
  editor.store.allRecords().filter((r): r is TLShape => r.typeName === "shape" && Boolean(askOf(r as TLShape)));

/** Asks across every page, oldest first. */
export function listAsks(editor: Editor, value: unknown = {}) {
  const input = asksInput.parse(value);
  const asks = allAsks(editor)
    .filter((s) => input.state === "all" || askOf(s)!.state === input.state)
    .sort((a, b) => askOf(a)!.askedAt - askOf(b)!.askedAt)
    .map((s) => describeAsk(editor, s));
  return { asks };
}

function findAsk(editor: Editor, id: string) {
  const shape = editor.getShape(id as TLShapeId), ask = askOf(shape);
  if (!shape || !ask) throw new Error("Not an ask. Use ids from the asks operation.");
  return { shape, ask };
}

/** An agent says it has picked an ask up, could not answer it, or hands it back. */
export function setAskStatus(editor: Editor, value: unknown, actor: string) {
  const input = askStatusInput.parse(value), { shape, ask } = findAsk(editor, input.id);
  const state: AskState = input.state;
  setAsk(editor, shape, {
    ...ask,
    state,
    agent: actor,
    note: input.note,
    error: state === "failed" ? (input.error ?? "The agent could not answer") : undefined,
    startedAt: state === "working" ? Date.now() : ask.startedAt,
  });
  return describeAsk(editor, editor.getShape(shape.id)!);
}

/**
 * The agent's answer, placed under the ask: one short card, or two to four alternatives
 * side by side. The human's objects are never moved or edited.
 */
export function answerAsk(editor: Editor, value: unknown, actor: string) {
  const input = answerInput.parse(value), { shape, ask } = findAsk(editor, input.id);
  if (editor.getAncestorPageId(shape) !== editor.getCurrentPageId())
    throw new Error("That ask is on another page. Open its page, then retry.");
  const anchor = editor.getShapePageBounds(shape);
  if (!anchor) throw new Error("Ask has no bounds");
  const earlier = editor
    .getCurrentPageShapes()
    .filter((s) => s.meta.replyTo === shape.id)
    .flatMap((s) => editor.getShapePageBounds(s) ?? []);
  const bottom = Math.max(anchor.maxY, ...earlier.map((b) => b.maxY));
  const texts = input.alternatives
    ? input.alternatives.map((text, i) => `${"ABCD"[i]} · ${capWords(text, 60)}`)
    : [capWords(input.text ?? "", 90)];
  const layout = answerLayout({ x: anchor.x, y: bottom }, texts);
  const spot = freeSpot(editor, layout.box, new Set([shape.id]));
  const ids = atomic(editor, "answer", () => {
    const made = texts.map((text, i) =>
      createCard(editor, { x: spot.x + layout.cards[i].dx, y: spot.y, width: layout.cards[i].w, text }, actor, {
        name: input.alternatives ? `Option ${"ABCD"[i]}` : input.question ? "Question" : "Answer",
        role: "annotation",
        status: "open",
        author: actor,
        targetId: shape.id,
        replyTo: shape.id,
        ...(input.alternatives ? { option: "ABCD"[i] } : {}),
      }),
    );
    setAsk(editor, editor.getShape(shape.id)!, { ...ask, state: "answered", agent: actor, answeredAt: Date.now(), read: input.read, note: undefined, error: undefined });
    // A clarifying question hands the turn back, so the ask stays open.
    if (!input.question && shape.meta.role === "annotation" && shape.meta.status !== "resolved") resolveMark(editor, editor.getShape(shape.id)!, "resolved", actor);
    return made;
  });
  return { ask: describeAsk(editor, editor.getShape(shape.id)!), answers: ids.map((id) => describeObject(editor, id)) };
}
