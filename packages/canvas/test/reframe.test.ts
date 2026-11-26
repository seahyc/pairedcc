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

import { fitCamera, MARK_ROOM, EDGE_MARGIN } from "../src/reframe";
import { firstBoardPlace, FIRST_BOARD_WIDTH } from "../src/seed";
// Item 99: nothing on the first board touches either edge of a phone, or the tool strip.
// The strip at 390 px: right edge 72, bottom 350 (screen px from the canvas's top-left).
const strip = { right: 72, bottom: 350 };
describe("the first board on a narrow screen", () => {
  it("is centred, full width, where there is room (desktop unchanged)", () => {
    expect(firstBoardPlace({ x: 0, y: 0, w: 1440, h: 856 }, { right: 304, bottom: 400 })).toEqual({ x: 490, y: 258, width: FIRST_BOARD_WIDTH });
    expect(firstBoardPlace({ x: 0, y: 0, w: 1440, h: 856 })).toEqual({ x: 490, y: 258, width: FIRST_BOARD_WIDTH });
  });
  it("on a phone, goes below the tool strip at the full width less margins and ✦ room", () => {
    const p = firstBoardPlace({ x: 0, y: 0, w: 390, h: 800 }, strip);
    expect(p).toEqual({ x: EDGE_MARGIN + MARK_ROOM, y: 350 + EDGE_MARGIN, width: 390 - 2 * EDGE_MARGIN - MARK_ROOM });
  });
  it("goes right of the strip when there is no room for it below", () => {
    const p = firstBoardPlace({ x: 0, y: 0, w: 390, h: 600 }, strip);
    expect(p.x - MARK_ROOM).toBe(72 + EDGE_MARGIN);
    expect(p.x + p.width).toBe(390 - EDGE_MARGIN);
  });
  it("works in page units wherever the view is", () => {
    const p = firstBoardPlace({ x: -1000, y: 500, w: 390, h: 800 }, strip);
    expect(p).toMatchObject({ x: -1000 + EDGE_MARGIN + MARK_ROOM, y: 500 + 350 + EDGE_MARGIN });
  });
});

describe("framing a board laid out on a wider screen", () => {
  const phone = { w: 390, h: 800 };
  const toScreen = (c: { x: number; y: number; z: number }, x: number, y: number) => ({ x: (x + c.x) * c.z, y: (y + c.y) * c.z });
  const bounds = { x: 490, y: 258, w: 460, h: 223 };
  it("fits the board and its ✦ marks below the tool strip, a margin from each edge, when that shows it larger", () => {
    const c = fitCamera(bounds, phone, strip);
    const tl = toScreen(c, bounds.x - MARK_ROOM, bounds.y), br = toScreen(c, bounds.x + bounds.w, bounds.y + bounds.h);
    expect(c.z).toBeCloseTo((390 - 2 * EDGE_MARGIN) / (460 + MARK_ROOM));
    expect(tl.x).toBeCloseTo(EDGE_MARGIN);
    expect(br.x).toBeCloseTo(390 - EDGE_MARGIN);
    expect(tl.y).toBeGreaterThanOrEqual(350 + EDGE_MARGIN);
    expect(br.y).toBeLessThanOrEqual(800 - EDGE_MARGIN);
  });
  it("puts a tall board right of the strip instead", () => {
    const tall = { x: 0, y: 0, w: 300, h: 1200 };
    const c = fitCamera(tall, phone, strip);
    expect(toScreen(c, tall.x - MARK_ROOM, 0).x).toBeGreaterThanOrEqual(72 + EDGE_MARGIN - 0.001);
    expect(toScreen(c, 0, tall.y + tall.h).y).toBeLessThanOrEqual(800 - EDGE_MARGIN + 0.001);
  });
  it("without a strip, uses the whole canvas", () => {
    expect(toScreen(fitCamera(bounds, phone), bounds.x - MARK_ROOM, 0).x).toBeCloseTo(EDGE_MARGIN);
  });
  it("does not zoom a small board in", () => {
    expect(fitCamera({ x: 0, y: 0, w: 100, h: 50 }, phone, strip).z).toBe(1);
  });
});
