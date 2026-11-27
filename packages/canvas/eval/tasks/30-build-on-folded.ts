import { task } from "../task-kit";
// #144 (P1, few things in view): a finished thread folds to one line, and `read`/`overview` say
// `folded: true`. AGENT_API: "Treat a folded thread as decided; build on its pick rather than
// reopening it unless asked." The person asked where the offsite should be, an earlier agent
// offered three places, the person picked Kraków and the thread folded. Asked to announce the
// offsite, the agent passes only by naming the pick and leaving the thread as it is: no second
// answer, no new options, no other place in the note.
const PLACES = ["Lisbon", "Kraków", "Edinburgh"];
export default task({
  id: "30-build-on-folded",
  prompt: "Write a one-line note on this page telling the team where the offsite will be.",
  async setup({ call, page, person, refs }) {
    const made = await person<any>("(p, e) => p.create({ kind: 'note', x: 0, y: 0, width: 260, text: 'Where should the team offsite be?' })");
    refs.ask = typeof made === "string" ? made : made.id;
    await person("(p, e, id) => p.select([id])", refs.ask);
    await page.waitForTimeout(200);
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.waitForTimeout(500);
    const answer = await call("canvas_answer", {
      id: refs.ask,
      alternatives: ["Lisbon: direct flights for everyone", "Kraków: the cheapest venue, two-hour flights", "Edinburgh: no flights for the UK team"],
    });
    const read = await call("canvas_read");
    const options = read.objects.filter((o: any) => o.meta?.replyTo === refs.ask && o.meta?.option);
    refs.options = options.map((o: any) => o.id);
    refs.picked = options.find((o: any) => o.meta.option === "B")?.id;
    if (!refs.picked) throw new Error(`no option B: ${JSON.stringify(answer).slice(0, 200)}`);
    // The person picks B (P) and moves on; the finished thread folds.
    await person("(p, e, id) => p.select([id])", refs.picked);
    await page.waitForTimeout(200);
    await page.keyboard.press("p");
    await page.waitForTimeout(200);
    await person("(p) => p.select([])");
    await page.waitForTimeout(300);
    const after = await call("canvas_read");
    const ask = after.objects.find((o: any) => o.id === refs.ask);
    if (!ask?.folded) throw new Error(`the thread did not fold: ${JSON.stringify(ask?.folded)}`);
    if (after.objects.find((o: any) => o.id === refs.picked)?.meta?.mark !== "picked") throw new Error("option B is not picked");
  },
  async check({ read, refs }) {
    const ask = read.objects.find((o: any) => o.id === refs.ask);
    if (!ask) return "the person's question is gone";
    const replies = read.objects.filter((o: any) => o.meta?.replyTo === refs.ask);
    if (replies.length !== refs.options.length) return `the thread was reopened: ${replies.length} answers under the question, not ${refs.options.length}`;
    if (read.objects.find((o: any) => o.id === refs.picked)?.meta?.mark !== "picked") return "the person's pick (Kraków) is no longer picked";
    if (!ask.folded) return "the thread is no longer folded";
    const notes = read.objects.filter(
      (o: any) => o.type === "card" && o.author !== "Human" && !o.meta?.replyTo && !o.meta?.seed && o.id !== refs.ask && /krak/i.test(o.text ?? ""),
    );
    if (!notes.length) return "no note of the agent's names Kraków";
    const other = notes.find((o: any) => PLACES.some((p) => p !== "Kraków" && (o.text ?? "").includes(p)));
    return other ? `the note names another place too: "${other.text}"` : true;
  },
  async solution({ call }) {
    await call("canvas_create", { kind: "note", x: 0, y: -160, width: 320, text: "The team offsite will be in Kraków." });
  },
});
