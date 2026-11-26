import { useLayoutEffect, useRef } from "react";
import {
  BaseBoxShapeTool,
  BaseBoxShapeUtil,
  HTMLContainer,
  RichTextLabel,
  T,
  renderHtmlFromRichTextForMeasurement,
  richTextValidator,
  startEditingShapeWithRichText,
  toRichText,
  useValue,
  type Editor,
  type RecordProps,
  type TLRichText,
  type TLShape,
} from "tldraw";

import { sourceOf } from "./import-meta";

// A scratchbook card: the human's pink handwritten scrap or the agent's lavender note.
declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    card: { w: number; h: number; richText: TLRichText; tone: CardTone };
  }
}
// "source", "sourceTitle" and "sourceNote" are imported material: plain print on paper, neither the
// person's handwriting nor an agent's lavender.
export type CardTone = "human" | "agent" | "caption" | "heading" | "quote" | "code" | "source" | "sourceTitle" | "sourceNote";
export type CardShape = TLShape<"card">;

// Text classes. The human writes in a brush marker on pink scraps. Agents write in a
// casual print (Shantell Sans) and pick a style for what they are writing: a note, a
// heading, a quoted source in serif italic, or data and code in monospace.
const hand = "'Caveat Brush', cursive";
const casual = "'Shantell Sans', 'Comic Neue', sans-serif";
const serif = "Newsreader, Georgia, serif";
const mono = "'JetBrains Mono', ui-monospace, monospace";
const print = "Inter, system-ui, sans-serif";
export const cardType: Record<CardTone, { font: string; size: number; lineHeight: number; pad: number; weight: string; style: "normal" | "italic"; color: string }> = {
  human: { font: hand, size: 27, lineHeight: 1.22, pad: 18, weight: "400", style: "normal", color: "#a50f4d" },
  agent: { font: casual, size: 16, lineHeight: 1.45, pad: 16, weight: "400", style: "normal", color: "#22203a" },
  caption: { font: casual, size: 14, lineHeight: 1.35, pad: 0, weight: "400", style: "normal", color: "#55524c" },
  heading: { font: casual, size: 30, lineHeight: 1.15, pad: 0, weight: "700", style: "normal", color: "#3a2fd0" },
  quote: { font: serif, size: 19, lineHeight: 1.4, pad: 18, weight: "400", style: "italic", color: "#2b2940" },
  code: { font: mono, size: 13, lineHeight: 1.6, pad: 14, weight: "400", style: "normal", color: "#22203a" },
  source: { font: print, size: 15, lineHeight: 1.5, pad: 14, weight: "400", style: "normal", color: "#2c2d30" },
  sourceTitle: { font: print, size: 18, lineHeight: 1.3, pad: 0, weight: "600", style: "normal", color: "#2c2d30" },
  sourceNote: { font: print, size: 13, lineHeight: 1.5, pad: 0, weight: "400", style: "normal", color: "#6b675e" },
};
const unboxed = new Set<CardTone>(["caption", "heading", "sourceTitle", "sourceNote"]);

