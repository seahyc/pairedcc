import { byText, gap, one, task } from "../task-kit";
export default task({
  id: "11-locked",
  prompt: 'Move the "Reference" box 200 px to the right. If that is not possible, leave a note next to it saying why.',
  async setup({ call, person, refs }) {
    refs.r = await call("canvas_create", { kind: "rectangle", x: 0, y: 0, width: 220, height: 120, text: "Reference" });
    await person("(p, e, id) => { e.updateShape({ id, type: 'geo', isLocked: true }); }", refs.r.id);
  },
  check({ read, refs }) {
    const r = one(read, refs.r.id);
    if (!r) return "the box is gone";
    if (r.x === 200) return true;
    const note = byText(read, /lock/i).find((n: any) => n.id !== r.id && gap(n, r) <= 200);
    return note ? true : "not moved and no note within 200 px explaining it is locked";
  },
  async solution({ call, refs }) {
    const r = await call("canvas_get", { id: refs.r.id });
    await call("canvas_create", { kind: "note", x: r.bounds.x, y: r.bounds.y + r.bounds.h + 40, text: "I could not move Reference: it is locked. Unlock it if you want it moved." });
  },
});
