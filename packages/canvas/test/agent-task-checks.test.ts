import { describe, expect, it } from "vitest";
import { answersTop } from "../eval/task-kit";

// Task 14 ("which region has the highest bar?") once required a note naming only the top region.
// The 26 Nov attempt answered correctly and also gave the other bars' values, and failed.
const others = ["West", "South", "North"];

describe("task 14's answer check", () => {
  it("accepts the recorded answer that also reports the other bars", () => {
    expect(answersTop("East has the highest bar: 187 orders (sum of orders by region; product = Cake; 16 of 48 rows). West 184, South 181, North 176.", "East", others)).toBe(true);
  });
  it("accepts a note naming only the top region", () => {
    expect(answersTop("East is highest.", "East", others)).toBe(true);
    expect(answersTop("East", "East", others)).toBe(true);
  });
  it("rejects a bare list, a wrong pick, or no pick", () => {
    expect(answersTop("North, South, East, West", "East", others)).toBe(false);
    expect(answersTop("East, West, South, North", "East", others)).toBe(false);
    expect(answersTop("West is highest, then East.", "East", others)).toBe(false);
    expect(answersTop("West is highest.", "East", others)).toBe(false);
    expect(answersTop("Northeast leads", "East", others)).toBe(false);
    expect(answersTop("East is not the highest; West is.", "East", others)).toBe(false);
    expect(answersTop("Bars: East, North, South, West. Not sure which is highest.", "East", others)).toBe(false);
    expect(answersTop("East is lowest. West is the highest.", "East", others)).toBe(false);
  });
});
