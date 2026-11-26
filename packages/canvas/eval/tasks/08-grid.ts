import { task } from "../task-kit";
const words = ["One", "Two", "Three", "Four", "Five", "Six"];
export default task({
  id: "08-grid",
  prompt: "Arrange the six number notes (One to Six) in a grid of three columns and two rows, in reading order One, Two, Three on the first row.",
  async setup({ call, refs }) {
    refs.ids = [];
    for (const [i, t] of words.entries()) refs.ids.push((await call("canvas_create", { kind: "note", x: ((i * 7) % 6) * 300, y: ((i * 5) % 4) * 250, text: t })).id);
  },
  check({ read, refs }) {
    const o = refs.ids.map((id: string) => read.objects.find((x: any) => x.id === id));
    if (o.some((x: any) => !x)) return "a note is missing";
    const cy = (x: any) => x.bounds.y + x.bounds.h / 2;
    const row1 = o.slice(0, 3), row2 = o.slice(3);
    const sameRow = (r: any[]) => Math.max(...r.map(cy)) - Math.min(...r.map(cy)) < 30;
    if (!sameRow(row1) || !sameRow(row2)) return "rows are not level";
    if (!(Math.min(...row2.map((x: any) => x.bounds.y)) >= Math.max(...row1.map((x: any) => x.bounds.y + x.bounds.h)))) return "second row is not below the first";
    const ordered = (r: any[]) => r[0].bounds.x < r[1].bounds.x && r[1].bounds.x < r[2].bounds.x;
    if (!ordered(row1) || !ordered(row2)) return "not in reading order";
    return Math.abs(row1[0].bounds.x - row2[0].bounds.x) < 30 ? true : "columns do not line up";
  },
  async solution({ call, refs }) {
    const read = await call("canvas_read");
    const objects = refs.ids.map((id: string) => ({ id, expectedRevision: read.objects.find((o: any) => o.id === id).revision }));
    await call("canvas_arrange", { objects, layout: "grid", columns: 3, x: 0, y: 0 });
  },
});
