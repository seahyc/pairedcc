import { describe, expect, it } from "vitest";
import { summarisePan } from "../eval/measures/performance";

describe("pan frame summary", () => {
  it("takes the median of sample medians, so one slow sample does not move the figure", () => {
    const samples = [49.9, 41.8, 70.9, 42.7, 38.5].map((median) => ({ median, p95: median * 2 }));
    expect(summarisePan(samples)).toEqual({ median: 42.7, p95: 85.4, sampleMedians: [49.9, 41.8, 70.9, 42.7, 38.5] });
  });
  it("averages the middle two of an even number of samples", () => {
    expect(summarisePan([{ median: 10, p95: 20 }, { median: 30, p95: 40 }]).median).toBe(20);
  });
});
