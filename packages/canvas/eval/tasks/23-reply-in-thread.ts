import { task } from "../task-kit";
// Comment threads in the feedback queue: the person comments with C; the agent's answer must be
// threaded under that comment in the queue, not left as a loose note.
export default task({
  id: "23-reply-in-thread",
  prompt: "The person commented on the price options asking which is cheapest. Answer them in that comment's thread with the cheapest option, then close the comment.",
  async setup({ call, page, person, refs }) {
    refs.a = await call("canvas_create", { kind: "rectangle", x: 0, y: 0, text: "Option A: $120 a month" });
    refs.b = await call("canvas_create", { kind: "rectangle", x: 320, y: 0, text: "Option B: $90 a month" });
    refs.c = await call("canvas_create", { kind: "rectangle", x: 640, y: 0, text: "Option C: $150 a month" });
    await person("(p, e, ids) => { p.select(ids); }", [refs.a.id, refs.b.id, refs.c.id]);
    await page.keyboard.press("c");
    await page.waitForTimeout(300);
    await page.keyboard.type("Which one is cheapest?");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const queue = await call("canvas_feedback", { status: "open" });
    refs.comment = queue.items.find((i: any) => i.kind === "comment")?.id;
    if (!refs.comment) throw new Error("the person's comment was not created");
  },
  async check({ refs, call }) {
    const queue = await call("canvas_feedback", { status: "all" });
    const item = queue.items.find((i: any) => i.id === refs.comment);
    if (!item) return "the comment is gone";
    const answered = (item.replies ?? []).some((r: any) => /\bB\b|\$90/.test(r.text));
    if (!answered) return `no threaded reply naming option B (${(item.replies ?? []).length} replies)`;
    return item.status === "resolved" ? true : "the comment is still open";
  },
  async solution({ call, refs }) {
    const replied = await call("canvas_reply", { id: refs.comment, text: "Option B, at $90 a month." });
    await call("canvas_resolve", { id: refs.comment, expectedRevision: replied.item.revision, status: "resolved" });
  },
});
