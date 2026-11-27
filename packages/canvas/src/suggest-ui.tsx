import { useEffect, useRef, useState } from "react";
import { useEditor, useValue, type Editor, type TLShape, type TLShapeId } from "tldraw";
import { askOf, createAsk, writtenByPerson } from "./asks";
import { sendAsk } from "./ask-ui";
import { selectedRecords } from "./import-board";
import { HUMAN_CARD_W } from "./agent-operations";
import { richTextPlain } from "./operations";
import { SUGGEST_PAUSE_MS, selectionKey, suggestSize, suggestSpot, suggestionsFor, type Rect, type Selected } from "./suggest";

const textOf = (s: TLShape) => ("richText" in s.props ? richTextPlain(s.props.richText).trim() : "");
/** Room for the card a suggestion becomes, so clicking one never lands it on something. */
const CARD_ROOM = { w: HUMAN_CARD_W, h: 72 };
/** An ask's state line is drawn under it; it counts as part of the ask. */
const STATUS_ROOM = 36;

function describe(s: TLShape): Selected {
  return {
    type: s.type,
    text: textOf(s),
    byPerson: writtenByPerson(s),
    untouchedSeed: s.meta.seed === true && typeof s.meta.updatedAt !== "number",
    conversation: Boolean(askOf(s)) || s.meta.role === "annotation" || s.meta.role === "caption" || Boolean(s.meta.replyTo) || s.type === "prompt",
    blank: "richText" in s.props && !textOf(s),
  };
}

type Offer = { key: string; texts: string[]; x: number; y: number; w: number; h: number; targetIds: string[] };

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
  const zoom = editor.getZoomLevel();
  const bar = document.querySelector(".selection-bar")?.getBoundingClientRect();
  const bottom = editor.pageToScreen({ x: box.x, y: box.maxY }).y;
  const under = bar && bar.top >= bottom - 1 ? (bar.bottom - bottom + 6) / zoom : 0;
  const size = suggestSize(texts);
  const room = { w: Math.max(size.w, CARD_ROOM.w), h: Math.max(size.h, CARD_ROOM.h) };
  const spot = suggestSpot({ x: box.x, y: box.y, w: box.w, h: box.h }, room, others, under);
  if (!spot) return null;
  return { key: selectionKey(shapes.map((s) => s.id)), texts, ...spot, ...size, targetIds: shapes.map((s) => s.id) };
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
    editor.select(id as TLShapeId);
    editor.focus();
  };
  return (
    <div className="scratch-layer suggest-layer">
      <div
        className="suggestions"
        data-suggestions={offer.key}
        role="group"
        aria-label="Suggested questions"
        style={{ transform: `translate(${offer.x}px, ${offer.y}px)`, width: offer.w, height: offer.h }}
      >
        {offer.texts.map((text) => (
          <button
            key={text}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
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
