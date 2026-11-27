import { useEffect, useRef, useState } from "react";
import { useEditor, useValue, type Editor, type TLShape } from "tldraw";
import { askOf, createAsk, writtenByPerson } from "./asks";
import { sendAsk } from "./ask-ui";
import { selectedRecords } from "./import-board";
import { HUMAN_CARD_W } from "./agent-operations";
import { richTextPlain } from "./operations";
import { SUGGEST_FONT, SUGGEST_LINE, SUGGEST_LINE_TOUCH, SUGGEST_PAUSE_MS, selectionKey, suggestScale, suggestSize, suggestSpot, suggestionsFor, type Rect, type Selected } from "./suggest";
import { TOUCH } from "./keys";

/** The window's own controls over the board: suggestions never go under them. */
const CHROME = ".topbar, .tool-strip, .bottom-left, .zoom-controls, .left-panel, .right-panel, .toast";

const textOf = (s: TLShape) => ("richText" in s.props ? richTextPlain(s.props.richText).trim() : "");

/** A card's text with its line breaks kept (paragraphs, list items, Shift+Enter), so a list reads as one. */
export function textLines(node: unknown): string {
  if (typeof node !== "object" || node === null) return "";
  const { type, text, content } = node as { type?: string; text?: unknown; content?: unknown };
  if (type === "hardBreak") return "\n";
  if (typeof text === "string") return text;
  if (!Array.isArray(content)) return "";
  const inline = type === "paragraph" || type === "heading";
  return content.map(textLines).join(inline ? "" : "\n");
}
/** Room for the card a suggestion becomes, so clicking one never lands it on something. */
const CARD_ROOM = { w: HUMAN_CARD_W, h: 72 };
/** An ask's state line is drawn under it; it counts as part of the ask. */
const STATUS_ROOM = 36;

function describe(s: TLShape): Selected {
  return {
    type: s.type,
    text: "richText" in s.props ? textLines(s.props.richText).trim() : "",
    byPerson: writtenByPerson(s),
    untouchedSeed: s.meta.seed === true && typeof s.meta.updatedAt !== "number",
    conversation: Boolean(askOf(s)) || s.meta.role === "annotation" || s.meta.role === "caption" || Boolean(s.meta.replyTo) || s.type === "prompt",
    blank: "richText" in s.props && !textOf(s),
  };
}

type Offer = { key: string; texts: string[]; x: number; y: number; w: number; h: number; scale: number; targetIds: string[] };

