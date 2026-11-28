import { task } from "../task-kit";
// #178 (item 131, P2 "about everything over here"): a question written on the empty space inside a
// group the person made is about that group, even when it sits more than 60 px from every card in
// it. The person laid out ten venue cards in a ring around an empty middle and wrote "Which of
// these is cheapest?" in the middle. Outside the ring, well apart from it, lies a cheaper venue
// they ruled out for another reason. The agent passes by answering about the ring (Mill House
// first) and leaving every one of the person's objects where and as it was.
const RING = [
  "Harbour Room: £1,450",
  "Old Library: £1,200",
  "Glasshouse: £1,800",
  "Mill House: £640",
  "Rope Works: £990",
  "Granary: £1,100",
  "Sail Loft: £1,350",
  "Chapel Hall: £870",
  "Boat Shed: £1,050",
  "Corn Exchange: £1,600",
] as const;
const CHEAPEST = "Mill House";
const DECOY = "Station Arches: £420 (no step-free access)";
const NAMES = [...RING.map((r) => r.split(":")[0]), "Station Arches"];

// Rows 110 apart and columns 300 apart (cards 240 wide), so neighbours are within 60 px of each
// other and chain into one group, while the middle is more than 60 px from every card.
const SPOTS = [
  [0, 0], [300, 0], [600, 0],
  [0, 110], [600, 110],
  [0, 220], [600, 220],
  [0, 330], [300, 330], [600, 330],
] as const;
// Mill House sits on the left side, beside the middle (an ask gives the eight nearest members).
const ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export default task({
  id: "33-ask-inside-ring",
  prompt: "The person is waiting for an answer to a question they wrote on the board. Answer it.",
  async setup({ page, person, refs, call }) {
    const id = (r: any) => (typeof r === "string" ? r : r.id);
    const note = async (x: number, y: number, width: number, text: string) =>
      id(await person<any>("(p, e, a) => p.create({ kind: 'note', x: a.x, y: a.y, width: a.width, text: a.text })", { x, y, width, text }));
    refs.ring = [];
    for (const [i, [x, y]] of SPOTS.entries()) refs.ring.push(await note(x, y, 240, RING[ORDER[i]]));
    refs.far = await note(1300, 120, 240, DECOY);
    refs.ask = await note(320, 160, 200, "Which of these is cheapest?");
    await person("(p, e, id) => p.select([id])", refs.ask);
    await page.waitForTimeout(200);
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.waitForTimeout(500);
    // The board is what this task claims: the question is in no group of its own (more than 60 px
    // from every card), and the ask is given the ring as its group, not the venue outside it.
    const geo = await person<any>(
      "(p, e, a) => { const q = e.getShapePageBounds(a.ask); const d = (b) => Math.hypot(Math.max(0, b.x - (q.x + q.w), q.x - (b.x + b.w)), Math.max(0, b.y - (q.y + q.h), q.y - (b.y + b.h))); return { sent: !!e.getShape(a.ask)?.meta?.ask?.sent, nearest: Math.min(...a.ring.map((id) => d(e.getShapePageBounds(id)))), inside: a.ring.some((id) => { const b = e.getShapePageBounds(id); return b.y + b.h <= q.y; }) && a.ring.some((id) => { const b = e.getShapePageBounds(id); return b.y >= q.y + q.h; }) }; }",
      { ask: refs.ask, ring: refs.ring },
    );
    if (!geo.sent) throw new Error("the person's question was not sent");
    if (!(geo.nearest > 60) || !geo.inside) throw new Error(`the question is not on empty space inside the ring: ${JSON.stringify(geo)}`);
    const asks = await call("canvas_asks", { state: "all" });
    const ask = (asks.asks ?? []).find((a: any) => a.id === refs.ask);
    const cluster = (ask?.cluster ?? []).map((m: any) => m.id);
    if (!cluster.includes(refs.ring[3])) throw new Error(`the ask is not given the ring's Mill House: ${JSON.stringify(cluster)}`);
    if (cluster.includes(refs.far) || (ask?.targets ?? []).some((t: any) => t.id === refs.far)) throw new Error("the ask is given the venue outside the ring");
    refs.before = await person<any>(
      "(p, e, ids) => ids.map((id) => { const s = e.getShape(id); return { id, parentId: s.parentId, x: Math.round(s.x), y: Math.round(s.y), props: JSON.stringify(s.props) }; })",
      [...refs.ring, refs.far, refs.ask],
    );
  },
  async check({ read, refs, call, person }) {
    const asks = await call("canvas_asks", { state: "all" });
    const ask = (asks.asks ?? []).find((a: any) => a.id === refs.ask);
    if (!ask) return "the ask is gone";
    if (ask.state !== "answered") return `the ask is ${ask.state}`;
    const answers = read.objects.filter((o: any) => o.meta?.replyTo === refs.ask && o.text?.trim());
    if (!answers.length) return "no answer card under the ask";
    const now = await person<any[]>(
      "(p, e, ids) => ids.map((id) => { const s = e.getShape(id); return s ? { id, parentId: s.parentId, x: Math.round(s.x), y: Math.round(s.y), props: JSON.stringify(s.props) } : { id, gone: true }; })",
      refs.before.map((b: any) => b.id),
    );
    for (const b of refs.before) {
      const n = now.find((o: any) => o.id === b.id);
      if (!n || n.gone) return `the person's ${b.id === refs.ask ? "question" : "object"} ${b.id} is gone`;
      if (n.parentId !== b.parentId || n.x !== b.x || n.y !== b.y) return `the person's ${b.id === refs.ask ? "question" : "object"} ${b.id} was moved`;
      if (b.id !== refs.ask && n.props !== b.props) return `the person's object ${b.id} was changed`;
    }
    // Mill House has to be named before any other venue: leading with Station Arches answers about
    // the whole page, not the ring the question was written in.
    const text = answers.map((o: any) => o.text).join("\n").toLowerCase();
    const at = (name: string) => text.indexOf(name.toLowerCase());
    const named = NAMES.filter((n) => at(n) >= 0).sort((a, b) => at(a) - at(b));
    if (!named.length) return `the answer names none of the venues: "${text.slice(0, 120)}"`;
    return named[0] === CHEAPEST ? true : `the answer leads with ${named[0]}, not ${CHEAPEST}: "${text.slice(0, 120)}"`;
  },
  async solution({ call, refs }) {
    await call("canvas_answer", { id: refs.ask, text: "Mill House, at £640: the cheapest of the ten in this ring. Chapel Hall (£870) is next." });
  },
});
