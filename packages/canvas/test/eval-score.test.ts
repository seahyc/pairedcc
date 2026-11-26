import { describe, expect, it } from "vitest";
import { packageResults } from "../eval/measures/workspace";
import { END, START, markdown, perfRegressions, rows, spliceReport, type Raw } from "../eval/score";

const allPass: Raw = {
  acceptance: { steps: [{ name: "a", pass: true, detail: "ok" }] },
  agentUsability: { tasks: 20, attempted: 20, completed: 19, medianToolCalls: 4 },
  safety: { races: [{ name: "r", pass: true, detail: "ok", humanEditsLost: 0 }], humanEditsLost: 0 },
  persistence: { cleanProfile: true, sameProfileReload: true, detail: "identical", objects: 3 },
  performance: [{ objects: 1000, loadMs: 1000, panMedianFrameMs: 16.7 }],
  workspace: { build: true, packages: { canvas: { pass: true, summary: "32 passed" } } },
};
const status = (raw: Raw, measure: string, previous?: Raw) => rows(raw, previous).find((r) => r.measure === measure)?.status;

describe("scorecard rows", () => {
  it("passes every measure when every target is met", () => {
    expect(rows(allPass).map((r) => r.status)).toEqual(["pass", "pass", "pass", "pass", "reported", "pass"]);
  });

  it("fails acceptance on any failing step and reports the count", () => {
    const raw = { ...allPass, acceptance: { steps: [...allPass.acceptance!.steps, { name: "b", pass: false, detail: "x" }] } };
    expect(status(raw, "Acceptance scenario")).toBe("fail");
    expect(rows(raw)[0].result).toBe("1/2 steps");
  });

  it("requires at least 20 attempted tasks and 90% completion for agent usability", () => {
    expect(status({ ...allPass, agentUsability: { tasks: 10, attempted: 10, completed: 10, medianToolCalls: 3 } }, "Agent usability")).toBe("fail");
    expect(status({ ...allPass, agentUsability: { tasks: 20, attempted: 20, completed: 17, medianToolCalls: 3 } }, "Agent usability")).toBe("fail");
    expect(status({ ...allPass, agentUsability: { tasks: 0, attempted: 0, completed: 0, medianToolCalls: null } }, "Agent usability")).toBe("not run");
  });

  it("fails safety when a human edit is lost or a race cannot be run", () => {
    expect(status({ ...allPass, safety: { races: [{ name: "r", pass: false, detail: "x", humanEditsLost: 1 }], humanEditsLost: 1 } }, "Safety of shared edits")).toBe("fail");
    expect(status({ ...allPass, safety: { races: [{ name: "r", pass: false, detail: "missing", humanEditsLost: 0 }], humanEditsLost: 0 } }, "Safety of shared edits")).toBe("fail");
  });

  it("fails persistence unless the clean profile is identical, even if a same-profile reload works", () => {
    expect(status({ ...allPass, persistence: { cleanProfile: false, sameProfileReload: true, detail: "gone", objects: 3 } }, "Persistence")).toBe("fail");
  });

  it("flags a performance metric that got worse beyond the noise tolerance", () => {
    const slower = { ...allPass, performance: [{ objects: 1000, loadMs: 1300, panMedianFrameMs: 16.7 }] };
    expect(status(slower, "Performance", allPass)).toBe("regressed");
    const noisy = { ...allPass, performance: [{ objects: 1000, loadMs: 1200, panMedianFrameMs: 18 }] };
    expect(status(noisy, "Performance", allPass)).toBe("reported");
    expect(perfRegressions(slower.performance, allPass.performance)).toEqual(["1000 loadMs 1000 → 1300"]);
  });

  it("fails performance when a board size cannot be measured", () => {
    expect(status({ ...allPass, performance: [{ objects: 10000, error: "limit" }] }, "Performance")).toBe("fail");
  });

  it("fails the existing product when any package fails", () => {
    const raw = { ...allPass, workspace: { build: true, packages: { canvas: { pass: true, summary: "" }, e2e: { pass: false, summary: "" } } } };
    expect(rows(raw).at(-1)).toMatchObject({ status: "fail", result: "build passes; tests: e2e failing" });
  });

  it("reports measures that were not run as not run", () => {
    expect(rows({}).every((r) => r.status === "not run")).toBe(true);
  });
});

describe("report splicing", () => {
  const block = markdown(rows(allPass), "2026-11-26T10:00Z", "abc1234");
  it("replaces the placeholder line, then replaces its own block on later runs", () => {
    const report = "# R\n\nScorecard (`pnpm eval:canvas`): not available yet.\n\n## Merged\n";
    const once = spliceReport(report, block);
    expect(once).toContain(START);
    expect(once).not.toContain("not available yet");
    const twice = spliceReport(once, "new block");
    expect(twice.split(START).length).toBe(2);
    expect(twice).toContain(`${START}\nnew block\n${END}`);
    expect(twice).toContain("## Merged");
  });
  it("escapes pipes inside cells", () => {
    expect(markdown([{ measure: "m", target: "a|b", result: "c", status: "pass" }], "t", "c")).toContain("a\\|b");
  });
});

describe("workspace output parsing", () => {
  it("reads per-package results from pnpm -r test output", () => {
    const out = [
      "packages/canvas test:  Test Files  9 passed (9)",
      "packages/canvas test:       Tests  40 passed (40)",
      "packages/cli test: No test files found, exiting with code 0",
      "e2e test: Error: browserType.launch failed",
      "e2e test: Failed",
    ].join("\n");
    expect(packageResults(out)).toEqual({
      canvas: { pass: true, summary: "40 passed (40)" },
      cli: { pass: true, summary: "no test files" },
      e2e: { pass: false, summary: "" },
    });
  });
});
