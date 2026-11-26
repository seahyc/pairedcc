import { describe, expect, it } from "vitest";
import { needsReframe } from "../src/reframe";

describe("bringing a board into view", () => {
  const phone = { x: 0, y: 0, w: 390, h: 760 };
  it("reframes when the board has objects and none is in view", () => {
    // Cards placed for a 1440 px screen, opened on a phone.
    expect(needsReframe(phone, [{ x: 490, y: 250, w: 460, h: 60 }, { x: 490, y: 320, w: 400, h: 120 }])).toBe(true);
  });
  it("leaves the view alone when anything is visible, even partly", () => {
    expect(needsReframe(phone, [{ x: 380, y: 100, w: 460, h: 60 }, { x: 2000, y: 0, w: 10, h: 10 }])).toBe(false);
  });
  it("leaves an empty board alone", () => {
    expect(needsReframe(phone, [])).toBe(false);
  });
});

import { framingCandidates } from "../src/reframe";
describe("what counts as visible content", () => {
  it("uses visible top-level objects only: a frame stands for its children, hidden results do not count", () => {
    const shapes = [
      { id: "shape:frame", parentId: "page:1" },
      { id: "shape:child", parentId: "shape:frame" },
      { id: "shape:hidden-result", parentId: "page:1" },
      { id: "shape:card", parentId: "page:1" },
    ];
    const hidden = new Set(["shape:hidden-result"]);
    expect(framingCandidates(shapes, "page:1", (s) => hidden.has(s.id)).map((s) => s.id)).toEqual(["shape:frame", "shape:card"]);
  });
});
