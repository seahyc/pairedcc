import { one, task } from "../task-kit";
export default task({
  id: "05-retext",
  prompt: 'Change the text of the box that says "Draft" to "Final". Edit that box; do not replace it.',
  async setup({ call, refs }) {
    refs.r = await call("canvas_create", { kind: "rectangle", x: 0, y: 0, width: 200, height: 120, text: "Draft" });
  },
  check({ read, refs }) {
    const r = one(read, refs.r.id);
    if (!r) return "the original box is gone";
    return r.text === "Final" ? true : `box says ${JSON.stringify(r.text)}`;
  },
  async solution({ call, refs }) {
    const r = await call("canvas_get", { id: refs.r.id });
    await call("canvas_update", { id: refs.r.id, expectedRevision: r.revision, text: "Final" });
  },
});
