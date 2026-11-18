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
  type RecordProps,
  type TLRichText,
  type TLShape,
} from "tldraw";

// A scratchbook card: the human's pink handwritten scrap or the agent's lavender note.
declare module "tldraw" {
  interface TLGlobalShapePropsMap {
    card: { w: number; h: number; richText: TLRichText; tone: "human" | "agent" | "caption" };
  }
}
export type CardShape = TLShape<"card">;

// Matches Thariq's board: the human writes in a brush marker hand on pink scraps;
// agents type in a plain sans on lavender cards.
export const cardType = {
  human: { font: "var(--scratch-hand)", size: 27, lineHeight: 1.22, pad: 18, minW: 140, weight: "400" },
  agent: { font: "var(--scratch-type)", size: 15, lineHeight: 1.5, pad: 16, minW: 220, weight: "400" },
  caption: { font: "var(--scratch-type)", size: 14, lineHeight: 1.35, pad: 0, minW: 80, weight: "400" },
} as const;
const measureFont = {
  human: "'Caveat Brush', cursive",
  agent: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
  caption: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
} as const;

export class CardShapeUtil extends BaseBoxShapeUtil<CardShape> {
  static override type = "card" as const;
  static override props: RecordProps<CardShape> = {
    w: T.number,
    h: T.number,
    richText: richTextValidator,
    tone: T.literalEnum("human", "agent", "caption"),
  };
  override canEdit() {
    return true;
  }
  override getDefaultProps(): CardShape["props"] {
    return { w: 240, h: 72, richText: toRichText(""), tone: "human" };
  }
  /** Grow height to fit the text, like a sticky note, so cards never clip. */
  private fit(shape: CardShape): CardShape {
    const t = cardType[shape.props.tone];
    const html = renderHtmlFromRichTextForMeasurement(this.editor, shape.props.richText);
    const size = this.editor.textMeasure.measureHtml(html || "&nbsp;", {
      fontFamily: measureFont[shape.props.tone],
      fontSize: t.size,
      lineHeight: t.lineHeight,
      fontStyle: "normal",
      fontWeight: t.weight,
      maxWidth: Math.max(40, shape.props.w - t.pad * 2),
      padding: "0px",
    });
    const h = Math.ceil(size.h + t.pad * 2 + (shape.props.tone === "caption" ? 2 : 4));
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
        <div className={`scrap scrap--${shape.props.tone}`}>
        <RichTextLabel
          shapeId={shape.id}
          type="card"
          richText={shape.props.richText}
          fontFamily={t.font}
          fontSize={t.size}
          lineHeight={t.lineHeight}
          textAlign="start"
          verticalAlign="start"
          labelColor={shape.props.tone === "human" ? "#a50f4d" : shape.props.tone === "caption" ? "#55524c" : "#1f1d2c"}
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

/** Note tool: drag or click to drop a pink handwritten card. */
export class CardShapeTool extends BaseBoxShapeTool {
  static override id = "card";
  static override initial = "idle";
  override shapeType = "card" as const;
}
