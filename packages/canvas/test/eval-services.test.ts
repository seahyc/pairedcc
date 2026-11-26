import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findBinary } from "../eval/services";

describe("eval services", () => {
  it("finds a binary on PATH first, then in extra directories, and reports a missing one", () => {
    const dir = mkdtempSync(join(tmpdir(), "find-binary-"));
    for (const d of ["a", "b", "pg16"]) mkdirSync(join(dir, d));
    writeFileSync(join(dir, "b", "redis-server"), "");
    writeFileSync(join(dir, "pg16", "initdb"), "");
    writeFileSync(join(dir, "a", "initdb"), "");
    const path = [join(dir, "a"), join(dir, "b")].join(":");
    expect(findBinary("redis-server", path, [])).toBe(join(dir, "b", "redis-server"));
    expect(findBinary("initdb", path, [join(dir, "pg16")])).toBe(join(dir, "a", "initdb"));
    expect(findBinary("initdb", join(dir, "b"), [join(dir, "pg16")])).toBe(join(dir, "pg16", "initdb"));
    expect(findBinary("pg_ctl", path, [join(dir, "pg16")])).toBeUndefined();
  });
});
