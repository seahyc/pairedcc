import { task } from "../task-kit";
export default task({
  id: "09-scene-frame",
  prompt: 'Create a frame named "Options" containing three notes: "Option A", "Option B" and "Option C".',
  check({ read }) {
    const f = read.objects.find((o: any) => o.type === "frame" && /^options$/i.test((o.name ?? "").trim()));
    if (!f) return "no frame named Options";
    const kids = read.objects.filter((o: any) => o.parentId === f.id).map((o: any) => (o.text ?? "").trim());
    const want = ["Option A", "Option B", "Option C"];
    return want.every((t) => kids.some((k: string) => k.toLowerCase() === t.toLowerCase())) ? true : `frame contains ${JSON.stringify(kids)}`;
  },
  async solution({ call }) {
    await call("canvas_scene", {
      name: "Options",
      nodes: [
        { key: "f", shape: { kind: "frame", x: 0, y: 0, width: 900, height: 300, name: "Options" } },
        ...["A", "B", "C"].map((k, i) => ({ key: k, parentKey: "f", shape: { kind: "note", x: 40 + i * 280, y: 80, text: `Option ${k}` } })),
      ],
    });
  },
});
