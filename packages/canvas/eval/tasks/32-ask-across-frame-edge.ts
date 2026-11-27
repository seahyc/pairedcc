import { task } from "../task-kit";
// #155 (item 113): a card the person writes across a frame's edge would be cut off by the frame,
// so it is lifted onto the page where it is (`meta.within` names the frame it still goes with),
// and a question lifted that way keeps the frame as its context. AGENT_API: an ask's `frame` is
// "the frame the selection sits in". The person wrote "Which of these quotes is cheapest?" over
// the bottom-right edge of their "Kitchen quotes" frame. In `canvas_read` the question now sits on
// the page, and a cheaper quote for a different job lies on the page to the right; the agent
// passes by answering about the frame's quotes (Brook & Sons first) and leaving every one of the
// person's objects where and as they were, the question still out of the frame so nothing of it
// is cut off.
const QUOTES = ["Oakline Joinery", "Brook & Sons", "Fennick Kitchens", "Tilewell"] as const;
const CHEAPEST = "Brook & Sons";
export default task({
  id: "32-ask-across-frame-edge",
  prompt: "The person is waiting for an answer to a question they wrote on the board. Answer it.",
  async setup({ page, person, refs }) {
    const id = (r: any) => (typeof r === "string" ? r : r.id);
    refs.frame = id(await person<any>("(p) => p.create({ kind: 'frame', x: 0, y: 0, width: 620, height: 360, name: 'Kitchen quotes' })"));
    // Cards the person wrote inside the frame, then the question over its bottom-right edge.
    const inFrame = async (x: number, y: number, width: number, text: string) =>
      id(
        await person<any>(
          "(p, e, a) => { const r = p.create({ kind: 'note', x: a.x, y: a.y, width: a.width, text: a.text }); const id = typeof r === 'string' ? r : r.id; e.reparentShapes([id], a.frame); return id; }",
          { x, y, width, text, frame: refs.frame },
        ),
      );
    refs.quotes = [
      await inFrame(30, 50, 170, "Oakline Joinery: £8,400, fitted in six weeks"),
      await inFrame(220, 50, 170, "Brook & Sons: £7,250, fitted in ten weeks"),
      await inFrame(410, 50, 170, "Fennick Kitchens: £9,100, fitted in four weeks"),
    ];
    refs.ask = await inFrame(400, 300, 260, "Which of these quotes is cheapest?");
    // On the page, well clear of the frame and the question: a cheaper quote for another job.
    refs.far = id(await person<any>("(p) => p.create({ kind: 'note', x: 820, y: 120, width: 220, text: 'Tilewell: £3,900 to retile the bathroom' })"));
    await person("(p, e, id) => p.select([id])", refs.ask);
    await page.waitForTimeout(200);
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.waitForTimeout(500);
    const state = await person<any>(
      "(p, e, a) => { const s = e.getShape(a.ask); return { sent: !!s?.meta?.ask?.sent, onPage: s?.parentId === e.getCurrentPageId(), within: s?.meta?.within ?? null, frame: s?.meta?.ask?.frame ?? null }; }",
      { ask: refs.ask },
    );
    if (!state.sent) throw new Error("the person's question was not sent");
    if (!state.onPage || state.within !== refs.frame) throw new Error(`the question was not lifted out of the frame: ${JSON.stringify(state)}`);
    // Every one of the person's objects as it stands now, to tell later whether the agent moved
    // or changed any (the question's revision moves with its ask state, so only its place counts).
    refs.before = await person<any>(
      "(p, e, ids) => ids.map((id) => { const s = e.getShape(id); return { id, parentId: s.parentId, x: Math.round(s.x), y: Math.round(s.y), props: JSON.stringify(s.props) }; })",
      [refs.frame, ...refs.quotes, refs.far, refs.ask],
    );
  },
  async check({ read, refs, call, person }) {
    const asks = await call("canvas_asks", { state: "all" });
    const ask = (asks.asks ?? []).find((a: any) => a.id === refs.ask);
    if (!ask) return "the ask is gone";
    if (ask.state !== "answered") return `the ask is ${ask.state}`;
    const answers = read.objects.filter((o: any) => o.meta?.replyTo === refs.ask && o.text?.trim());
    if (!answers.length) return "no answer card under the ask";
    // The person's objects are where and as they left them; the question stays out of the frame.
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
    // The answer has to name Brook & Sons before any other quote: leading with Tilewell answers
    // about the page around the question, not the frame it was written in.
    const text = answers.map((o: any) => o.text).join("\n").toLowerCase();
    // Each quote is found by its first word ("Brook" for "Brook & Sons" or "Brook and Sons").
    const at = (name: string) => text.indexOf(name.toLowerCase().split(" ")[0]);
    const named = QUOTES.filter((q) => at(q) >= 0).sort((a, b) => at(a) - at(b));
    if (!named.length) return `the answer names none of the quotes: "${text.slice(0, 120)}"`;
    return named[0] === CHEAPEST ? true : `the answer leads with ${named[0]}, not ${CHEAPEST}: "${text.slice(0, 120)}"`;
  },
  async solution({ call, refs }) {
    await call("canvas_answer", { id: refs.ask, text: "Brook & Sons, at £7,250, though it takes the longest to fit (ten weeks)." });
  },
});
