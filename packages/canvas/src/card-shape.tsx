import {
  BaseBoxShapeTool,
  BaseBoxShapeUtil,
  HTMLContainer,
  RichTextLabel,
  T,
  renderHtmlFromRichTextForMeasurement,
  richTextValidator,
  toRichText,
  useValue,
  type Editor,
  type RecordProps,
  type TLRichText,
  type TLShape,
} from "tldraw";

// A scratchbook card: the human's pink handwritten scrap or the agent's lavender note.
declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    card: { w: number; h: number; richText: TLRichText; tone: CardTone };
  }
}
export type CardTone = "human" | "agent" | "caption" | "heading" | "quote" | "code";
export type CardShape = TLShape<"card">;

// Text classes. The human writes in a brush marker on pink scraps. Agents write in a
// casual print (Shantell Sans) and pick a style for what they are writing: a note, a
// heading, a quoted source in serif italic, or data and code in monospace.
const hand = "'Caveat Brush', cursive";
const casual = "'Shantell Sans', 'Comic Neue', sans-serif";
const serif = "Newsreader, Georgia, serif";
const mono = "'JetBrains Mono', ui-monospace, monospace";
export const cardType: Record<CardTone, { font: string; size: number; lineHeight: number; pad: number; weight: string; style: "normal" | "italic"; color: string }> = {
  human: { font: hand, size: 27, lineHeight: 1.22, pad: 18, weight: "400", style: "normal", color: "#a50f4d" },
  agent: { font: casual, size: 16, lineHeight: 1.45, pad: 16, weight: "400", style: "normal", color: "#22203a" },
  caption: { font: casual, size: 14, lineHeight: 1.35, pad: 0, weight: "400", style: "normal", color: "#55524c" },
  heading: { font: casual, size: 30, lineHeight: 1.15, pad: 0, weight: "700", style: "normal", color: "#3a2fd0" },
  quote: { font: serif, size: 19, lineHeight: 1.4, pad: 18, weight: "400", style: "italic", color: "#2b2940" },
  code: { font: mono, size: 13, lineHeight: 1.6, pad: 14, weight: "400", style: "normal", color: "#22203a" },
};
const unboxed = new Set<CardTone>(["caption", "heading"]);

export class CardShapeUtil extends BaseBoxShapeUtil<CardShape> {
  static override type = "card" as const;
  static override props: RecordProps<CardShape> = {
    w: T.number,
    h: T.number,
    richText: richTextValidator,
    tone: T.literalEnum("human", "agent", "caption", "heading", "quote", "code"),
  };
  override canEdit() {
    return true;
  }
  override getDefaultProps(): CardShape["props"] {
    return { w: 240, h: 72, richText: toRichText(""), tone: "human" };
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
  override onBeforeUpdate(_prev: CardShape, next: CardShape) {
    return this.fit(next);
  }
  override component(shape: CardShape) {
    const t = cardType[shape.props.tone];
    const isSelected = useValue("card selected", () => this.editor.getOnlySelectedShapeId() === shape.id, [this.editor, shape.id]);
    return (
      <HTMLContainer style={{ width: shape.props.w, height: shape.props.h }}>
        <div className={`scrap scrap--${shape.props.tone}`} style={{ fontStyle: t.style, fontWeight: t.weight }}>
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
}