/** The suggestions for what is selected now, placed clear of everything, or null. */
export function offerFor(editor: Editor): Offer | null {
  if (!editor.isIn("select.idle") || editor.getEditingShapeId()) return null;
  const shapes = editor.getSelectedShapes().filter((s) => s.type !== "arrow");
  const texts = suggestionsFor(shapes.map(describe), selectedRecords(editor).length === 1);
  const box = editor.getSelectionPageBounds();
  if (!texts.length || !box) return null;
  // Everything else on the page: not the selection, not what it holds or sits in.
  const mine = new Set<string>(shapes.map((s) => s.id));
  const related = (s: TLShape) =>
    mine.has(s.id) || shapes.some((t) => editor.hasAncestor(s, t.id) || editor.hasAncestor(t, s.id));
  const others: Rect[] = editor.getCurrentPageShapes().flatMap((s) => {
    if (s.type === "arrow" || related(s) || editor.isShapeHidden(s)) return [];
    const b = editor.getShapePageBounds(s);
    if (!b) return [];
    return [{ x: b.x, y: b.y, w: b.w, h: b.h + (s.meta.ask ? STATUS_ROOM : 0) }];
  });
  // The selection bar sits above the selection unless there is no room; then it is under it.
  const zoom = editor.getZoomLevel(), scale = suggestScale(zoom);
  const bar = document.querySelector(".selection-bar")?.getBoundingClientRect();
  const bottom = editor.pageToScreen({ x: box.x, y: box.maxY }).y;
  const under = bar && bar.top >= bottom - 1 ? (bar.bottom - bottom + 6) / zoom : 0;
  // The window's controls, as page rectangles: covering the tool strip or the zoom bar is as bad
  // as covering a card. Only what is shown counts.
  for (const el of document.querySelectorAll(CHROME)) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const a = editor.screenToPage({ x: r.left, y: r.top }), b = editor.screenToPage({ x: r.right, y: r.bottom });
    others.push({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
  }
  const view = editor.getViewportPageBounds();
  const size = suggestSize(texts, { scale, touch: TOUCH });
  const room = { w: Math.max(size.w, CARD_ROOM.w), h: Math.max(size.h, CARD_ROOM.h) };
  const spot = suggestSpot({ x: box.x, y: box.y, w: box.w, h: box.h }, room, others, { under, scale, view: { x: view.x, y: view.y, w: view.w, h: view.h } });
  if (!spot) return null;
  return { key: selectionKey(shapes.map((s) => s.id)), texts, ...spot, ...size, scale, targetIds: shapes.map((s) => s.id) };
}

/**
 * P4. When the person pauses on a selection of their own, at most two faint suggestions are
 * written under it. Clicking one writes it as their own pink card there, which asks as any card
 * does (one undo takes it back). Any other action makes them go, and they are offered once per
 * selection, so ignoring them is enough.
 */
export function SuggestLayer() {
  const editor = useEditor();
  // Cheap to follow: which objects are selected, and whether the person is idle on them.
  const ids = useValue("suggest selection", () => selectionKey(editor.getSelectedShapeIds()), [editor]);
  const idle = useValue("suggest idle", () => editor.isIn("select.idle") && !editor.getEditingShapeId(), [editor]);
  const key = idle ? ids : "";
  const [offer, setOffer] = useState<Offer | null>(null);
  // Selections whose suggestions the person has moved past. Pressing on the selected card (and
  // so leaving idle for a moment) keeps it the same selection; selecting anything else, or
  // nothing, is a new one, which gets a new chance.
  const done = useRef(new Set<string>());
  useEffect(() => {
    done.current = new Set([...done.current].filter((k) => k === ids));
  }, [ids]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shown = useRef<Offer | null>(null);
  shown.current = offer;

  useEffect(() => {
    clearTimeout(timer.current);
    setOffer(null);
    if (!key || done.current.has(key)) return;
    const wait = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const next = offerFor(editor);
        if (next && next.key === key) setOffer(next);
      }, SUGGEST_PAUSE_MS);
    };
    // Any action: an offer on screen goes for good; one not yet shown waits for a new pause.
    const act = (event?: Event) => {
      if (event?.target instanceof Element && event.target.closest("[data-suggestions]")) return;
      if (shown.current) {
        done.current.add(key);
        clearTimeout(timer.current);
        setOffer(null);
      } else wait();
    };
    const events = ["pointerdown", "keydown", "wheel"] as const;
    for (const name of events) window.addEventListener(name, act, { capture: true });
    const stop = editor.store.listen(() => act(), { scope: "document" });
    wait();
    return () => {
      clearTimeout(timer.current);
      for (const name of events) window.removeEventListener(name, act, { capture: true });
      stop();
    };
  }, [key, editor]);

  if (!offer) return null;
  const choose = (text: string) => {
    done.current.add(offer.key);
    setOffer(null);
    const id = createAsk(editor, { targetIds: offer.targetIds, question: text, at: { x: offer.x, y: offer.y } });
    sendAsk(editor, id);
    // Sent as it stands, like a card sent with Ask: nothing stays selected, so the bar never
    // covers the thought the question is about; the ask's state line says what happens.
    editor.selectNone();
    editor.focus();
  };
  return (
    <div className="scratch-layer suggest-layer">
      <div
        className="suggestions"
        data-suggestions={offer.key}
        role="group"
        aria-label="Suggested questions"
        style={{
          transform: `translate(${offer.x}px, ${offer.y}px)`,
          width: offer.w,
          height: offer.h,
          // One size on screen at every zoom (page units = screen px × scale).
          fontSize: SUGGEST_FONT * offer.scale,
          lineHeight: `${(TOUCH ? SUGGEST_LINE_TOUCH : SUGGEST_LINE) * offer.scale}px`,
          gap: 2 * offer.scale,
        }}
      >
        {offer.texts.map((text) => (
          <button
            key={text}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              // A touch over the board never becomes a click, so a tap acts on the press (as
              // the selection bar's tappable hint does); a mouse click, a key or a screen
              // reader uses onClick.
              if (e.pointerType !== "mouse") choose(text);
            }}
            onClick={(e) => {
              e.stopPropagation();
              choose(text);
            }}
            title="Write this as your question under what is selected; it goes to your agent"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
