import { describe, expect, it } from "vitest";
import { nameAfterText } from "../src/operations";

describe("a layer name made from the text follows the text", () => {
  it("renames when the name was the old first line", () => {
    expect(nameAfterText("Draft", "Draft", "Final")).toBe("Final");
    expect(nameAfterText("Pricing", "Pricing\nper seat", "Packaging\nper team")).toBe("Packaging");
  });
  it("renames when the name was the old first line cut at 48 characters", () => {
    const long = "A".repeat(60), cut = `${"A".repeat(47)}…`;
    expect(nameAfterText(cut, long, "Short now")).toBe("Short now");
    expect(nameAfterText("Old", "Old", "B".repeat(60))).toBe(`${"B".repeat(47)}…`);
  });
  it("keeps a name someone chose", () => {
    expect(nameAfterText("Budget box", "Draft", "Final")).toBeUndefined();
  });
  it("keeps the name when the new text has no first line", () => {
    expect(nameAfterText("Draft", "Draft", "")).toBeUndefined();
    expect(nameAfterText("Draft", "Draft", "\nsecond line")).toBeUndefined();
  });
});
