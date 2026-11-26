import { task } from "../task-kit";
export default task({
  id: "03-annotate",
  prompt: 'Attach a comment to the note "Usage fell 12% in March" asking where the number comes from.',
  async setup({ call, refs }) {
    refs.n = await call("canvas_create", { kind: "note", x: 0, y: 0, text: "Usage fell 12% in March" });
  },
  check({ read, refs }) {
    const a = (read.annotations ?? []).find((x: any) => (x.targetId ?? x.targetIds?.[0]) === refs.n.id);
    if (!a) return "no annotation targets the note";
    return /where|source|come/i.test(a.text ?? "") ? true : `annotation does not ask about the source: ${a.text}`;
  },
  solution: async ({ call, refs }) => void (await call("canvas_annotate", { targetId: refs.n.id, text: "Where does the 12% come from?" })),
});
