import { task } from "../task-kit";
export default task({
  id: "20-find-in-many",
  prompt: 'Somewhere on this page, among many notes, exactly one mentions the budget. Attach a comment to that note saying "Check this number".',
  async setup({ call, refs }) {
    const nodes = Array.from({ length: 60 }, (_, i) => ({
      key: `n${i}`,
      shape: { kind: "note", x: (i % 10) * 280, y: Math.floor(i / 10) * 160, text: i === 37 ? "Budget: £4,200 for the pilot" : `Observation ${i + 1}: participant mentioned onboarding` },
    }));
    await call("canvas_scene", { name: "Many notes", nodes });
    const read = await call("canvas_read");
    refs.target = read.objects.find((o: any) => /budget/i.test(o.text ?? "")).id;
  },
  check({ read, refs }) {
    const a = (read.annotations ?? []).find((x: any) => (x.targetId ?? x.targetIds?.[0]) === refs.target);
    if (!a) return "no annotation on the budget note";
    return /check this number/i.test(a.text ?? "") ? true : `annotation says ${a.text}`;
  },
  solution: async ({ call, refs }) => void (await call("canvas_annotate", { targetId: refs.target, text: "Check this number" })),
});
