import {
  getStroke,
  getSvgPathFromPoints,
  useEditor,
  useValue,
  type Editor,
  type TLShape,
} from "tldraw";
import { revision, richTextPlain } from "./operations";

// Scratchbook visual language: human marks are pink ink and handwriting;
// agent work is lavender, plain type and carries a ✦. See docs/canvas/working-spec.md.
export const HUMAN = "Human";
export const humanStyle = { ink: "red", note: "light-red", font: "draw" } as const;
export const agentStyle = { ink: "violet", note: "light-violet", font: "sans" } as const;

export type Mark = "picked" | "rejected";
export type MarkStatus = "open" | "resolved";

export function authorOf(shape: TLShape): string {
  if (shape.meta.role === "annotation" && typeof shape.meta.author === "string")
    return shape.meta.author;
  return typeof shape.meta.createdBy === "string" ? shape.meta.createdBy : HUMAN;
}
export const isAgentShape = (shape: TLShape) => authorOf(shape) !== HUMAN;

function overlap(editor: Editor, a: TLShape, b: TLShape) {
  const p = editor.getShapePageBounds(a),
    q = editor.getShapePageBounds(b);
  if (!p || !q) return 0;
  const w = Math.min(p.maxX, q.maxX) - Math.max(p.minX, q.minX),
    h = Math.min(p.maxY, q.maxY) - Math.max(p.minY, q.minY);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1, Math.min(p.w * p.h, q.w * q.h));
}

const inkTargetTypes = new Set(["image", "geo", "note", "card", "text", "embed", "bookmark", "video"]);

