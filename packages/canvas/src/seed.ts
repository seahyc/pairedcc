import { b64Vecs, createShapeId, toRichText, type Editor, type TLShapeId } from "tldraw";
import { annotateObject, connect, createCard, image } from "./agent-operations";
import { HUMAN } from "./scratchbook";

// The welcome board, laid out like a scratchbook: a handwritten title and a row of
// pages, one per capability, each showing the thing working rather than describing it.

const AGENT = "Paired";
const COL_W = 520;
const GAP = 64;
const PAD = 40;
const TOP = 300;
const INNER = COL_W - PAD * 2;

type Column = { frame: TLShapeId; x: number; y: number; ids: TLShapeId[] };

const svgUrl = (svg: string) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

/** A palette swatch card, drawn as SVG so the board needs no network. */
function palette(name: string, bg: string, colors: string[], ink: string) {
  const w = 264, h = 200;
  const stripes = colors
    .map((c, i) => `<rect x="${18 + i * 46}" y="22" width="40" height="112" rx="6" fill="${c}"/>`)
    .join("");
  return svgUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect width="${w}" height="${h}" rx="12" fill="${bg}"/>${stripes}` +
      `<text x="20" y="170" font-family="Georgia, serif" font-size="22" fill="${ink}">${name}</text></svg>`,
  );
}

/** Wobbly hand-drawn loop around a box, as a pen stroke. */
function inkLoop(w: number, h: number) {
  const pts = [];
  const cx = w / 2, cy = h / 2;
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2.15 - 0.4;
    const wob = 1 + 0.035 * Math.sin(t * 3.1) + 0.02 * Math.sin(t * 7.3);
    pts.push({ x: cx + Math.cos(t) * cx * wob, y: cy + Math.sin(t) * cy * wob * (1 + i / 700), z: 0.5 });
  }
  return b64Vecs.encodePoints(pts);
}

export function seed(editor: Editor) {
  const heightOf = (id: TLShapeId) => editor.getShapePageBounds(id)?.h ?? 0;

  const text = (
    x: number,
    y: number,
    value: string,
    opts: { size?: "s" | "m" | "l" | "xl"; font?: "sans" | "draw"; color?: "black" | "grey" | "red" | "violet"; w?: number; scale?: number } = {},
  ) => {
    const id = createShapeId();
    editor.createShape({
      id,
      type: "text",
      x,
      y,
      props: {
        richText: toRichText(value),
        font: opts.font ?? "sans",
        size: opts.size ?? "s",
        color: opts.color ?? "black",
        textAlign: "start",
        scale: opts.scale ?? 1,
        ...(opts.w ? { autoSize: false, w: opts.w } : {}),
      },
    });
    return id;
  };

  const card = (x: number, y: number, value: string, author: string, width?: number, style?: "heading" | "quote" | "code") =>
    createCard(editor, { x, y, text: value, width, style }, author);
  const link = (fromId: TLShapeId, toId: TLShapeId, actor: string, label = "") =>
    connect(editor, { fromId, toId, label }, actor)!.id as TLShapeId;
  const resolve = (id: TLShapeId) => {
    const s = editor.getShape(id)!;
    editor.updateShape({ id, type: s.type, meta: { ...s.meta, markStatus: "resolved", resolvedBy: AGENT } });
  };

  // Title, in the human's hand.
  text(0, 0, "welcome to paired", { font: "draw", size: "xl", scale: 2.2 });
  text(6, 128, "this board is yours. think out loud, with an agent beside you.", { size: "l", color: "grey" });
  text(8, 186, "space + drag to pan   ·   scroll to move   ·   pinch to zoom   ·   shift + 1 to see everything", { size: "s", color: "grey" });

  const columns: Column[] = [];
  const column = (i: number, letter: string, heading: string, sub: string): Column => {
    const x = i * (COL_W + GAP);
    const frame = createShapeId();
    editor.createShape({ id: frame, type: "frame", x, y: TOP, props: { w: COL_W, h: 400, name: String(i + 1) } });
    const col: Column = { frame, x: x + PAD, y: TOP + 34, ids: [] };
    const add = (id: TLShapeId) => {
      col.ids.push(id);
      return id;
    };
    add(text(col.x - 4, col.y - 6, letter, { font: "draw", size: "xl", color: "red", scale: 1.3 }));
    add(text(col.x + 56, col.y + 4, heading, { size: "m", w: INNER - 56 }));
    col.y += 96;
    const subId = add(text(col.x, col.y, sub, { size: "s", color: "grey", w: INNER }));
    col.y += heightOf(subId) + 36;
    columns.push(col);
    return col;
  };
  const put = (col: Column, id: TLShapeId, gap = 22) => {
    col.ids.push(id);
    col.y += heightOf(id) + gap;
    return id;
  };
  const step = (col: Column, n: string, value: string) => {
    put(col, text(col.x, col.y, `${n}   ${value}`, { size: "s", w: INNER }), 14);
  };

  // A: the agent loop.
  const a = column(0, "A", "think out loud with your own AI agent", "Claude Code, Codex, Cursor or any MCP agent can read this board, write on it, and wait for your call.");
  step(a, "1", "you write in pink, by hand");
  put(a, card(a.x, a.y, "how many of our customers\nreally come back?", HUMAN, 300), 30);
  step(a, "2", "the agent answers in typed lavender, marked ✦");
  put(a, card(a.x, a.y, "Before I count: does a single repeat visit count, or do you mean a habit, like twice a month? I'll lay out both so you can compare.", AGENT, INNER), 30);
  step(a, "3", "try this prompt");
  put(a, card(a.x, a.y, "Read my board. Give me three ways to look at my question, each with a small picture and a one-line caption. Then ask me two questions I can answer by marking the board.", AGENT, INNER), 30);
  put(a, text(a.x, a.y, "To connect, click { } Agent access (top right) and paste the one line it gives you into your agent. Keep this tab open while it works.", { size: "s", color: "grey", w: INNER }), 10);

  // B: examples side by side.
  const b = column(1, "B", "see options side by side", "Ask for a few. The agent reads your question back, then lays out real examples you can compare at a glance.");
  const readBack = put(b, card(b.x, b.y, "You asked for a palette for a neighbourhood cafe. I read that as warm, but not rustic. Three directions:", AGENT, INNER), 64);
  const sw = (INNER - 2 * 18) / 3, sh = sw * (200 / 264);
  const swatches = [
    { name: "Clay", bg: "#f3e6d8", colors: ["#b5562f", "#d9895b", "#efc9a1", "#5b3a29", "#f8f1e7"], ink: "#5b3a29", caption: "A · clay, safe and warm" },
    { name: "Sea glass", bg: "#e4efec", colors: ["#2f6f6a", "#7fb3a6", "#cfe3dc", "#1f3b3a", "#f5f8f2"], ink: "#1f3b3a", caption: "B · sea glass, calm by day" },
    { name: "Night market", bg: "#1f1b2e", colors: ["#f2a03d", "#e2574c", "#6c4ab6", "#f6e7c1", "#2b2540"], ink: "#f6e7c1", caption: "C · night market, glows after dark" },
  ].map((p, i) =>
    image(editor, { x: b.x + i * (sw + 18), y: b.y, width: sw, height: sh, name: `${p.caption.slice(0, 1)} · ${p.name}`, src: palette(p.name, p.bg, p.colors, p.ink), caption: p.caption }, AGENT),
  );
  for (const s of swatches) {
    b.ids.push(s.id as TLShapeId);
    if (s.captionId) b.ids.push(s.captionId as TLShapeId);
    link(readBack, s.id as TLShapeId, AGENT);
  }
  b.y += sh + 70;
  put(b, card(b.x, b.y, "My read: A is the safe choice. C is the only one that still works at 9pm, when most of your regulars arrive.\n\n1. Do you open in the evenings?\n2. Should the sign match the cups?", AGENT, INNER), 30);
  put(b, text(b.x, b.y, "Answer by marking the board (next page) or by writing on it.", { size: "s", color: "grey", w: INNER }), 10);

  // C: judgement without typing.
  const c = column(2, "C", "judge with a pen, not a prompt", "Select something and press P to pick it or X to reject it. Or just circle it with the pen. Each mark goes to the agent's queue.");
  const names = ["Slow mornings, good coffee", "Artisanal beverage experiences", "The corner you come back to"];
  const firstY = c.y;
  const nameIds = names.map((n) => put(c, card(c.x, c.y, n, AGENT, 250), 26));
  const picked = editor.getShape(nameIds[0])!, rejected = editor.getShape(nameIds[1])!;
  editor.updateShape({ id: picked.id, type: "card", meta: { ...picked.meta, mark: "picked" } });
  editor.updateShape({ id: rejected.id, type: "card", meta: { ...rejected.meta, mark: "rejected" } });
  resolve(picked.id);
  resolve(rejected.id);
  const third = editor.getShapePageBounds(nameIds[2])!;
  const loop = createShapeId();
  editor.createShape({
    id: loop,
    type: "draw",
    x: third.x - 16,
    y: third.y - 14,
    meta: { status: "resolved", resolvedBy: AGENT },
    props: { color: "red", size: "m", dash: "draw", segments: [{ type: "free", path: inkLoop(third.w + 32, third.h + 28) }], isComplete: true },
  });
  c.ids.push(loop);
  const note = annotateObject(editor, { targetId: nameIds[0], text: "this one, but shorter", author: HUMAN, x: c.x + 296, y: firstY - 8 })!;
  c.ids.push(note.id as TLShapeId);
  const noteShape = editor.getShape(note.id as TLShapeId)!;
  editor.updateShape({ id: noteShape.id, type: "card", props: { ...noteShape.props, w: INNER - 296 }, meta: { ...noteShape.meta, status: "resolved", name: "Feedback · resolved", resolvedBy: AGENT } });
  for (const arrow of editor.getCurrentPageShapes().filter((s) => s.type === "arrow" && s.meta.fromId === note.id)) c.ids.push(arrow.id);
  c.y += 12;
  put(c, card(c.x, c.y, "Done: “Slow mornings.” I kept your pick, dropped the rejected line, and moved the circled one to the back of the menu.", AGENT, INNER), 30);
  put(c, text(c.x, c.y, "The top bar counts open marks. Your agent reads them, answers, then ticks each one off ✓.", { size: "s", color: "grey", w: INNER }), 10);

  // D: associative branching.
  const d = column(3, "D", "branch out by association", "One thought leads to the next. Draw an arrow from anything to anything; ask the agent to grow branches too.");
  const root = put(d, card(d.x + 110, d.y, "why do people linger\nin cafes?", HUMAN, 230), 80);
  const bw = (INNER - 2 * 16) / 3;
  const branches = ["to be alone, together", "a small ritual that marks the day", "a desk that costs one coffee"].map((t, i) =>
    card(d.x + i * (bw + 16), d.y, t, AGENT, bw),
  );
  branches.forEach((id) => {
    d.ids.push(id);
    link(root, id, AGENT);
  });
  d.y += Math.max(...branches.map(heightOf)) + 80;
  const sub = put(d, card(d.x + 120, d.y, "other rituals?\nbakery runs, evening walks", HUMAN, 260), 30);
  link(branches[1], sub, HUMAN);
  put(d, text(d.x, d.y, "Arrows stay attached when you move things, so a messy map can be tidied later.", { size: "s", color: "grey", w: INNER }), 10);

  // E: concepts as objects.
  const e = column(4, "E", "turn ideas into things you can move", "Every idea is an object: drag it, group it, duplicate it, compare it.");
  const draft = put(e, card(e.x, e.y, "Menu, draft 1\nflat white · toast · one cake", AGENT, 170), 0);
  const draft2 = card(e.x + INNER - 170, e.y - heightOf(draft), "Menu, draft 2\nflat white · toast · soup at night", AGENT, 170);
  e.ids.push(draft2);
  link(draft, draft2, HUMAN, "⌘D, then edit");
  e.y += 40;
  const shapes = [
    { geo: "rectangle" as const, w: 140, h: 90, label: "a section", color: "violet" as const },
    { geo: "ellipse" as const, w: 140, h: 90, label: "a theme", color: "red" as const },
    { geo: "cloud" as const, w: 140, h: 90, label: "a hunch", color: "grey" as const },
  ];
  shapes.forEach((s, i) => {
    const id = createShapeId();
    editor.createShape({
      id,
      type: "geo",
      x: e.x + i * 150,
      y: e.y,
      props: { geo: s.geo, w: s.w, h: s.h, dash: "draw", fill: "none", color: s.color, font: "draw", size: "m", richText: toRichText(s.label) },
    });
    e.ids.push(id);
  });
  e.y += 120;
  for (const line of [
    "drop in images or paste screenshots",
    "frames (F) hold one line of thought",
    "⌘D duplicates a variant so you can try another way",
    "pages keep separate explorations apart",
    "export saves the board as an image",
  ])
    put(e, text(e.x, e.y, `–  ${line}`, { size: "s", w: INNER }), 8);
  e.y += 30;
  put(e, text(e.x, e.y, "agents write in a few voices, so you can tell an idea from a source or a number at a glance:", { size: "s", color: "grey", w: INNER }), 22);
  put(e, card(e.x + 22, e.y, "Why people come back", AGENT, INNER - 22, "heading"), 14);
  put(e, card(e.x, e.y, "Regulars come for the coffee, but they stay for being recognised.", AGENT, INNER), 16);
  put(e, card(e.x, e.y, "“A good café is a living room you share with strangers.”\n— a café owner, from your interview notes (example)", AGENT, INNER, "quote"), 16);
  put(e, card(e.x, e.y, "regulars: 312\nrepeat rate: 41%\nmedian visits: 3.2 a month", AGENT, 280, "code"), 10);

  // +: what comes next.
  const f = column(5, "+", "where this is going", "Paired is an early prototype of a tool for thought. Next on the list:");
  for (const line of [
    "converge: the agent gathers your picks into one summary",
    "bring your data: charts drawn from your own numbers",
    "learning mode, opt-in: predict before you look, then check",
    "boards saved to your account, so agents can work while this tab is closed",
  ])
    put(f, text(f.x, f.y, `–  ${line}`, { size: "s", w: INNER }), 8);
  f.y += 26;
  put(f, card(f.x, f.y, "Built on ideas from Bret Victor and Andy Matuschak: show the thing itself, let people handle it, and keep judgement with the human.", AGENT, INNER), 34);
  put(f, card(f.x + 150, f.y, "this file is yours,\ngo wild", HUMAN, 240), 10);

  // Size each page to its contents and tuck the contents inside it.
  const bottom = Math.max(...columns.map((col) => col.y)) + PAD;
  for (const col of columns) {
    editor.updateShape({ id: col.frame, type: "frame", props: { h: bottom - TOP } });
    editor.reparentShapes(col.ids, col.frame);
  }

  editor.selectNone();
  const first = editor.getShapePageBounds(columns[0].frame)!;
  const third2 = editor.getShapePageBounds(columns[2].frame)!;
  editor.zoomToBounds({ x: first.x - 40, y: -40, w: third2.maxX - first.x + 80, h: 900 }, { animation: { duration: 0 } });
  // Start with the title near the top, like opening a sketchbook, rather than centred.
  const cam = editor.getCamera();
  editor.setCamera({ x: cam.x, y: 110 / cam.z + 40, z: cam.z }, { animation: { duration: 0 } });
  editor.clearHistory();
}

/** True when a page holds only the original v1 starter board, untouched. */
export function isLegacySeed(editor: Editor) {
  const shapes = editor.getCurrentPageShapes();
  return shapes.length === 7 && shapes.some((s) => s.id === "shape:first-thoughts");
}
