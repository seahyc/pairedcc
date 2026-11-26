import { one, task } from "../task-kit";
export default task({
  id: "02-arrange-row",
  prompt: 'Line up the notes "Alpha", "Beta" and "Gamma" in a single row, in that order from left to right, top edges aligned.',
  async setup({ call, refs }) {
    refs.a = await call("canvas_create", { kind: "note", x: 500, y: 300, text: "Alpha" });
    refs.b = await call("canvas_create", { kind: "note", x: 0, y: 0, text: "Beta" });
    refs.c = await call("canvas_create", { kind: "note", x: 250, y: 600, text: "Gamma" });
  },
  check({ read, refs }) {
    const [a, b, c] = [refs.a, refs.b, refs.c].map((r) => one(read, r.id));
    if (!a || !b || !c) return "a note is missing";
    if (Math.abs(a.bounds.y - b.bounds.y) > 2 || Math.abs(b.bounds.y - c.bounds.y) > 2) return "top edges are not aligned";
    return a.bounds.x + a.bounds.w <= b.bounds.x && b.bounds.x + b.bounds.w <= c.bounds.x ? true : "not in left-to-right order without overlap";
  },
  async solution({ call, refs }) {
    const read = await call("canvas_read");
    const objects = [refs.a, refs.b, refs.c].map((r) => ({ id: r.id, expectedRevision: read.objects.find((o: any) => o.id === r.id).revision }));
    await call("canvas_arrange", { objects, layout: "row", x: 0, y: 0 });
  },
});