export class CardShapeUtil extends BaseBoxShapeUtil<CardShape> {
  static override type = "card" as const;
  static override props: RecordProps<CardShape> = {
    w: T.number,
    h: T.number,
    richText: richTextValidator,
    tone: T.literalEnum("human", "agent", "caption", "heading", "quote", "code", "source", "sourceTitle", "sourceNote"),
  };
  override canEdit() {
    return true;
  }
  override getDefaultProps(): CardShape["props"] {
    return { w: 300, h: 72, richText: toRichText(""), tone: "human" };
  }
  /** Grow height to fit the text, like a sticky note, so cards never clip. */
  fit(shape: CardShape): CardShape {
    const t = cardType[shape.props.tone];
    const html = renderHtmlFromRichTextForMeasurement(this.editor, shape.props.richText);
    const size = this.editor.textMeasure.measureHtml(html || "&nbsp;", {
      fontFamily: t.font,
      fontSize: t.size,
      lineHeight: t.lineHeight,
      fontStyle: t.style,
      fontWeight: t.weight,
      // The rendered label is a few px narrower than w - 2·pad (border, scrollbar gutter); measure narrower so wrapping matches.
      maxWidth: Math.max(40, shape.props.w - t.pad * 2 - 8),
      padding: "0px",
    });
    const h = Math.ceil(size.h + t.pad * 2 + (unboxed.has(shape.props.tone) ? 2 : 4));
    return h === shape.props.h ? shape : { ...shape, props: { ...shape.props, h } };
  }
  override onBeforeCreate(next: CardShape) {
    return this.fit(next);
  }
  override onBeforeUpdate(prev: CardShape, next: CardShape) {
    // Re-estimate only when the content or width changes; a height-only update is
    // the rendered-size correction from useAutoHeight and must stick.
    const p = prev.props, n = next.props;
    if (p.richText === n.richText && p.w === n.w && p.tone === n.tone) return next;
    return this.fit(next);
  }
  override component(shape: CardShape) {
    const t = cardType[shape.props.tone];
    const isSelected = useValue("card selected", () => this.editor.getOnlySelectedShapeId() === shape.id, [this.editor, shape.id]);
    const ref = useAutoHeight(this.editor, shape, t.pad * 2 + (unboxed.has(shape.props.tone) ? 2 : 4));
    // Imported material carries its tags (such as severity) as chips and a quiet edge.
    const source = sourceOf(shape), level = source?.level;
    return (
      <HTMLContainer style={{ width: shape.props.w, height: shape.props.h }}>
        <div ref={ref} className={`scrap scrap--${shape.props.tone}${typeof level === "number" ? ` sev sev-${Math.min(level, 4)}` : ""}`} style={{ fontStyle: t.style, fontWeight: t.weight }}>
        {source?.chips && source.chips.length > 0 && (
          <div className="source-chips">
            {source.chips.map((chip, i) => (
              <span key={i} className={chip.level === null ? "source-chip" : `source-chip sev-${Math.min(chip.level, 4)}`}>
                {chip.label}
              </span>
            ))}
          </div>
        )}
        <RichTextLabel
          shapeId={shape.id}
          type="card"
          richText={shape.props.richText}
          fontFamily={t.font}
          fontSize={t.size}
          lineHeight={t.lineHeight}
          textAlign="start"
          verticalAlign="start"
          labelColor={t.color}
          isSelected={isSelected}
          padding={t.pad}
          wrap
        />
        </div>
      </HTMLContainer>
    );
  }
  override getIndicatorPath(shape: CardShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 10);
    return path;
  }
}

/**
 * Auto-size by default: watch the text as the browser actually lays it out and set
 * the card's height to match, so text never spills out whatever the font metrics,
 * wrapping or zoom. The up-front estimate in fit() only avoids a visible jump.
 */
function useAutoHeight(editor: Editor, shape: CardShape, chrome: number) {
  const ref = useRef<HTMLDivElement>(null);
  const { id, props: { h: height, w, richText } } = shape;
  // Re-run when anything else sets the height (e.g. the load-time estimate) and when
  // editing swaps the text element, not only when the text box itself resizes.
  useLayoutEffect(() => {
    const text = ref.current?.querySelector<HTMLElement>(".tl-rich-text");
    if (!text) return;
    const sync = () => {
      const content = text.scrollHeight;
      if (!content || !text.offsetParent) return; // culled or hidden: no layout to trust
      const shape = editor.getShape<CardShape>(id);
      const h = Math.ceil(content + chrome);
      if (!shape || Math.abs(shape.props.h - h) < 1) return;
      editor.run(() => editor.updateShape<CardShape>({ id, type: "card", props: { h } }), { history: "ignore" });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(text);
    return () => observer.disconnect();
  }, [editor, id, chrome, height, w, richText]);
  return ref;
}

/** Re-measure every card, e.g. once web fonts have loaded or the type has changed. */
export function refitCards(editor: Editor) {
  const util = editor.getShapeUtil("card") as CardShapeUtil;
  // Every page, not just the open one, so switching pages never shows stale heights.
  const updates = editor.store
    .allRecords()
    .filter((r): r is CardShape => r.typeName === "shape" && r.type === "card")
    .map((s) => ({ before: s, after: util.fit(s) }))
    .filter(({ before, after }) => before.props.h !== after.props.h)
    .map(({ after }) => ({ id: after.id, type: "card" as const, props: { h: after.props.h } }));
  if (updates.length) editor.run(() => editor.updateShapes(updates), { history: "ignore" });
}

/** Note tool: drag or click to drop a pink handwritten card. */
export class CardShapeTool extends BaseBoxShapeTool {
  static override id = "card";
  static override initial = "idle";
  override shapeType = "card" as const;
  /** A fresh note is for writing in: go straight to typing instead of leaving the tool armed. */
  override onCreate(shape: TLShape | null) {
    if (!shape) return;
    this.editor.setCurrentTool("select");
    this.editor.select(shape.id);
    startEditingShapeWithRichText(this.editor, shape.id, { selectAll: true });
  }
}
