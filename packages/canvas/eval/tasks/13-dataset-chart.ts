import { task } from "../task-kit";
export default task({
  id: "13-dataset-chart",
  prompt: "Put the built-in synthetic café orders dataset on the board, with a bar chart of total orders by region next to it.",
  check({ read }) {
    const ds = read.objects.find((o: any) => o.type === "dataset");
    if (!ds) return "no dataset";
    const ch = read.objects.find((o: any) => o.type === "chart");
    if (!ch) return "no chart";
    const st = ch.widget?.state ?? ch.props?.state;
    if (!st) return "chart has no readable state";
    return st.x === "region" && st.y === "orders" && (st.aggregate ?? "sum") === "sum" ? true : `chart shows ${st.aggregate} of ${st.y} by ${st.x}`;
  },
  async solution({ call }) {
    const ds = await call("canvas_dataset", { x: 0, y: 0, synthetic: "orders" });
    await call("canvas_chart", { x: 520, y: 0, datasetId: ds.id, state: { x: "region", y: "orders" } });
  },
});
