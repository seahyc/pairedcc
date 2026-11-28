import { task } from "../task-kit";
// #165 (finding 6, comparing beats describing): options laid out on stated dimensions. The person
// has two pricing ideas on the board and asks to see them side by side on the two things they care
// about. The check passes only when the answer is lettered options whose cards list the same
// dimensions in the same order, one short value each, covering cost and risk: two options
// described in prose, or one card comparing them, fail.
export default task({
  id: "29-compare-on-dimensions",
  prompt: "The person is waiting for an answer to a question they wrote on the board. Answer it.",
  async setup({ page, person, refs }) {
    const make = (x: number, y: number, text: string) =>
      person<any>("(p, e, a) => p.create({ kind: 'note', x: a.x, y: a.y, width: 240, text: a.text })", { x, y, text }).then((r) => (typeof r === "string" ? r : r.id));
    refs.ideas = [
      await make(0, 0, "Charge per seat: £8 a month for each recruiter on the account"),
      await make(280, 0, "Charge per job post: £30 a post, capped at £300 a month"),
    ];
    // The question goes 40 px under the taller idea, as a person writes it under the row (#129:
    // the person's notes are cards at the width asked for, so their height follows their words).
    const under = await person<number>("(p, e, ids) => Math.max(...ids.map((id) => e.getShapePageBounds(id).maxY))", refs.ideas);
    refs.ask = await make(0, Math.round(under) + 40, "Seat or job post: which should we test first? Put them side by side on what it costs us to try and how risky it is.");
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
    const options = answers.filter((o: any) => o.meta?.option).sort((a: any, b: any) => String(a.meta.option).localeCompare(String(b.meta.option)));
    if (options.length < 2) return `the answer is ${answers.length} card(s), not two or more options side by side`;
    // Each option card: "A · headline", then one "Dimension: value" paragraph per stated
    // dimension. read joins a card's paragraphs, so they come from canvas_get's rich text.
    const paragraphs = (doc: any): string[] =>
      (doc?.content ?? []).map((p: any) => (p.content ?? []).map((t: any) => t.text ?? "").join("").trim()).filter(Boolean);
    const parsed = [];
    for (const o of options) {
      const got = await call("canvas_get", { id: o.id });
      const [head = "", ...lines] = paragraphs((got.object ?? got).props?.richText);
      const rows = lines.map((l: string) => /^([^:]{1,40}):\s*(.+)$/.exec(l)).filter(Boolean) as RegExpExecArray[];
      parsed.push({ head, names: rows.map((r) => r[1].trim()), values: rows.map((r) => r[2].trim()) });
    }
    const names = parsed[0].names;
    if (names.length < 2) return `option ${options[0].meta.option} lists ${names.length} dimension line(s): "${options[0].text.slice(0, 120)}"`;
    for (const [i, p] of parsed.entries())
      if (p.names.join("|") !== names.join("|")) return `option ${options[i].meta.option}'s dimensions (${p.names.join(", ")}) do not line up with ${names.join(", ")}`;
    if (!names.some((n) => /cost|effort|price|spend/i.test(n))) return `no dimension is about what it costs to try (${names.join(", ")})`;
    if (!names.some((n) => /risk/i.test(n))) return `no dimension is about risk (${names.join(", ")})`;
    const heads = parsed.map((p) => p.head.toLowerCase()).join(" ");
    if (!/seat/.test(heads) || !/post/.test(heads)) return `the options are not the person's two ideas: ${parsed.map((p) => p.head).join(" / ")}`;
    return true;
  },
  async solution({ call, refs }) {
    await call("canvas_answer", {
      id: refs.ask,
      alternatives: ["Charge per seat", "Charge per job post, capped"],
      dimensions: ["Cost to try", "Risk"],
      values: [
        ["Low: one billing setting", "Teams cut seats when hiring slows"],
        ["Medium: count posts and build the cap", "Lumpy monthly revenue"],
      ],
    });
  },
});
