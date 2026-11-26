import { byText, gap, task } from "../task-kit";
export default task({
  id: "06-picked-done",
  prompt: 'The person has picked one of the three tagline options. Put a note starting with "Done:" right next to the picked option that names it.',
  async setup({ call, person, refs }) {
    for (const [k, t, x] of [["a", "Slow mornings", 0], ["b", "Good coffee, no rush", 400], ["c", "Your corner table", 800]] as const)
      refs[k] = await call("canvas_create", { kind: "note", x, y: 0, text: t });
    await person("(p, e, id) => { p.select([id]); }", refs.b.id);
    await person("(p, e, id) => { const s = e.getShape(id); e.updateShape({ id, type: s.type, meta: { ...s.meta, mark: 'picked' } }); }", refs.b.id);
  },
  check({ read, refs }) {
    const done = byText(read, /^\s*done:/i);
    if (!done.length) return "no Done: note";
    const picked = read.objects.find((o: any) => o.id === refs.b.id);
    const ok = done.find((d: any) => /good coffee, no rush/i.test(d.text) && gap(d, picked) <= 200);
    return ok ? true : "no Done: note naming the picked option within 200 px of it";
  },
  async solution({ call, refs }) {
    const b = await call("canvas_get", { id: refs.b.id });
    await call("canvas_create", { kind: "note", x: b.bounds.x, y: b.bounds.y + b.bounds.h + 40, text: 'Done: going with "Good coffee, no rush".' });
  },
});
