import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chownSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { packageDir } from "./lib";

// The e2e suite needs Postgres, Redis, a JWT secret and a Chromium that its Playwright can
// launch (e2e/README.md). The workspace measure gives it those, in this order:
//   1. DATABASE_URL and REDIS_URL from the environment, when both are set;
//   2. otherwise throwaway Postgres and Redis in a temporary directory, when initdb, pg_ctl,
//      createdb and redis-server are installed (stopped and deleted afterwards);
//   3. otherwise nothing, and `note` says why the suite cannot pass.
// Postgres refuses to run as root, so under root it runs as `nobody` via runuser. Both services
// listen on loopback with random passwords, and a cancelled eval still cleans them up.

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

/**
 * A Chromium for the e2e suite's Playwright when the browser it launches by default does not
 * start. Probes a real headless launch with the suite's own Playwright, because the headless
 * shell it uses can be missing while full Chromium is installed, or the other way round.
 */
export function chromiumFor(e2eDir = `${packageDir}/../../e2e`): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return undefined;
  const probe = spawnSync(
    process.execPath,
    ["-e", "require('@playwright/test').chromium.launch().then((b) => b.close()).then(() => process.exit(0), () => process.exit(1))"],
    { cwd: e2eDir, encoding: "utf8", timeout: 60_000 },
  );
  if (probe.status === 0) return undefined;
  const preinstalled = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
  return existsSync(preinstalled) ? preinstalled : undefined;
}

const port = () => 20000 + Math.floor(Math.random() * 20000);
const password = () => randomBytes(18).toString("hex");

export function e2eServices(): E2eServices {
  const chromium = chromiumFor();
  const browser: Record<string, string> = chromium ? { PLAYWRIGHT_CHROMIUM_PATH: chromium } : {};
  const secret = { JWT_SECRET: process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 16 ? process.env.JWT_SECRET : THROWAWAY_SECRET };
  if (process.env.DATABASE_URL && process.env.REDIS_URL)
    return { env: { ...secret, ...browser }, note: "e2e used DATABASE_URL and REDIS_URL from the environment", stop() {} };

  const bins = { initdb: findBinary("initdb"), pg_ctl: findBinary("pg_ctl"), createdb: findBinary("createdb"), redis: findBinary("redis-server") };
  const missing = Object.entries(bins).filter(([, v]) => !v).map(([k]) => (k === "redis" ? "redis-server" : k));
  if (missing.length) return { env: browser, note: `e2e had no database: set DATABASE_URL and REDIS_URL, or install ${missing.join(", ")} (see e2e/README.md)`, stop() {} };

  // Postgres gets its own directory (owned by nobody under root); Redis's directory, with the
  // pid file that cleanup signals, stays owned by this user, so nobody cannot redirect it.
  // Both listen on loopback only and require a random password, so other local users on a
  // shared machine cannot use them.
  const pgDir = mkdtempSync(join(tmpdir(), "paired-eval-pg-"));
  const redisDir = mkdtempSync(join(tmpdir(), "paired-eval-redis-"));
  const root = process.getuid?.() === 0;
  if (root) {
    const nobody = Number(spawnSync("id", ["-u", "nobody"], { encoding: "utf8" }).stdout.trim());
    chownSync(pgDir, nobody, nobody);
  }
  const asPostgres = (bin: string, args: string[]) =>
    spawnSync(root ? "runuser" : bin, root ? ["-u", "nobody", "--", bin, ...args] : args, { encoding: "utf8", cwd: pgDir });
  const pgPort = port(), redisPort = port(), pgPassword = password(), redisPassword = password();
  const data = join(pgDir, "data"), pwfile = join(pgDir, "pw");
  writeFileSync(pwfile, pgPassword, { mode: 0o600 });
  if (root) chownSync(pwfile, statSync(pgDir).uid, statSync(pgDir).gid);

  let stopped = false;
  const onSignal = () => {
    stop();
    process.exit(130);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    asPostgres(bins.pg_ctl!, ["-D", data, "-m", "fast", "stop"]);
    const pidFile = join(redisDir, "redis.pid");
    const pid = Number(existsSync(pidFile) ? readFileSync(pidFile, "utf8").trim() : 0);
    if (pid)
      try {
        process.kill(pid);
      } catch {
        /* already stopped */
      }
    rmSync(pgDir, { recursive: true, force: true });
    rmSync(redisDir, { recursive: true, force: true });
  };
  // A cancelled eval (Ctrl+C) still stops both services and deletes their files.
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const steps: [string, () => { status: number | null; stderr?: string }][] = [
    ["initdb", () => asPostgres(bins.initdb!, ["-D", data, "-A", "scram-sha-256", "-U", "paired", `--pwfile=${pwfile}`])],
    ["pg_ctl start", () => asPostgres(bins.pg_ctl!, ["-D", data, "-o", `-p ${pgPort} -k ${pgDir} -c listen_addresses=localhost`, "-l", join(pgDir, "pg.log"), "-w", "start"])],
    ["createdb", () => spawnSync(bins.createdb!, ["-h", "localhost", "-p", String(pgPort), "-U", "paired", "paired_e2e"], { encoding: "utf8", env: { ...process.env, PGPASSWORD: pgPassword } })],
    [
      "redis-server",
      () =>
        spawnSync(bins.redis!, ["--port", String(redisPort), "--bind", "127.0.0.1", "--requirepass", redisPassword, "--daemonize", "yes", "--save", "", "--dir", redisDir, "--pidfile", join(redisDir, "redis.pid")], { encoding: "utf8" }),
    ],
  ];
  for (const [name, run] of steps) {
    const r = run();
    if (r.status !== 0) {
      stop();
      return { env: browser, note: `e2e had no database: ${name} failed (${(r.stderr ?? "").trim().split("\n")[0]})`, stop() {} };
    }
  }
  return {
    env: {
      DATABASE_URL: `postgres://paired:${pgPassword}@localhost:${pgPort}/paired_e2e`,
      REDIS_URL: `redis://:${redisPassword}@localhost:${redisPort}`,
      ...secret,
      ...browser,
    },
    note: "e2e used throwaway Postgres and Redis started by the eval",
    stop,
  };
}
