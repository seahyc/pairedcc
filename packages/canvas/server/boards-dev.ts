import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Plugin } from "vite";
import { isLocalRequest } from "./relay";

// Development stand-in for the server's /api/canvas/boards (packages/server/src/canvas/boards),
// with the same revision contract, for one local person and loopback requests only. Boards
// are JSON files in PAIRED_BOARDS_DIR (default packages/canvas/.local/boards). This is not a
// hosted backend; paired.cc uses the authenticated server routes.

const PREFIX = "/api/canvas/boards";
const KEEP = 50;
const MAX = 10 * 1024 * 1024;
type Stored = { id: string; name: string; revision: number; updatedAt: string; snapshot: unknown; history: { revision: number; savedAt: string; snapshot: unknown }[] };

export function devBoardStore(dir: string) {
  mkdirSync(dir, { recursive: true });
  const file = (id: string) => join(dir, `${id}.json`);
  const read = (id: string): Stored | null => (existsSync(file(id)) ? JSON.parse(readFileSync(file(id), "utf8")) : null);
  const write = (b: Stored) => {
    writeFileSync(`${file(b.id)}.tmp`, JSON.stringify(b));
    renameSync(`${file(b.id)}.tmp`, file(b.id));
  };
  const summary = (b: Stored) => ({ id: b.id, name: b.name, revision: b.revision, sizeBytes: JSON.stringify(b.snapshot).length, updatedAt: b.updatedAt });
  return {
    list: () => readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => summary(read(f.slice(0, -5))!)).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    get: (id: string) => read(id),
    /** Kept revisions, newest first, without snapshots (server: GET /:id/revisions). */
    revisions(id: string) {
      const b = read(id);
      return b ? b.history.map((h) => ({ revision: h.revision, sizeBytes: JSON.stringify(h.snapshot).length, savedAt: h.savedAt })).reverse() : null;
    },
    /** One kept revision with its snapshot (server: GET /:id/revisions/:rev). */
    revision(id: string, revision: number) {
      const h = read(id)?.history.find((x) => x.revision === revision);
      return h ? { revision: h.revision, sizeBytes: JSON.stringify(h.snapshot).length, savedAt: h.savedAt, snapshot: h.snapshot } : null;
    },
    /** Same outcomes as the server: created/saved, stale (with current), or missing. */
    save(id: string, expectedRevision: number, snapshot: unknown, name?: string) {
      const current = read(id), at = new Date().toISOString();
      if (!current) {
        if (expectedRevision !== 0) return { status: 404, body: { error: "Board not found. Save with expectedRevision 0 to create it." } };
        const b: Stored = { id, name: name ?? "Untitled exploration", revision: 1, updatedAt: at, snapshot, history: [{ revision: 1, savedAt: at, snapshot }] };
        write(b);
        return { status: 201, body: { board: summary(b) } };
      }
      if (current.revision !== expectedRevision) return { status: 409, body: { error: "Board changed. Load its current revision before saving.", current: summary(current) } };
      const revision = current.revision + 1;
      const b: Stored = { ...current, revision, updatedAt: at, snapshot, ...(name ? { name } : {}), history: [...current.history, { revision, savedAt: at, snapshot }].slice(-KEEP) };
      write(b);
      return { status: 200, body: { board: summary(b) } };
    },
  };
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX + 65536) throw Object.assign(new Error("Boards are limited to 10 MB"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const validId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
const validSnapshot = (s: unknown): boolean =>
  !!s && typeof s === "object" && !!(s as { store?: unknown }).store && typeof (s as { store: unknown }).store === "object" && !!(s as { schema?: unknown }).schema;

export function devBoards(dir = process.env.PAIRED_BOARDS_DIR ?? join(process.cwd(), ".local", "boards")): Plugin {
  return {
    name: "paired-dev-boards",
    configureServer(server) {
      const store = devBoardStore(dir);
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return next();
        if (!isLocalRequest(req)) return send(res, 403, { error: "Development boards accept same-origin loopback requests only" });
        const [rawId = "", sub, rawRev, ...extra] = url.pathname.slice(PREFIX.length + 1).split("/");
        const id = decodeURIComponent(rawId);
        if (!id) return req.method === "GET" ? send(res, 200, { boards: store.list(), account: "local" }) : send(res, 405, { error: "Use GET" });
        if (!validId(id)) return send(res, 400, { error: "Board IDs are 1–64 letters, digits, - or _" });
        if (sub !== undefined) {
          if (sub !== "revisions" || extra.length) return send(res, 404, { error: "Not found" });
          if (req.method !== "GET") return send(res, 405, { error: "Use GET" });
          if (rawRev === undefined || rawRev === "") {
            const list = store.revisions(id);
            return list ? send(res, 200, { revisions: list }) : send(res, 404, { error: "Board not found" });
          }
          const rev = Number(rawRev);
          if (!Number.isInteger(rev) || rev < 1) return send(res, 400, { error: "Invalid board ID or revision" });
          const one = store.revision(id, rev);
          return one ? send(res, 200, { revision: one }) : send(res, 404, { error: "Revision not found" });
        }
        if (req.method === "GET") {
          const b = store.get(id);
          return b ? send(res, 200, { board: { id: b.id, name: b.name, revision: b.revision, updatedAt: b.updatedAt, snapshot: b.snapshot } }) : send(res, 404, { error: "Board not found" });
        }
        if (req.method !== "PUT") return send(res, 405, { error: "Use GET or PUT" });
        void body(req)
          .then((input: { expectedRevision?: unknown; snapshot?: unknown; name?: unknown }) => {
            const rev = input.expectedRevision;
            if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 0) return send(res, 400, { error: "expectedRevision: must be a non-negative integer" });
            if (!validSnapshot(input.snapshot)) return send(res, 400, { error: "snapshot: must be a tldraw document with store and schema" });
            const r = store.save(id, rev, input.snapshot, typeof input.name === "string" ? input.name : undefined);
            send(res, r.status, r.body);
          })
          .catch((e: Error & { status?: number }) => send(res, e.status ?? 400, { error: e.status ? e.message : "Body must be JSON" }));
      });
    },
  };
}
