import { spawnSync } from "node:child_process";
import { chownSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { packageDir } from "./lib";

// The e2e suite needs Postgres, Redis, a JWT secret and a Chromium that its Playwright can
// launch (e2e/README.md). The workspace measure gives it those, in this order:
//   1. DATABASE_URL and REDIS_URL from the environment, when both are set;
//   2. otherwise throwaway Postgres and Redis in a temporary directory, when initdb, pg_ctl,
//      createdb and redis-server are installed (stopped and deleted afterwards);
//   3. otherwise nothing, and `note` says why the suite cannot pass.
// Postgres refuses to run as root, so under root it runs as `nobody` via runuser.

export type E2eServices = { env: Record<string, string>; note: string; stop(): void };

const THROWAWAY_SECRET = "eval-only-throwaway-jwt-secret";

/** An executable on PATH or in the usual Postgres install directories, newest version first. */
export function findBinary(name: string, path = process.env.PATH ?? "", extra = postgresDirs()): string | undefined {
  for (const dir of [...path.split(delimiter), ...extra]) if (dir && existsSync(join(dir, name))) return join(dir, name);
  return undefined;
}

function postgresDirs() {
  const base = "/usr/lib/postgresql";
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .sort((a, b) => Number(b) - Number(a))
    .map((v) => join(base, v, "bin"));
}

/** A Chromium for the e2e suite's Playwright when its own browser is not installed. */
export function chromiumFor(e2eDir = `${packageDir}/../../e2e`): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return undefined;
  try {
    const require = createRequire(`${e2eDir}/package.json`);
    const { chromium } = require("@playwright/test");
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    /* fall through to a preinstalled browser */
  }
  const preinstalled = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
  return existsSync(preinstalled) ? preinstalled : undefined;
}

const port = () => 20000 + Math.floor(Math.random() * 20000);

export function e2eServices(): E2eServices {
  const chromium = chromiumFor();
  const browser: Record<string, string> = chromium ? { PLAYWRIGHT_CHROMIUM_PATH: chromium } : {};
  const secret = { JWT_SECRET: process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16 ? process.env.JWT_SECRET : THROWAWAY_SECRET };
  if (process.env.DATABASE_URL && process.env.REDIS_URL)
    return { env: { ...secret, ...browser }, note: "e2e used DATABASE_URL and REDIS_URL from the environment", stop() {} };

  const bins = { initdb: findBinary("initdb"), pg_ctl: findBinary("pg_ctl"), createdb: findBinary("createdb"), redis: findBinary("redis-server") };
  const missing = Object.entries(bins).filter(([, v]) => !v).map(([k]) => (k === "redis" ? "redis-server" : k));
  if (missing.length) return { env: browser, note: `e2e had no database: set DATABASE_URL and REDIS_URL, or install ${missing.join(", ")} (see e2e/README.md)`, stop() {} };

  const dir = mkdtempSync(join(tmpdir(), "paired-eval-services-"));
  const root = process.getuid?.() === 0;
  if (root) {
    const nobody = Number(spawnSync("id", ["-u", "nobody"], { encoding: "utf8" }).stdout.trim());
    chownSync(dir, nobody, nobody);
  }
  const asPostgres = (bin: string, args: string[]) =>
    spawnSync(root ? "runuser" : bin, root ? ["-u", "nobody", "--", bin, ...args] : args, { encoding: "utf8", cwd: dir });
  const pgPort = port(), redisPort = port();
  const data = join(dir, "data");
  const stop = () => {
    asPostgres(bins.pg_ctl!, ["-D", data, "-m", "fast", "stop"]);
    const pid = Number(existsSync(join(dir, "redis.pid")) ? readFileSync(join(dir, "redis.pid"), "utf8").trim() : 0);
    if (pid)
      try {
        process.kill(pid);
      } catch {
        /* already stopped */
      }
    rmSync(dir, { recursive: true, force: true });
  };
  const steps: [string, () => { status: number | null; stderr?: string }][] = [
    ["initdb", () => asPostgres(bins.initdb!, ["-D", data, "-A", "trust", "-U", "paired"])],
    ["pg_ctl start", () => asPostgres(bins.pg_ctl!, ["-D", data, "-o", `-p ${pgPort} -k ${dir}`, "-l", join(dir, "pg.log"), "-w", "start"])],
    ["createdb", () => spawnSync(bins.createdb!, ["-h", "localhost", "-p", String(pgPort), "-U", "paired", "paired_e2e"], { encoding: "utf8" })],
    ["redis-server", () => spawnSync(bins.redis!, ["--port", String(redisPort), "--daemonize", "yes", "--save", "", "--dir", dir, "--pidfile", join(dir, "redis.pid")], { encoding: "utf8" })],
  ];
  for (const [name, run] of steps) {
    const r = run();
    if (r.status !== 0) {
      stop();
      return { env: browser, note: `e2e had no database: ${name} failed (${(r.stderr ?? "").trim().split("\n")[0]})`, stop() {} };
    }
  }
  return {
    env: { DATABASE_URL: `postgres://paired@localhost:${pgPort}/paired_e2e`, REDIS_URL: `redis://localhost:${redisPort}`, ...secret, ...browser },
    note: "e2e used throwaway Postgres and Redis started by the eval",
    stop,
  };
}
