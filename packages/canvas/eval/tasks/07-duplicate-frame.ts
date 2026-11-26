import { task } from "../task-kit";
export default task({
  id: "07-duplicate-frame",
  prompt: 'Make a copy of the "Research" frame, with everything inside it, to the right of the original. Keep the original where it is.',
  async setup({ call, refs }) {
    const s = await call("canvas_scene", {
      name: "Research frame",
      nodes: [
        { key: "f", shape: { kind: "frame", x: 0, y: 0, width: 600, height: 400, name: "Research" } },
        { key: "n1", parentKey: "f", shape: { kind: "note", x: 40, y: 80, text: "Observation" } },
        { key: "n2", parentKey: "f", shape: { kind: "note", x: 320, y: 80, text: "Question" } },
      ],
    });
    refs.scene = s;
    refs.frameId = (s.objects ?? s.created ?? []).find?.((o: any) => o.key === "f")?.id ?? s.keys?.f?.id ?? s.ids?.f;
  },
  check({ read, refs }) {
    const frames = read.objects.filter((o: any) => o.type === "frame" && /research/i.test(o.name ?? o.text ?? ""));
    if (frames.length < 2) return `${frames.length} Research frame(s)`;
    const original = frames.find((f: any) => f.id === refs.frameId) ?? frames.sort((a: any, b: any) => a.x - b.x)[0];
    if (original.x !== 0 || original.y !== 0) return "the original frame moved";
    const copy = frames.find((f: any) => f.id !== original.id && f.bounds.x >= original.bounds.x + original.bounds.w);
    if (!copy) return "no copy to the right of the original";
    const kids = read.objects.filter((o: any) => o.parentId === copy.id);
    return kids.length === 2 ? true : `the copy has ${kids.length} children`;
  },
  async solution({ call }) {
    const read = await call("canvas_read");
    const f = read.objects.find((o: any) => o.type === "frame");
    await call("canvas_duplicate", { objects: [{ id: f.id, expectedRevision: f.revision }], offsetX: 700 });
  },
});
