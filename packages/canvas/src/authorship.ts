// Whose words are whose: rules for agent writes that need no editor, so they can be tested directly.
import { HUMAN } from "./scratchbook";

export const PERSON_WORDS_REFUSAL =
  "That is the person's own writing, so only they change its words. Comment on it with canvas_annotate, or answer beside it, instead.";

/**
 * Why an agent may not make this change to an object, or undefined if it may. The person's
 * words stay theirs: their writing is shown in their hand, so an agent rewriting it would put
 * words in their mouth. Moving, styling and the rest are not decided here.
 */
export function rewriteRefusal(author: string, change: { text?: unknown }): string | undefined {
  return author === HUMAN && change.text !== undefined ? PERSON_WORDS_REFUSAL : undefined;
}
