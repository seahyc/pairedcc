import { openMarks, task } from "../task-kit";
export default task({
  id: "12-resolve-marks",
  prompt: "The person left feedback on this page. Reply to each piece of feedback with a short note, then mark each one resolved.",
  async setup({ call, person, refs }) {
    refs.a = await call("canvas_create", { kind: "note", x: 0, y: 0, text: "Option A: weekly digest" });
    refs.b = await call("canvas_create", { kind: "note", x: 500, y: 0, text: "Option B: daily alert" });
    // The person attaches a feedback note to each option (a human annotation, as Comment makes).
    for (const [target, x, text] of [[refs.a.id, 0, "Too much text in A"], [refs.b.id, 500, "B feels pushy"]] as const)
      await person(
        "(p, e, a) => e.createShape({ type: 'card', x: a.x, y: 220, meta: { name: 'Feedback', role: 'annotation', targetId: a.target, status: 'open' }, props: { w: 240, h: 73, tone: 'human', richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: a.text }] }] } } })",
        { x, text, target },
      );
  },
  check({ read, refs }) {
    if ((read.marks ?? []).length < 2) return `setup produced ${(read.marks ?? []).length} mark(s), expected 2`;
    if (openMarks(read).length) return `${openMarks(read).length} open mark(s) remain`;
    const replies = read.objects.filter((o: any) => o.author !== "human" && ![refs.a.id, refs.b.id].includes(o.id) && o.type !== "arrow" && o.text);
    return replies.length >= 2 ? true : `${replies.length} agent repl(ies)`;
  },
  async solution({ call }) {
    const read = await call("canvas_read");
    for (const m of read.marks.filter((m: any) => m.status === "open")) {
      await call("canvas_create", { kind: "note", x: 1000, y: 200 * Math.random(), text: `Noted: ${m.kind} addressed.` });
      await call("canvas_resolve", { id: m.id, expectedRevision: m.revision, status: "resolved" });
    }
  },
});
