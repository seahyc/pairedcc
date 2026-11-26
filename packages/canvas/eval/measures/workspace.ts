import { spawnSync } from "node:child_process";
import { packageDir } from "../lib";
import { e2eServices } from "../services";

// The existing product: `pnpm build` and every package's tests, reported per package.

export function workspace() {
  const root = `${packageDir}/../..`;
  const build = spawnSync("pnpm", ["build"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  // The e2e suite needs a database, Redis and a browser; see ../services.ts.
  const services = e2eServices();
  try {
    const test = spawnSync("pnpm", ["-r", "--no-bail", "test"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26, env: { ...process.env, ...services.env } });
    return { build: build.status === 0, packages: packageResults(`${test.stdout}\n${test.stderr}`), testExit: test.status, e2e: services.note };
  } finally {
    services.stop();
  }
}

/** Parse `pnpm -r test` output into per-package pass/fail with the vitest count line. */
export function packageResults(output: string) {
  const results: Record<string, { pass: boolean; summary: string }> = {};
  const lines = output.split("\n");
  for (const line of lines) {
    const m = line.match(/^(\S+) test(?:\$|:) ?(.*)$/);
    if (!m) continue;
    const [, dir, rest] = m;
    const name = dir.replace(/^packages\//, "");
    const entry = (results[name] ??= { pass: true, summary: "" });
    // vitest "Tests  1 failed | …", playwright "  1 failed", or pnpm's closing "Failed".
    if (/^\s*(Tests|Test Files)\s.*\b[1-9]\d* failed/.test(rest) || /^\s*[1-9]\d* failed/.test(rest) || rest.trim() === "Failed") entry.pass = false;
    const tests = rest.match(/Tests\s+(.*)$/);
    if (tests) entry.summary = tests[1].trim();
    // Playwright's closing count, such as "  1 passed (11.9s)".
    const pw = rest.match(/^\s+(\d+ passed(?: \([^)]*\))?)\s*$/);
    if (pw && !entry.summary) entry.summary = pw[1];
    if (/No test files found/.test(rest) && !entry.summary) entry.summary = "no test files";
  }
  for (const line of lines) {
    const m = line.match(/^(\S+) test: Failed$/) ?? line.match(/ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL\s+(\S+)@/);
    if (m) {
      const key = Object.keys(results).find((k) => m[1] === k || m[1].endsWith(k) || k.endsWith(m[1].replace(/^@[^/]+\//, "")));
      if (key) results[key].pass = false;
    }
  }
  return results;
}
