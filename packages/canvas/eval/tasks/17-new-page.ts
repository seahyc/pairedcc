import { task } from "../task-kit";
export default task({
  id: "17-new-page",
  prompt: 'Start a new page called "Retro" and put a heading on it that says "What went well".',
  check({ read }) {
    if (!/^retro$/i.test((read.page?.name ?? "").trim())) return `current page is ${read.page?.name}`;
    return read.objects.some((o: any) => /what went well/i.test(o.text ?? "")) ? true : "no heading on the Retro page";
  },
  async solution({ call }) {
    await call("canvas_page", { name: "Retro" });
    await call("canvas_create", { kind: "text", x: 0, y: 0, text: "What went well" });
  },
});
