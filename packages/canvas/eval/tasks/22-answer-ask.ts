import { task } from "../task-kit";
// The Ask loop (#21): the person selects their note, presses Ask and types a question.
export default task({
  id: "22-answer-ask",
  prompt: "The person is waiting for an answer to a question they asked on the board. Answer it.",
  async setup({ call, page, person, refs }) {
    refs.note = await call("canvas_create", { kind: "note", x: 0, y: 0, text: "Opening hours: 7am to 3pm, weekdays only" });
    await person("(p, e, id) => { p.select([id]); }", refs.note.id);
    await page.getByRole("button", { name: /^Ask/ }).first().click();
    await page.getByLabel("Your question").fill("Should we open on Saturdays too?");
    await page.getByLabel("Your question").press("Enter");
    await page.waitForTimeout(300);
    refs.ask = await person("(p, e) => e.getCurrentPageShapes().find((s) => s.meta.ask)?.id ?? null");
    if (!refs.ask) throw new Error("the person's ask was not created");
  },
  async check({ read, refs, call }) {
    const asks = await call("canvas_asks", { state: "all" });
    const ask = (asks.asks ?? []).find((a: any) => a.id === refs.ask);
    if (!ask) return "the ask is gone";
    if (ask.state !== "answered") return `the ask is ${ask.state}`;
    const answers = read.objects.filter((o: any) => o.meta?.replyTo === refs.ask && o.text?.trim());
    return answers.length ? true : "no answer card under the ask";
  },
  async solution({ call, refs }) {
    await call("canvas_answer", { id: refs.ask, text: "Try Saturdays for a month, 8am to 1pm, and count covers before deciding." });
  },
});
