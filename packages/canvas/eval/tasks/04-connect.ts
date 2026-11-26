import { task } from "../task-kit";
export default task({
  id: "04-connect",
  prompt: 'Draw a connection from "Interview notes" to "Pricing hypothesis" labelled "supports".',
  async setup({ call, refs }) {
    refs.a = await call("canvas_create", { kind: "note", x: 0, y: 0, text: "Interview notes" });
    refs.b = await call("canvas_create", { kind: "note", x: 500, y: 0, text: "Pricing hypothesis" });
  },
  check({ read, refs }) {
    const arrow = (read.objects ?? []).find((o: any) => o.type === "arrow" && o.meta?.fromId === refs.a.id && o.meta?.toId === refs.b.id);
    if (!arrow) return "no arrow from Interview notes to Pricing hypothesis";
    return /supports/i.test(arrow.text ?? "") ? true : `arrow label is ${JSON.stringify(arrow.text)}`;
  },
  solution: async ({ call, refs }) => void (await call("canvas_connect", { fromId: refs.a.id, toId: refs.b.id, label: "supports" })),
});
