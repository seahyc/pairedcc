import { task } from "../task-kit";
export default task({
  id: "15-edit-cell",
  prompt: "In the orders dataset, set the orders value in the third row of the table to 0.",
  async setup({ call, refs }) {
    refs.ds = await call("canvas_dataset", { x: 0, y: 0, synthetic: "orders" });
  },
  async check({ call, refs }) {
    const full = await call("canvas_get", { id: refs.ds.id });
    const rows = full.dataset?.rows ?? [];
    if (rows[2]?.orders !== 0) return `third row orders is ${rows[2]?.orders}`;
    const changed = rows.filter((r: any, i: number) => i !== 2 && r.orders === 0).length;
    return changed === 0 ? true : "another row was changed to 0";
  },
  async solution({ call, refs }) {
    const ds = await call("canvas_get", { id: refs.ds.id });
    await call("canvas_cell", { id: refs.ds.id, expectedRevision: ds.revision, row: 2, column: "orders", value: 0 });
  },
});
