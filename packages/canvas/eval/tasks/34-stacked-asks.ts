import { task } from "../task-kit";
// #182 (item 132): answers to questions written close under each other stay with their own
// question, and nothing an answer adds lands over the other question. The person compared two
// printers and wrote two questions, one straight under the other: "Which is cheaper per page?"
// and "Which prints faster?". Both are waiting. The agent passes by answering each question
// with its own answer (Inkwell for the first, Laserline for the second), every answer card
// clear of both questions, and the person's objects where and as they were.
const CARDS = [
  { x: 0, y: 0, text: "Inkwell 300: 2p a page, 18 pages a minute" },
  { x: 300, y: 0, text: "Laserline X: 4p a page, 40 pages a minute" },
];

const leadsWith = (text: string, want: string, other: string) => {
  const a = text.toLowerCase().indexOf(want.toLowerCase()), b = text.toLowerCase().indexOf(other.toLowerCase());
  return a >= 0 && (b < 0 || a < b);
};
const overlaps = (p: any, q: any) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;

export default task({
  id: "34-stacked-asks",
  prompt: "The person has written questions on the board and is waiting for answers. Answer them.",
  async setup({ page, person, refs, call }) {
    const id = (r: any) => (typeof r === "string" ? r : r.id);
    const note = async (x: number, y: number, width: number, text: string) =>
      id(await person<any>("(p, e, a) => p.create({ kind: 'note', x: a.x, y: a.y, width: a.width, text: a.text })", { x, y, width, text }));
    refs.cards = [];
    for (const c of CARDS) refs.cards.push(await note(c.x, c.y, 260, c.text));
    const send = async (qid: string) => {
      await person("(p, e, id) => p.select([id])", qid);
      await page.waitForTimeout(200);
      await page.keyboard.press("ControlOrMeta+Enter");
      await page.waitForTimeout(500);
    };
    refs.cost = await note(0, 160, 300, "Which is cheaper per page?");
    await send(refs.cost);
    // The second question is written right under the first, before anything answers it.
    const below = await person<any>("(p, e, id) => { const b = e.getShapePageBounds(id); return Math.round(b.y + b.h); }", refs.cost);
    refs.speed = await note(0, below + 24, 300, "Which prints faster?");
    await send(refs.speed);
    const asks = await call("canvas_asks", { state: "all" });
    const state = (qid: string) => (asks.asks ?? []).find((a: any) => a.id === qid)?.state;
    if (state(refs.cost) !== "waiting" || state(refs.speed) !== "waiting") throw new Error(`both questions should be waiting: ${state(refs.cost)}, ${state(refs.speed)}`);
    refs.before = await person<any>(
      "(p, e, ids) => ids.map((id) => { const s = e.getShape(id); return { id, parentId: s.parentId, x: Math.round(s.x), y: Math.round(s.y), props: JSON.stringify(s.props) }; })",
      [...refs.cards, refs.cost, refs.speed],
    );
  },
  async check({ read, refs, call, person }) {
    const asks = await call("canvas_asks", { state: "all" });
    for (const [qid, name] of [[refs.cost, "cheaper"], [refs.speed, "faster"]] as const) {
      const ask = (asks.asks ?? []).find((a: any) => a.id === qid);
      if (!ask) return `the "${name}" question's ask is gone`;
      if (ask.state !== "answered") return `the "${name}" question is ${ask.state}`;
    }
    const answersTo = (qid: string) => read.objects.filter((o: any) => o.meta?.replyTo === qid && o.text?.trim());
    const cost = answersTo(refs.cost), speed = answersTo(refs.speed);
    if (!cost.length) return 'no answer card under "Which is cheaper per page?"';
    if (!speed.length) return 'no answer card under "Which prints faster?"';
    const costText = cost.map((o: any) => o.text).join("\n"), speedText = speed.map((o: any) => o.text).join("\n");
    if (!leadsWith(costText, "Inkwell", "Laserline")) return `the "cheaper" answer does not lead with Inkwell: "${costText.slice(0, 120)}"`;
    if (!leadsWith(speedText, "Laserline", "Inkwell")) return `the "faster" answer does not lead with Laserline: "${speedText.slice(0, 120)}"`;
    // Nothing the agent added covers either question.
    const questions = read.objects.filter((o: any) => o.id === refs.cost || o.id === refs.speed);
    const added = read.objects.filter((o: any) => o.author !== "Human" && o.type !== "arrow" && o.bounds);
    for (const a of added) for (const q of questions) if (q.bounds && overlaps(a.bounds, q.bounds)) return `the agent's "${(a.text ?? a.id).slice(0, 40)}" covers the question "${q.text}"`;
    const now = await person<any[]>(
      "(p, e, ids) => ids.map((id) => { const s = e.getShape(id); return s ? { id, parentId: s.parentId, x: Math.round(s.x), y: Math.round(s.y), props: JSON.stringify(s.props) } : { id, gone: true }; })",
      refs.before.map((b: any) => b.id),
    );
    const isQuestion = (id: string) => id === refs.cost || id === refs.speed;
    for (const b of refs.before) {
      const n = now.find((o: any) => o.id === b.id);
      if (!n || n.gone) return `the person's ${isQuestion(b.id) ? "question" : "card"} ${b.id} is gone`;
      if (n.parentId !== b.parentId || n.x !== b.x || n.y !== b.y) return `the person's ${isQuestion(b.id) ? "question" : "card"} ${b.id} was moved`;
      if (!isQuestion(b.id) && n.props !== b.props) return `the person's card ${b.id} was changed`;
    }
    return true;
  },
  async solution({ call, refs }) {
    await call("canvas_answer", { id: refs.cost, text: "Inkwell 300: 2p a page against Laserline's 4p." });
    await call("canvas_answer", { id: refs.speed, text: "Laserline X: 40 pages a minute, more than twice Inkwell's 18." });
  },
});
