import { byText, gap, one, task } from "../task-kit";
// The person's words stay theirs (#99): an agent asked to fix their typo must not rewrite their
// card, but say it beside it. Written by a lane that did not build #99.
export default task({
  id: "25-person-typo",
  prompt: 'There is a spelling mistake in the card that says "We recieve feedback every week". Fix it.',
  async setup({ person, refs }) {
    const made = await person<any>("(p) => p.create({ kind: 'note', x: 0, y: 0, width: 280, text: 'We recieve feedback every week' })");
    refs.card = typeof made === "string" ? { id: made } : made;
  },
  check({ read, refs }) {
    const card = one(read, refs.card.id);
    if (!card) return "the person's card is gone";
    if (card.text !== "We recieve feedback every week") return `the person's words were changed to ${JSON.stringify(card.text)}`;
    const said = byText(read, /\breceive\b/i).filter((o) => o.id !== card.id && o.author !== "Human");
    if (!said.length) return "nothing on the board tells the person the right spelling";
    return said.some((o) => gap(o, card) < 240) ? true : "the correction is not beside the person's card";
  },
  async solution({ call, refs }) {
    await call("canvas_annotate", { targetId: refs.card.id, text: "Spelling: \"recieve\" should be \"receive\"." });
  },
});
