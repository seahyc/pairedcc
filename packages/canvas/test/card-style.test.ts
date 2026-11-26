import { describe, expect, it } from "vitest";
import { cardStyle } from "../src/agent-operations";

describe("cardStyle", () => {
  it("names a card's style the way agents choose it on create", () => {
    expect(cardStyle("agent")).toBe("note");
    for (const s of ["heading", "quote", "code"]) expect(cardStyle(s)).toBe(s);
  });
  it("names the person's cards and captions", () => {
    expect(cardStyle("human")).toBe("handwriting");
    expect(cardStyle("caption")).toBe("caption");
    expect(cardStyle(undefined)).toBeUndefined();
  });
});
