import { describe, expect, it } from "vitest";
import { PERSON_WORDS_REFUSAL, rewriteRefusal } from "../src/authorship";
import { HUMAN } from "../src/scratchbook";

describe("rewriteRefusal: an agent never rewrites the person's own words", () => {
  it("refuses a text change to something the person made, and says what to do instead", () => {
    expect(rewriteRefusal(HUMAN, { text: "New words" })).toBe(PERSON_WORDS_REFUSAL);
    expect(rewriteRefusal(HUMAN, { text: "" })).toBe(PERSON_WORDS_REFUSAL);
    expect(PERSON_WORDS_REFUSAL).toMatch(/canvas_annotate/);
  });
  it("lets other changes to the person's objects through (decided elsewhere)", () => {
    expect(rewriteRefusal(HUMAN, { color: "green" } as { text?: unknown })).toBeUndefined();
  });
  it("lets an agent rewrite its own work", () => {
    expect(rewriteRefusal("MCP agent", { text: "Revised" })).toBeUndefined();
  });
});
