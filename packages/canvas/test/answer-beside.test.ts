import { describe, expect, it } from "vitest";
import { ANSWER_SLIDE, pickAnswerSpot } from "../src/ask-rules";

describe("pickAnswerSpot: an answer stays with its own ask", () => {
  it("goes under the ask when that space is free (the usual case)", () => {
    expect(pickAnswerSpot(0, 0)).toBe("under");
    expect(pickAnswerSpot(ANSWER_SLIDE, 0)).toBe("under");
  });
  it("goes beside the ask when the space under it is taken by later asks", () => {
    expect(pickAnswerSpot(224, 0)).toBe("beside");
  });
  it("stays under when beside would slide just as far", () => {
    expect(pickAnswerSpot(224, 224)).toBe("under");
    expect(pickAnswerSpot(100, 300)).toBe("under");
  });
});
