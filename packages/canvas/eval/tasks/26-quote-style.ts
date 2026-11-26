import { gap, objs, one, task } from "../task-kit";
// Card style in read (#51): which card is a quote is visible in `read` without opening each card.
// Written by a lane that did not build #51.
export default task({
  id: "26-quote-style",
  prompt: 'One card on this page is styled as a quote. Put a short note saying "source?" right beside that card, and nowhere else.',
  async setup({ call, refs }) {
    refs.heading = await call("canvas_create", { kind: "note", x: 0, y: 0, width: 260, text: "Findings", style: "heading" });
    refs.note = await call("canvas_create", { kind: "note", x: 0, y: 220, width: 260, text: "Export usage is low", style: "note" });
    refs.quote = await call("canvas_create", { kind: "note", x: 420, y: 220, width: 260, text: "The export button was impossible to find", style: "quote" });
    refs.other = await call("canvas_create", { kind: "note", x: 840, y: 220, width: 260, text: "Most teams export monthly", style: "note" });
  },
  check({ read, refs }) {
    const cards = ["heading", "note", "quote", "other"].map((k) => one(read, refs[k].id));
    if (cards.some((c) => !c)) return "one of the original cards is gone";
    const notes = objs(read).filter((o) => /source\?/i.test(o.text ?? "") && !cards.some((c) => c.id === o.id));
    if (notes.length !== 1) return `${notes.length} "source?" notes`;
    const [n] = notes, quote = cards[2];
    const d = gap(n, quote);
    if (d > 200) return `the note is ${Math.round(d)} away from the quote`;
    const nearer = cards.filter((c) => c.id !== quote.id && gap(n, c) < d);
    if (nearer.length) return `the note is nearer to ${JSON.stringify(nearer[0].text)} than to the quote`;
    return cards.every((c, i) => c.text === ["Findings", "Export usage is low", "The export button was impossible to find", "Most teams export monthly"][i]) ? true : "a card's text changed";
  },
  async solution({ call, refs }) {
    const q = await call("canvas_get", { id: refs.quote.id });
    await call("canvas_create", { kind: "note", x: q.x, y: q.y + (q.bounds?.h ?? q.height ?? 200) + 30, width: 160, text: "source?" });
  },
});
