import { task } from "../task-kit";
export default task({
  id: "18-delete-one",
  prompt: 'Remove the note that says "duplicate". Leave the other notes alone.',
  async setup({ call, refs }) {
    refs.ids = [];
    for (const [i, t] of ["Keep: churn data", "duplicate", "Keep: survey", "Keep: interviews"].entries())
      refs.ids.push((await call("canvas_create", { kind: "note", x: i * 300, y: 0, text: t })).id);
  },
  check({ read, refs }) {
    const present = refs.ids.map((id: string) => read.objects.some((o: any) => o.id === id));
    if (present[1]) return "the duplicate note is still there";
    return present[0] && present[2] && present[3] ? true : "another note was removed";
  },
  async solution({ call, refs }) {
    const o = await call("canvas_get", { id: refs.ids[1] });
    await call("canvas_remove", { id: o.id, expectedRevision: o.revision });
  },
});
