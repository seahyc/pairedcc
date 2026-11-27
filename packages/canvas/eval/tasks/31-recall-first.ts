import { task } from "../task-kit";
// #149 (P5 part 2): a thought the person settled and checked themselves on carries `meta.recall`
// (`step`, `due`) and comes back at the board's edge when due. AGENT_API: "Leave `recall` alone;
// it is the person's schedule." The person asks which of their settled thoughts comes back first.
// The agent passes by answering with the one due soonest, named before the other, and leaving
// every schedule as it was.
const DAY = 24 * 60 * 60 * 1000;
export default task({
  id: "31-recall-first",
  prompt: "The person is waiting for an answer to a question they wrote on the board. Answer it.",
  async setup({ page, person, refs }) {
    const now = Date.now();
    const thoughts = [
      { text: "Hire for writing skill first", recall: { step: 1, due: now + 5 * DAY } },
      { text: "Pay the same band for the same role", recall: { step: 0, due: now + 1 * DAY } },
      { text: "Interview in pairs" },
    ];
    refs.thoughts = [];
    for (const [i, t] of thoughts.entries()) {
      const id = await person<string>(
        "(p, e, a) => { const r = p.create({ kind: 'note', x: a.x, y: 0, width: 240, text: a.text }); const id = typeof r === 'string' ? r : r.id; const s = e.getShape(id); e.updateShape({ id, type: s.type, meta: { ...s.meta, settled: true, settledAt: Date.now(), ...(a.recall ? { recall: a.recall } : {}) } }); return id; }",
        { x: i * 280, text: t.text, recall: t.recall },
      );
      refs.thoughts.push({ id, text: t.text, recall: t.recall ?? null });
    }
    const made = await person<any>("(p) => p.create({ kind: 'note', x: 0, y: 200, width: 300, text: 'Which of my settled thoughts comes back for review first?' })");
    refs.ask = typeof made === "string" ? made : made.id;
    await person("(p, e, id) => p.select([id])", refs.ask);
    await page.waitForTimeout(200);
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.waitForTimeout(500);
    const sent = await person("(p, e, id) => !!e.getShape(id)?.meta?.ask?.sent", refs.ask);
    if (!sent) throw new Error("the person's question was not sent");
  },
  async check({ read, refs, call }) {
    for (const t of refs.thoughts) {
      const o = read.objects.find((x: any) => x.id === t.id);
      if (!o) return `"${t.text}" is gone`;
      if (o.meta?.settled !== true) return `"${t.text}" is no longer settled`;
      if (JSON.stringify(o.meta?.recall ?? null) !== JSON.stringify(t.recall)) return `the review schedule of "${t.text}" was changed: ${JSON.stringify(o.meta?.recall ?? null)}`;
    }
    const asks = await call("canvas_asks", { state: "all" });
    const ask = (asks.asks ?? []).find((a: any) => a.id === refs.ask);
    if (!ask) return "the ask is gone";
    if (ask.state !== "answered") return `the ask is ${ask.state}`;
    const text = read.objects.filter((o: any) => o.meta?.replyTo === refs.ask).map((o: any) => o.text ?? "").join("\n").toLowerCase();
    const at = (s: string) => text.indexOf(s);
    const first = at("same band"), second = at("writing skill");
    if (first < 0) return `the answer does not name "Pay the same band for the same role": "${text.slice(0, 160)}"`;
    if (second >= 0 && second < first) return `the answer leads with the thought due in five days: "${text.slice(0, 160)}"`;
    return true;
  },
  async solution({ call, refs }) {
    await call("canvas_answer", { id: refs.ask, text: "\"Pay the same band for the same role\" comes back first, tomorrow; \"Hire for writing skill first\" in five days." });
  },
});
