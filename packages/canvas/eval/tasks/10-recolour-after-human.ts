import { one, task } from "../task-kit";
export default task({
  id: "10-recolour-after-human",
  prompt: 'Make the box labelled "Budget" green. The person may have just edited it; keep their changes.',
  async setup({ call, person, refs }) {
    refs.r = await call("canvas_create", { kind: "rectangle", x: 0, y: 0, width: 220, height: 120, text: "Budget" });
    await person("(p, e, id) => { const o = p.read().objects.find(o => o.id === id); p.update({ id, expectedRevision: o.revision, text: 'Budget (person: check Q3)', x: 60 }); }", refs.r.id);
  },
  check({ read, refs }) {
    const r = one(read, refs.r.id);
    if (!r) return "the box is gone";
    if (r.props?.color !== "green") return `colour is ${r.props?.color}`;
    return r.text === "Budget (person: check Q3)" && r.x === 60 ? true : "the person's edit was lost";
  },
  async solution({ call, refs }) {
    const r = await call("canvas_get", { id: refs.r.id });
    await call("canvas_update", { id: refs.r.id, expectedRevision: r.revision, color: "green" });
  },
});
