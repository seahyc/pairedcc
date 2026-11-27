import { prototypeEnabled } from "../prototype-flags";
import { useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  PageRecordType,
  T,
  createShapeId,
  toRichText,
  useEditor,
  useValue,
  type Editor,
  type RecordProps,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import { revision } from "../operations";
import { authorOf } from "../scratchbook";
import { nextRecall, recallOf, snoozeRecall } from "./recall";
import { commitResponse, hiddenBy, hideRefusal, learnInput, modeCopy, skipPrompt, type PromptProps, type PromptStatus } from "./model";

// PROTOTYPE learning prompt card. Objects with meta.revealAfter = <prompt id> stay
// hidden until the person commits an answer or skips. The shape is always registered
// so saved boards load; the button that creates one by hand is behind ?prototype=learning.

declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    prompt: PromptProps;
  }
}
export type PromptShape = TLShape<"prompt">;

export function learningPrototypeEnabled(search = typeof location === "undefined" ? "" : location.search) {
  return prototypeEnabled("learning", search);
}

function statusOf(editor: Editor) {
  return (id: string): PromptStatus | undefined => {
    const s = editor.getShape(id as TLShapeId);
    return s?.type === "prompt" ? (s as PromptShape).props.status : undefined;
  };
}

/** For <Tldraw getShapeVisibility>: hide results until their prompt is answered. */
export function learningVisibility(shape: TLShape, editor: Editor) {
  return hiddenBy(shape.meta, statusOf(editor)) ? "hidden" : "inherit";
}

export function waitingOn(editor: Editor, promptId: string) {
  return editor.getCurrentPageShapes().filter((s) => s.meta.revealAfter === promptId);
}

function answer(editor: Editor, shape: PromptShape, next: PromptProps) {
  editor.markHistoryStoppingPoint(next.status === "skipped" ? "skip prompt" : "commit prompt");
  editor.run(() => {
    editor.updateShape<PromptShape>({ id: shape.id, type: "prompt", props: next, meta: { ...shape.meta, answeredBy: "Human" } });
    // A settled thought the person checked themselves on comes back later for recall (spacing).
    const card = typeof shape.meta.check === "string" ? editor.getShape(shape.meta.check as TLShapeId) : undefined;
    if (!card || card.meta.settled !== true || authorOf(card) !== "Human") return;
    const previous = recallOf(card.meta), now = Date.now();
    const recall = next.status === "committed" ? nextRecall(previous, now) : previous ? snoozeRecall(previous, now) : undefined;
    if (!recall && !previous) return;
    const meta = { ...card.meta };
    if (recall) meta.recall = recall;
    else delete meta.recall;
    editor.store.update(card.id, (record) => ({ ...record, meta }));
  });
}

const checkCopy = { label: "Check me · explain it first", field: "From memory, in your own words", commit: "Show me the answer", committed: "You said" };

export class PromptShapeUtil extends BaseBoxShapeUtil<PromptShape> {
  static override type = "prompt" as const;
  static override props: RecordProps<PromptShape> = {
    w: T.number,
    h: T.number,
    mode: T.literalEnum("predict", "generate"),
    question: T.string,
    response: T.string,
    status: T.literalEnum("open", "committed", "skipped"),
  };
  override getDefaultProps(): PromptProps {
    return { w: 340, h: 250, mode: "predict", question: "What do you expect?", response: "", status: "open" };
  }
  override canEdit() {
    return false;
  }
  override component(shape: PromptShape) {
    return <PromptView shape={shape} />;
  }
  override getIndicatorPath(shape: PromptShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    return path;
  }
}