/** Objects a human ink stroke is drawn over: circled, crossed out or scribbled on. */
export function inkTargets(editor: Editor, ink: TLShape, shapes = editor.getCurrentPageShapes()) {
  return shapes
    .filter((s) => s.id !== ink.id && inkTargetTypes.has(s.type))
    .map((s) => ({ id: s.id, score: overlap(editor, ink, s) }))
    .filter((t) => t.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .map((t) => t.id);
}

export type MarkSummary = {
  id: string;
  revision: number;
  kind: "note" | "pick" | "reject" | "ink";
  status: MarkStatus;
  targetIds: string[];
  text?: string;
  closed?: boolean;
};

/** Human feedback the agent should address: notes, picks, rejects and ink over objects. */
export function collectMarks(editor: Editor): MarkSummary[] {
  const shapes = editor.getCurrentPageShapes(),
    marks: MarkSummary[] = [];
  for (const s of shapes) {
    // Picks and rejects are human judgements on any object, including agent work.
    if (s.meta.mark === "picked" || s.meta.mark === "rejected")
      marks.push({
        id: s.id,
        revision: revision(s),
        kind: s.meta.mark === "picked" ? "pick" : "reject",
        status: s.meta.markStatus === "resolved" ? "resolved" : "open",
        targetIds: [s.id],
      });
    if (isAgentShape(s)) continue;
    if (s.meta.role === "annotation")
      marks.push({
        id: s.id,
        revision: revision(s),
        kind: "note",
        status: s.meta.status === "resolved" ? "resolved" : "open",
        targetIds: typeof s.meta.targetId === "string" ? [s.meta.targetId] : [],
        text: "richText" in s.props ? richTextPlain(s.props.richText) : "",
      });
    else if (s.type === "draw") {
      const targetIds = inkTargets(editor, s, shapes);
      if (targetIds.length)
        marks.push({
          id: s.id,
          revision: revision(s),
          kind: "ink",
          status: s.meta.status === "resolved" ? "resolved" : "open",
          targetIds,
          closed: "isClosed" in s.props ? Boolean(s.props.isClosed) : undefined,
        });
    }
  }
  return marks;
}

/** Human judgement: toggle pick or reject on objects. Agents can read marks but not set them. */
export function toggleMark(editor: Editor, shapes: TLShape[], mark: Mark) {
  const targets = shapes.filter((s) => s.type !== "arrow" && s.type !== "draw");
  if (!targets.length) return;
  const clear = targets.every((s) => s.meta.mark === mark);
  editor.markHistoryStoppingPoint(mark === "picked" ? "pick" : "reject");
  editor.run(() => {
    for (const s of targets) {
      const meta = { ...s.meta };
      if (clear) {
        delete meta.mark;
        delete meta.markStatus;
      } else Object.assign(meta, { mark, markStatus: "open" });
      editor.updateShape({ id: s.id, type: s.type, meta });
    }
  });
}

/** Mark a human note, pick/reject or ink stroke addressed (or reopen it). */
export function resolveMark(editor: Editor, shape: TLShape, status: MarkStatus, actor: string) {
  const meta: TLShape["meta"] = { ...shape.meta, resolvedBy: actor };
  if (shape.meta.role === "annotation") {
    Object.assign(meta, {
      status,
      name: status === "resolved" ? "Feedback · resolved" : "Feedback",
    });
  } else if (shape.meta.mark === "picked" || shape.meta.mark === "rejected") {
    meta.markStatus = status;
  } else if (shape.type === "draw" && !isAgentShape(shape)) {
    meta.status = status;
  } else throw new Error("Object is not a human mark (feedback note, pick, reject or ink)");
  editor.markHistoryStoppingPoint("resolve mark");
  editor.updateShape({ id: shape.id, type: shape.type, meta });
}

// Thariq's marks are clean crimson strokes: a rounded box around picks, an X through rejects.
const pickBox = (w: number, h: number) => {
  const p = 5, r = 9;
  return `M ${-p + r} ${-p} H ${w + p - r} Q ${w + p} ${-p} ${w + p} ${-p + r} V ${h + p - r} Q ${w + p} ${h + p} ${w + p - r} ${h + p} H ${-p + r} Q ${-p} ${h + p} ${-p} ${h + p - r} V ${-p + r} Q ${-p} ${-p} ${-p + r} ${-p} Z`;
};
const rejectX = (w: number, h: number) =>
  `M ${w * 0.08} ${h * 0.1} L ${w * 0.92} ${h * 0.9} M ${w * 0.92} ${h * 0.1} L ${w * 0.08} ${h * 0.9}`;

// Connectors are redrawn as marker strokes: thicker where the pen lands, thinning as it
// travels, with a filled head. tldraw's own arrow line stays for binding and hit-testing
// but is hidden by CSS (.tl-shape[data-shape-type="arrow"] > svg).
const inkColors: Record<string, string> = {
  violet: "#3a2fd0",
  red: "#c8125a",
  black: "#1d1d1f",
  grey: "#8a8f98",
  blue: "#2f5be0",
  green: "#2f8a55",
  orange: "#e0782f",
};

/** Small deterministic PRNG so each arrow keeps the same wobble across renders. */
function seeded(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

type Pt = { x: number; y: number; z: number };
const strokeOpts = { thinning: 0.65, smoothing: 0.55, streamline: 0.35, simulatePressure: false } as const;

function markerStroke(editor: Editor, arrow: TLShape) {
  const geometry = editor.getShapeGeometry(arrow) as unknown as {
    children?: { vertices: { x: number; y: number }[]; isLabel?: boolean }[];
    vertices: { x: number; y: number }[];
  };
  const body = geometry.children?.find((c) => !c.isLabel) ?? geometry;
  const transform = editor.getShapePageTransform(arrow);
  const pts = body.vertices.map((v) => transform.applyToPoint(v));
  if (pts.length < 2) return null;
  const rand = seeded(arrow.id);

  // Resample by arc length so wobble and pressure are spread evenly.
  const seg: number[] = [0];
  for (let i = 1; i < pts.length; i++) seg.push(seg[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const L = seg[seg.length - 1];
  if (L < 4) return null;
  const n = Math.max(8, Math.ceil(L / 5));
  const base: { x: number; y: number; nx: number; ny: number }[] = [];
  let j = 1;
  for (let k = 0; k <= n; k++) {
    const d = (L * k) / n;
    while (j < seg.length - 1 && seg[j] < d) j++;
    const a = pts[j - 1], b = pts[j];
    const t = (d - seg[j - 1]) / Math.max(1e-6, seg[j] - seg[j - 1]);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    base.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: -(b.y - a.y) / len, ny: (b.x - a.x) / len });
  }

  // Hand wobble: two slow waves, pinned at both ends so the arrow still lands on its target.
  const amp = Math.min(3.2, 0.6 + L * 0.008);
  const f1 = 1 + rand() * 1.2, f2 = 2.5 + rand() * 2, p1 = rand() * 6.28, p2 = rand() * 6.28;
  const press1 = rand() * 6.28;
  const dense: Pt[] = base.map((b, k) => {
    const s = k / n;
    const env = Math.sin(Math.PI * s);
    const off = amp * env * (0.75 * Math.sin(f1 * Math.PI * s + p1) + 0.35 * Math.sin(f2 * Math.PI * s + p2));
    // Heavier where the marker lands, lighter as it drags, with an uneven hand.
    const z = 0.95 - 0.45 * s + 0.12 * Math.sin(3 * Math.PI * s + press1);
    return { x: b.x + b.nx * off, y: b.y + b.ny * off, z: Math.max(0.3, Math.min(1, z)) };
  });
  const outline = getStroke(dense, { size: 3.6, ...strokeOpts, start: { taper: 8 + rand() * 6 }, end: { taper: 4 } });

  // Open head: two quick flicks back from the tip, slightly uneven like a real pen.
  const end = dense[dense.length - 1];
  const back = dense[Math.max(0, dense.length - 4)];
  const ang = Math.atan2(end.y - back.y, end.x - back.x);
  const flick = (side: 1 | -1) => {
    const spread = (0.5 + rand() * 0.14) * side;
    const len = 11 + rand() * 4;
    const a = ang + Math.PI + spread;
    const tip = { x: end.x + (rand() - 0.5) * 1.2, y: end.y + (rand() - 0.5) * 1.2 };
    const bow = (rand() - 0.5) * 2.4;
    const flickPts: Pt[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const bx = tip.x + Math.cos(a) * len * t, by = tip.y + Math.sin(a) * len * t;
      const o = bow * Math.sin(Math.PI * t);
      flickPts.push({ x: bx - Math.sin(a) * o, y: by + Math.cos(a) * o, z: 0.9 - 0.5 * t });
    }
    return getSvgPathFromPoints(getStroke(flickPts, { size: 3.2, ...strokeOpts, start: { taper: 0 }, end: { taper: 5 } }), true);
  };
  const head = `${flick(1)} ${flick(-1)}`;
  const color = "color" in arrow.props && typeof arrow.props.color === "string" ? arrow.props.color : "black";
  return { id: arrow.id, body: getSvgPathFromPoints(outline, true), head, color: inkColors[color] ?? "#1d1d1f" };
}

/** Marker-style connectors for every arrow on the page. */
export function MarkerArrows() {
  const editor = useEditor();
  const strokes = useValue(
    "marker arrows",
    () =>
      editor
        .getCurrentPageShapes()
        .filter((s) => s.type === "arrow")
        .flatMap((s) => {
          try {
            const stroke = markerStroke(editor, s);
            return stroke ? [stroke] : [];
          } catch {
            return [];
          }
        }),
    [editor],
  );
  return (
    <svg className="marker-arrows" aria-hidden>
      {strokes.map((s) => (
        <g key={s.id} fill={s.color}>
          <path d={s.body} />
          <path d={s.head} />
        </g>
      ))}
    </svg>
  );
}

/** Page-space layer drawn over shapes: pick circles, reject crosses, ✦ and ✓ badges. */
export function ScratchbookLayer() {
  const editor = useEditor();
  const items = useValue(
    "scratchbook marks",
    () => {
      const resolved = new Set(
        collectMarks(editor).filter((m) => m.status === "resolved").map((m) => m.id),
      );
      return editor.getCurrentPageShapes().flatMap((s) => {
        const b = editor.getShapePageBounds(s);
        if (!b) return [];
        const textual = s.type === "card" || s.type === "note" || s.type === "text" || (s.type === "geo" && "richText" in s.props && richTextPlain(s.props.richText));
        const agent = isAgentShape(s) && Boolean(textual);
        const mark = s.meta.mark === "picked" || s.meta.mark === "rejected" ? s.meta.mark : undefined;
        if (!agent && !mark && !resolved.has(s.id)) return [];
        return [{ id: s.id, x: b.x, y: b.y, w: b.w, h: b.h, type: s.type, caption: s.meta.role === "caption", agent, mark, resolved: resolved.has(s.id) }];
      });
    },
    [editor],
  );
  return (
    <div className="scratch-layer" aria-hidden>
      <MarkerArrows />
      {items.map((i) => (
        <div key={i.id} className="scratch-item" style={{ transform: `translate(${i.x}px, ${i.y}px)`, width: i.w, height: i.h }}>
          {i.mark && (
            <svg className="scratch-ink" width={i.w} height={i.h} viewBox={`0 0 ${i.w} ${i.h}`}>
              {i.mark === "rejected" && <rect className="scratch-fade" width={i.w} height={i.h} />}
              <path d={i.mark === "picked" ? pickBox(i.w, i.h) : rejectX(i.w, i.h)} />
            </svg>
          )}
          {i.agent && <span className={i.type === "text" || i.caption ? "scratch-spark inline" : "scratch-spark"}>✦</span>}
          {i.resolved && <span className="scratch-done">✓</span>}
        </div>
      ))}
    </div>
  );
}

/** Warm paper with a dot grid that pans and zooms with the board. */
export function PaperBackground() {
  const editor = useEditor();
  const { x, y, z } = useValue("camera", () => editor.getCamera(), [editor]);
  const step = 20 * z;
  return (
    <div
      className="paper"
      style={{
        backgroundSize: `${step}px ${step}px`,
        backgroundPosition: `${x * z}px ${y * z}px`,
      }}
    />
  );
}

/** "96 items · 0 open marks", like Thariq's board header. */
export function MarksCounter() {
  const editor = useEditor();
  const { items, open } = useValue(
    "marks counter",
    () => ({
      items: editor.getCurrentPageShapes().filter((s) => s.type !== "arrow").length,
      open: collectMarks(editor).filter((m) => m.status === "open").length,
    }),
    [editor],
  );
  return (
    <div className={open ? "marks-counter has-open" : "marks-counter"} role="status">
      {items} items · {open} open {open === 1 ? "mark" : "marks"}
    </div>
  );
}
