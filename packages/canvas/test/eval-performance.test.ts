import { describe, expect, it } from "vitest";
import { PAN_FRAMES_DEFAULT, PAN_SAMPLES_DEFAULT, countSetting, summarisePan } from "../eval/measures/performance";

// Item 69: on the sprint container a pan sample is either fast (~38 ms) or slow (~85 ms), in runs,
// on unchanged code. The reported figure is the lower quartile of many short samples' medians, so
// it reads the fast mode whenever at least a quarter of the samples land there.
describe("pan frame summary", () => {
  const fast = (n: number) => Array.from({ length: n }, (_, i) => ({ median: 38 + (i % 3) * 0.4, p95: 60 }));
  const slow = (n: number) => Array.from({ length: n }, (_, i) => ({ median: 85 + (i % 4), p95: 140 }));

  it("reads the fast mode when most samples land slow (the 95a9daf run shape)", () => {
    const summary = summarisePan([...slow(8), ...fast(4)]);
    expect(summary.median).toBeLessThan(39);
  });
  it("is the same figure whether a run lands mostly fast or mostly slow", () => {
    const mostlyFast = summarisePan([...fast(9), ...slow(3)]).median;
    const mostlySlow = summarisePan([...slow(9), ...fast(3)]).median;
    expect(Math.abs(mostlyFast - mostlySlow) / mostlyFast).toBeLessThan(0.25);
  });
  it("keeps every sample's median and the method, so the spread is on record", () => {
    const summary = summarisePan([...fast(2), ...slow(2)]);
    expect(summary.sampleMedians).toHaveLength(4);
    expect(summary.method).toMatch(/lower quartile/);
  });
  it("also keeps what a frame usually took, so a slow spell is still on record", () => {
    // Nine of twelve samples slow: the lower quartile reads the fast mode, the typical figure does not.
    const summary = summarisePan([...slow(9), ...fast(3)]);
    expect(summary.median).toBeLessThan(39);
    expect(summary.typical).toBeGreaterThan(80);
  });
  it("takes many short samples by default", () => {
    expect(PAN_SAMPLES_DEFAULT).toBeGreaterThanOrEqual(12);
    expect(PAN_FRAMES_DEFAULT).toBeLessThanOrEqual(60);
  });
  it("refuses a setting that is not a whole number instead of measuring nothing (review of #100)", () => {
    expect(countSetting(undefined, 40, 10, "EVAL_PAN_FRAMES")).toBe(40);
    expect(countSetting("60", 40, 10, "EVAL_PAN_FRAMES")).toBe(60);
    expect(() => countSetting("40frames", 40, 10, "EVAL_PAN_FRAMES")).toThrow('EVAL_PAN_FRAMES must be a whole number of at least 10 (got "40frames")');
    expect(() => countSetting("3", 40, 10, "EVAL_PAN_FRAMES")).toThrow("at least 10");
  });
});
