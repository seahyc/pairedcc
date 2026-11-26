import { task } from "../task-kit";
// Converge (#27, behind ?prototype=converge): one synthesis that keeps a link to each source.
export default task({
  id: "24-converge",
  prompt: "Pull the three logo directions on this page together into one synthesis card that says what they have in common, and keep it linked to each direction so it shows as stale if any of them changes.",
  async setup({ call, refs }) {
    refs.a = await call("canvas_create", { kind: "note", x: 0, y: 0, text: "Direction A: hand-drawn cup, warm brown" });
    refs.b = await call("canvas_create", { kind: "note", x: 0, y: 240, text: "Direction B: hand-drawn steam, cream on brown" });
    refs.c = await call("canvas_create", { kind: "note", x: 0, y: 480, text: "Direction C: lettering only, warm brown" });
  },
  check({ read, refs }) {
    const sources = [refs.a.id, refs.b.id, refs.c.id];
    const inputIds = (o: any) => (o.meta?.inputs ?? []).map((i: any) => (typeof i === "string" ? i : i.id));
    const synthesis = read.objects.find((o: any) => o.author !== "Human" && !sources.includes(o.id) && o.type !== "arrow" && sources.every((s) => inputIds(o).includes(s)));
    if (!synthesis) return "no agent card records all three directions as its inputs";
    if (!synthesis.text?.trim()) return "the synthesis card is empty";
    return synthesis.stale ? "the synthesis is already stale" : true;
  },
  async solution({ call, refs }) {
    await call("canvas_converge", { sourceIds: [refs.a.id, refs.b.id, refs.c.id], text: "All three are warm and hand-made; they differ on whether to show an object." });
  },
});
