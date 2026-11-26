import { one, task } from "../task-kit";
export default task({
  id: "21-undo-run",
  prompt: 'One of your earlier operations on this canvas turned the "Plan" box red by mistake. Take back just that operation. The person has moved the box since; keep their move.',
  async setup({ call, person, refs }) {
    refs.r = await call("canvas_create", { kind: "rectangle", x: 0, y: 0, width: 220, height: 120, text: "Plan", color: "blue" });
    const r = await call("canvas_get", { id: refs.r.id });
    await call("canvas_update", { id: refs.r.id, expectedRevision: r.revision, color: "red" });
    await person("(p, e, id) => { const o = p.read().objects.find(o => o.id === id); p.update({ id, expectedRevision: o.revision, x: 300 }); }", refs.r.id);
  },
  check({ read, refs }) {
    const r = one(read, refs.r.id);
    if (!r) return "the box is gone";
    if (r.props?.color === "red") return "still red";
    if (r.props?.color !== "blue") return `colour is ${r.props?.color}, not back to blue`;
    return r.x === 300 ? true : "the person's move was lost";
  },
  async solution({ call, refs }) {
    const runs = await call("canvas_runs", {});
    const run = (runs.runs ?? runs).find((x: any) => x.op === "update" && (x.updated ?? []).includes(refs.r.id));
    await call("canvas_undo_run", { runId: run.runId });
  },
});