function PromptView({ shape }: { shape: PromptShape }) {
  const editor = useEditor();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const hidden = useValue("prompt hides", () => waitingOn(editor, shape.id).length, [editor, shape.id]);
  // A check the person asked for (Check me) is part of the default board, not the prototype.
  const check = typeof shape.meta.check === "string";
  // Checking a settled thought of the person's: it was covered, not put away.
  const ownThought = useValue("check on own thought", () => {
    const card = check ? editor.getShape(shape.meta.check as TLShapeId) : undefined;
    return Boolean(card && authorOf(card) === "Human");
  }, [editor, shape.meta.check]);
  const copy = check ? checkCopy : modeCopy[shape.props.mode];
  const { status } = shape.props;
  const stop = (e: React.PointerEvent | React.KeyboardEvent) => editor.markEventAsHandled(e);
  return (
    <HTMLContainer className={`learn-prompt is-${status}${check ? " is-check" : ""}`} data-prompt={shape.id} style={{ width: shape.props.w, height: shape.props.h }}>
      <div className="learn-kind">✦ {copy.label}{check ? "" : " · learning prototype"}</div>
      <p className="learn-question">{shape.props.question}</p>
      {status === "open" ? (
        <div className="learn-form" onPointerDown={stop}>
          <textarea
            aria-label={copy.field}
            placeholder={copy.field}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              stop(e);
              // Changed your mind before writing anything: Ctrl/⌘+Z takes the check back in one step.
              if (check && !draft && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
                e.preventDefault();
                editor.undo();
                editor.focus();
              }
            }}
          />
          {error && <span className="learn-error">{error}</span>}
          <div className="learn-actions">
            <button
              className="learn-commit"
              onClick={() => {
                try {
                  answer(editor, shape, commitResponse(shape.props, draft));
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Could not save");
                }
              }}
            >
              {copy.commit}
            </button>
            <button className="learn-skip" onClick={() => answer(editor, shape, skipPrompt(shape.props))}>
              Skip, show me
            </button>
          </div>
          {hidden > 0 && <span className="learn-hidden">{hidden === 1 ? "1 object is" : `${hidden} objects are`} waiting until you answer or skip</span>}
        </div>
      ) : status === "committed" ? (
        <div className="learn-answer">
          <span>{copy.committed}:</span>
          <p>{shape.props.response}</p>
          {check && <span className="learn-compare">{ownThought ? "Your thought is uncovered beside this: compare the two." : "The answer is back beside this: compare the two."}</span>}
        </div>
      ) : (
        <div className="learn-answer skipped">{check ? (ownThought ? "Skipped; your thought is uncovered beside this." : "Skipped; the answer is back beside this.") : "Skipped; shown directly."}</div>
      )}
    </HTMLContainer>
  );
}

/** Create a prompt and hide the given objects until it is answered, as one undo step. */
export function createPrompt(editor: Editor, value: unknown, actor: string, extraMeta: Record<string, unknown> = {}, height = 250) {
  const input = learnInput.parse(value);
  const shapes = input.hideIds.map((id) => {
    const s = editor.getCurrentPageShapes().find((s) => s.id === id);
    if (!s) throw new Error(`Object not found: ${id}`);
    const descendants = [...editor.getShapeAndDescendantIds([s.id])].filter((d) => d !== s.id).flatMap((d) => editor.getShape(d) ?? []);
    const refusal = hideRefusal(s, descendants);
    if (refusal) throw new Error(refusal);
    return s;
  });
  const id = createShapeId();
  editor.markHistoryStoppingPoint("learning prompt");
  editor.run(() => {
    editor.createShape<PromptShape>({
      id,
      type: "prompt",
      x: input.x,
      y: input.y,
      meta: { name: modeCopy[input.mode].label, revision: 0, createdBy: actor, learning: true, ...extraMeta },
      props: { w: input.width, h: height, mode: input.mode, question: input.question, response: "", status: "open" },
    });
    for (const s of shapes) editor.updateShape({ id: s.id, type: s.type, meta: { ...s.meta, revealAfter: id } });
    editor.deselect(...shapes.map((s) => s.id));
  });
  const prompt = editor.getShape(id) as PromptShape;
  return { id, revision: revision(prompt), mode: input.mode, status: prompt.props.status, hidden: shapes.map((s) => s.id) };
}

/** A "Learning prototype" page with one prompt of each kind over public, general-knowledge examples. */
export function createLearningPrototypePage(editor: Editor) {
  const page = PageRecordType.createId();
  editor.markHistoryStoppingPoint("learning prototype page");
  editor.createPage({ id: page, name: "Learning prototype" });
  editor.setCurrentPage(page);
  const card = (x: number, y: number, text: string, tone: "agent" | "heading" = "agent", w = 360) => {
    const id = createShapeId();
    editor.createShape({ id, type: "card", x, y, meta: { name: text.slice(0, 40), createdBy: "Paired" }, props: { w, richText: toRichText(text), tone } });
    return id;
  };
  card(0, -140, "Learning prototype (proposed): answer first, then see", "heading", 900);
  const result = card(0, 300, "About 2 seconds. With no air resistance, t = √(2h / g) = √(40 / 9.8) ≈ 2.0 s.");
  createPrompt(editor, { mode: "predict", question: "A ball is dropped from 20 m. Roughly how long until it hits the ground?", x: 0, y: 0, hideIds: [result] }, "Paired");
  const explanation = card(460, 300, "Ice floats because it is less dense than liquid water. Freezing locks the molecules into an open hexagonal lattice held by hydrogen bonds, so the same mass takes up about 9% more space.");
  createPrompt(editor, { mode: "generate", question: "Why does ice float on water? Explain it in your own words first.", x: 460, y: 0, hideIds: [explanation] }, "Paired");
  editor.selectNone();
  editor.zoomToFit();
  return page;
}
