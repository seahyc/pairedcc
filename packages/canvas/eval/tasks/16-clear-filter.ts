import { task } from "../task-kit";
export default task({
  id: "16-clear-filter",
  prompt: "Make the chart show every product again instead of only some, keeping its axes as they are.",
  async setup({ call, refs }) {
    refs.ds = await call("canvas_dataset", { x: 0, y: 0, synthetic: "orders" });
    refs.ch = await call("canvas_chart", { x: 520, y: 0, datasetId: refs.ds.id, state: { x: "region", y: "orders", filter: { product: ["Tea"] } } });
  },
  check({ read, refs }) {
    const st = read.objects.find((o: any) => o.id === refs.ch.id)?.widget?.state;
    if (!st) return "chart state unreadable";
    const active = Object.values(st.filter ?? {}).some((v: any) => v.length);
    if (active) return `filter still ${JSON.stringify(st.filter)}`;
    return st.x === "region" && st.y === "orders" ? true : "axes changed";
  },
  async solution({ call, refs }) {
    const ch = await call("canvas_get", { id: refs.ch.id });
    await call("canvas_chart_state", { id: refs.ch.id, expectedRevision: ch.revision, state: { filter: {} } });
  },
});
