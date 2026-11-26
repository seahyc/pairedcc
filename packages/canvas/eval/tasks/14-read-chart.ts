import { answersTop, gap, task } from "../task-kit";
export default task({
  id: "14-read-chart",
  prompt: "Which region has the highest bar in the chart, as the person has filtered it right now? Write the region's name in a note next to the chart.",
  async setup({ call, refs }) {
    refs.ds = await call("canvas_dataset", { x: 0, y: 0, synthetic: "orders" });
    refs.ch = await call("canvas_chart", { x: 520, y: 0, datasetId: refs.ds.id, state: { x: "region", y: "orders", filter: { product: ["Cake"] } } });
  },
  check({ read, refs }) {
    const ch = read.objects.find((o: any) => o.id === refs.ch.id);
    const bars = ch?.widget?.bars ?? [];
    if (!bars.length) return "chart has no bars";
    const top = bars.reduce((a: any, b: any) => (b.value > a.value ? b : a));
    const others = bars.filter((b: any) => b.key !== top.key).map((b: any) => b.key);
    const note = read.objects.find((o: any) => o.id !== ch.id && o.type !== "dataset" && answersTop(o.text ?? "", top.key, others) && gap(o, ch) <= 300);
    return note ? true : `no note within 300 px of the chart that names ${top.key} as highest`;
  },
  async solution({ call, refs }) {
    const ch = await call("canvas_get", { id: refs.ch.id });
    const top = ch.widget.bars.reduce((a: any, b: any) => (b.value > a.value ? b : a));
    await call("canvas_create", { kind: "note", x: ch.bounds.x + ch.bounds.w + 40, y: ch.bounds.y, text: `${top.key} is highest.` });
  },
});
