import { task } from "../task-kit";
// P2 (#135, #140): an ask written on the empty space at the end of a row of the person's cards is
// about that row. A card far away on the same page would be the wrong answer if the agent read
// the whole board instead of the group the question sits in.
const PLACES = ["Harbour Street", "Mill Lane", "Station Road", "Kiln Yard"] as const;
const LOWEST = "Mill Lane";
export default task({
  id: "27-ask-about-the-group",
  prompt: "The person is waiting for an answer to a question they wrote on the board. Answer it.",
  async setup({ page, person, refs }) {
    const make = (x: number, y: number, text: string) =>
      person<any>("(p, e, a) => p.create({ kind: 'note', x: a.x, y: a.y, width: 220, text: a.text })", { x, y, text }).then((r) => (typeof r === "string" ? r : r.id));
    refs.row = [
      await make(0, 0, "Harbour Street: rent £2,100 a month, parking for two vans"),
      await make(260, 0, "Mill Lane: rent £1,650 a month, no parking"),
      await make(520, 0, "Station Road: rent £1,900 a month, shared loading bay"),
    ];
    refs.far = await make(1800, 900, "Kiln Yard: rent £900 a month (let to someone else last week)");
    refs.ask = await make(780, 0, "Which of these has the lowest rent?");
    await person("(p, e, id) => p.select([id])", refs.ask);
    await page.waitForTimeout(200);
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.waitForTimeout(500);
    const sent = await person("(p, e, id) => !!e.getShape(id)?.meta?.ask?.sent", refs.ask);
    if (!sent) throw new Error("the person's question was not sent");
  },
  async check({ read, refs, call }) {
    const asks = await call("canvas_asks", { state: "all" });
    const ask = (asks.asks ?? []).find((a: any) => a.id === refs.ask);
    if (!ask) return "the ask is gone";
    if (ask.state !== "answered") return `the ask is ${ask.state}`;
    const answers = read.objects.filter((o: any) => o.meta?.replyTo === refs.ask && o.text?.trim());
    if (!answers.length) return "no answer card under the ask";
    // The answer has to name Mill Lane before any other place: naming Kiln Yard first answers
    // about the whole board, not the row the person wrote under.
    const text = answers.map((o: any) => o.text).join("\n");
    const at = (name: string) => text.toLowerCase().indexOf(name.toLowerCase());
    const named = PLACES.filter((p) => at(p) >= 0).sort((a, b) => at(a) - at(b));
    if (!named.length) return `the answer names none of the places: "${text.slice(0, 120)}"`;
    return named[0] === LOWEST ? true : `the answer leads with ${named[0]}, not ${LOWEST}: "${text.slice(0, 120)}"`;
  },
  async solution({ call, refs }) {
    await call("canvas_answer", { id: refs.ask, text: "Mill Lane, at £1,650 a month, though it has no parking." });
  },
});
