import { byText, task } from "../task-kit";
export default task({
  id: "01-create-note",
  prompt: 'Add a note to the board that says "Hypothesis: churn rises after the price change".',
  check: ({ read }) => (byText(read, /hypothesis: churn rises after the price change/i).length === 1 ? true : "no single note with that text"),
  solution: async ({ call }) => void (await call("canvas_create", { kind: "note", x: 0, y: 0, text: "Hypothesis: churn rises after the price change" })),
});
