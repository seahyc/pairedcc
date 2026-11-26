// Turns raw measure results into the sprint scorecard and its Markdown table.
// Pure functions, unit-tested in test/eval-score.test.ts.

export type Status = "pass" | "fail" | "not run" | "reported" | "regressed";
export type Row = { measure: string; target: string; result: string; status: Status };
export type PerfRow = { objects: number; loadMs?: number; panMedianFrameMs?: number; error?: string };

export type Raw = {
  acceptance?: { steps: { name: string; pass: boolean; detail: string }[] };
  askLoop?: { steps: { name: string; pass: boolean; detail: string }[] };
  agentUsability?: { tasks: number; attempted: number; completed: number; medianToolCalls: number | null };
  safety?: { races: { name: string; pass: boolean; detail: string; humanEditsLost: number }[]; humanEditsLost: number };
  persistence?: { cleanProfile: boolean; sameProfileReload: boolean; detail: string; objects: number };
  performance?: PerfRow[];
  workspace?: { build: boolean; packages: Record<string, { pass: boolean; summary: string }> };
};

/** A performance metric counts as worse when it exceeds the previous run by this factor (timing noise). */
export const PERF_TOLERANCE = 1.25;

export function perfRegressions(now: PerfRow[] = [], before: PerfRow[] = []) {
  const out: string[] = [];
  for (const row of now) {
    const prev = before.find((b) => b.objects === row.objects);
    if (!prev) continue;
    if (row.error && !prev.error) out.push(`${row.objects}: now fails (${row.error})`);
    for (const key of ["loadMs", "panMedianFrameMs"] as const) {
      const a = row[key], b = prev[key];
      if (a !== undefined && b !== undefined && b > 0 && a > b * PERF_TOLERANCE) out.push(`${row.objects} ${key} ${b} → ${a}`);
    }
  }
  return out;
}

export function rows(raw: Raw, previous?: Raw): Row[] {
  const out: Row[] = [];
  const a = raw.acceptance;
  if (a) {
    const passed = a.steps.filter((s) => s.pass).length;
    out.push({ measure: "Acceptance scenario", target: "every step passes", result: `${passed}/${a.steps.length} steps`, status: passed === a.steps.length && a.steps.length > 0 ? "pass" : "fail" });
  } else out.push({ measure: "Acceptance scenario", target: "every step passes", result: "not run", status: "not run" });

  const k = raw.askLoop;
  if (k) {
    const passed = k.steps.filter((s) => s.pass).length;
    out.push({ measure: "Ask loop", target: "every step passes", result: `${passed}/${k.steps.length} steps`, status: passed === k.steps.length && k.steps.length > 0 ? "pass" : "fail" });
  } else out.push({ measure: "Ask loop", target: "every step passes", result: "not run", status: "not run" });

  const u = raw.agentUsability;
  if (!u || u.attempted === 0)
    out.push({ measure: "Agent usability", target: "≥90% of ≥20 tasks", result: `${u?.tasks ?? 0} tasks, no recorded attempt`, status: "not run" });
  else {
    const rate = u.completed / u.attempted;
    out.push({
      measure: "Agent usability",
      target: "≥90% of ≥20 tasks",
      result: `${u.completed}/${u.attempted} (${Math.round(rate * 100)}%), median ${u.medianToolCalls ?? "?"} tool calls`,
      status: rate >= 0.9 && u.attempted >= 20 ? "pass" : "fail",
    });
  }

  const s = raw.safety;
  if (s) {
    const passed = s.races.filter((r) => r.pass).length;
    out.push({ measure: "Safety of shared edits", target: "0 human edits lost", result: `${s.humanEditsLost} lost; ${passed}/${s.races.length} races pass`, status: s.humanEditsLost === 0 && passed === s.races.length ? "pass" : "fail" });
  } else out.push({ measure: "Safety of shared edits", target: "0 human edits lost", result: "not run", status: "not run" });

  const p = raw.persistence;
  out.push(
    p
      ? { measure: "Persistence", target: "identical in a clean profile", result: p.cleanProfile ? "identical" : `differs: ${p.detail}`, status: p.cleanProfile ? "pass" : "fail" }
      : { measure: "Persistence", target: "identical in a clean profile", result: "not run", status: "not run" },
  );

  const perf = raw.performance;
  if (perf) {
    const worse = perfRegressions(perf, previous?.performance);
    const text = perf
      .map((r) => (r.error ? `${r.objects / 1000}k: error` : `${r.objects / 1000}k: load ${r.loadMs} ms, pan ${r.panMedianFrameMs} ms/frame`))
      .join("; ");
    out.push({ measure: "Performance", target: "reported, not worse", result: worse.length ? `${text} (worse: ${worse.join(", ")})` : text, status: perf.some((r) => r.error) ? "fail" : worse.length ? "regressed" : "reported" });
  } else out.push({ measure: "Performance", target: "reported, not worse", result: "not run", status: "not run" });

  const w = raw.workspace;
  if (w) {
    const failing = Object.entries(w.packages).filter(([, r]) => !r.pass).map(([k]) => k);
    const result = `build ${w.build ? "passes" : "fails"}; tests: ${failing.length ? `${failing.join(", ")} failing` : "all packages pass"}`;
    out.push({ measure: "Existing product", target: "green", result, status: w.build && !failing.length ? "pass" : "fail" });
  } else out.push({ measure: "Existing product", target: "green", result: "not run", status: "not run" });
  return out;
}

export function markdown(table: Row[], generatedAt: string, commit: string) {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  return [
    `Scorecard from \`pnpm eval:canvas\` at ${generatedAt} on \`${commit}\`:`,
    "",
    "| Measure | Target | Result | Status |",
    "|---|---|---|---|",
    ...table.map((r) => `| ${r.measure} | ${esc(r.target)} | ${esc(r.result)} | ${r.status} |`),
  ].join("\n");
}

export const START = "<!-- scorecard:start -->";
export const END = "<!-- scorecard:end -->";

/** Replace the scorecard block in a report, or the placeholder line, or append it. */
export function spliceReport(report: string, block: string) {
  const wrapped = `${START}\n${block}\n${END}`;
  const i = report.indexOf(START), j = report.indexOf(END);
  if (i >= 0 && j > i) return report.slice(0, i) + wrapped + report.slice(j + END.length);
  const placeholder = /^Scorecard \(`pnpm eval:canvas`\): not available yet\.$/m;
  if (placeholder.test(report)) return report.replace(placeholder, wrapped);
  return `${report.trimEnd()}\n\n## Scorecard\n${wrapped}\n`;
}
