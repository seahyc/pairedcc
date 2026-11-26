import { describe, expect, it } from "vitest";
import { contentHash, copyId, createBoardSync, mergeSnapshots, withNewRecords, type BoardApi, type Snapshot, type SyncMemo, type SyncStatus } from "../src/board-sync";
import { wellFormed } from "../src/text";

const snap = (text: string): Snapshot => ({ store: { "shape:a": { id: "shape:a", typeName: "shape", text } }, schema: { schemaVersion: 2 } });
const text = (s: Snapshot) => (s.store["shape:a"] as { text: string }).text;

/** A fake server with the real contract: revisions, stale rejection, create at 0. */
function server(signedIn: string | null = "alice", keep = 50) {
  // history[i] is revision first + i; the oldest are pruned beyond `keep`, as on the server.
  const boards = new Map<string, { revision: number; snapshot: Snapshot; history: Snapshot[]; first: number }>();
  let down = false;
  const uploads: string[] = [];
  const hooks: { beforeRevision?: () => Promise<void>; beforeGet?: () => Promise<void>; beforePut?: () => Promise<void> } = {};
  const api: BoardApi = {
    async account() {
      if (down) throw new Error("offline");
      return signedIn;
    },
    async get(id) {
      if (down) throw new Error("offline");
      await hooks.beforeGet?.();
      const b = boards.get(id);
      return b ? { revision: b.revision, snapshot: structuredClone(b.snapshot) } : null;
    },
    async put(id, expectedRevision, snapshot) {
      if (down) throw new Error("offline");
      uploads.push(id);
      await hooks.beforePut?.();
      if (JSON.stringify(snapshot).includes("HUGE")) return { ok: false, stale: false, refused: 413, error: "Boards are limited to 10 MB" };
      const b = boards.get(id);
      snapshot = wellFormed(snapshot);
      if (!b) {
        if (expectedRevision !== 0) return { ok: false, stale: false, error: "Board not found" };
        boards.set(id, { revision: 1, snapshot: structuredClone(snapshot), history: [structuredClone(snapshot)], first: 1 });
        return { ok: true, revision: 1 };
      }
      if (b.revision !== expectedRevision) return { ok: false, stale: true, revision: b.revision };
      b.revision++;
      b.snapshot = structuredClone(snapshot);
      b.history.push(structuredClone(snapshot));
      while (b.history.length > keep) {
        b.history.shift();
        b.first++;
      }
      return { ok: true, revision: b.revision };
    },
    async list() {
      return [...boards].map(([id, b]) => ({ id, name: "Untitled exploration", revision: b.revision, sizeBytes: 1, updatedAt: "" }));
    },
    async revisions(id) {
      const b = boards.get(id);
      return b ? b.history.map((_, i) => ({ revision: b.first + i, sizeBytes: 1, savedAt: "" })).reverse() : null;
    },
    async revision(id, rev) {
      await hooks.beforeRevision?.();
      const b = boards.get(id);
      const h = b && rev >= b.first ? b.history[rev - b.first] : undefined;
      return h ? { revision: rev, snapshot: structuredClone(h) } : null;
    },
  };
  return { api, boards, hooks, uploads, setDown: (v: boolean) => (down = v) };
}

function browser(initial: Snapshot, memo: SyncMemo | null = null, shared?: { memo: SyncMemo | null }, opts: { lateNotify?: boolean } = {}) {
  let doc = structuredClone(initial);
  let resets = 0;
  const listeners = new Set<() => void>();
  // tldraw reports store changes a frame later; with lateNotify, a load's report waits for deliver().
  const pending: (() => void)[] = [];
  const stored = shared ?? { memo };
  // Pending timers in firing order; clearTimer really cancels, as in a browser.
  const timers: ((() => void) & { id?: number })[] = [];
  let nextId = 0;
  return {
    get doc() {
      return doc;
    },
    edit(t: string) {
      doc = snap(t);
      for (const l of listeners) l();
    },
    /** A change from another tab of this browser (tldraw's broadcast): no listener fires. */
    remote(s: Snapshot) {
      doc = structuredClone(s);
    },
    get resets() {
      return resets;
    },
    local: {
      snapshot: () => structuredClone(doc),
      load(s: Snapshot) {
        doc = structuredClone(s);
        if (opts.lateNotify) pending.push(() => listeners.forEach((l) => l()));
        else for (const l of listeners) l();
      },
      reset() {
        resets++;
      },
      listen(fn: () => void) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    deliver() {
      while (pending.length) pending.shift()!();
    },
    memo: { get: () => stored.memo, set: (m: SyncMemo | null) => (stored.memo = m) },
    stored,
    timers,
    setTimer: (fn: () => void) => {
      const t = Object.assign(() => fn(), { id: ++nextId });
      timers.push(t);
      return t.id;
    },
    clearTimer: (id: unknown) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    async flush() {
      while (timers.length) await timers.shift()!();
    },
  };
}

function sync(srv: ReturnType<typeof server>, b: ReturnType<typeof browser>, hadLocalWork: boolean) {
  const statuses: SyncStatus[] = [];
  const s = createBoardSync({
    api: srv.api, local: b.local, memo: b.memo, hadLocalWork, onStatus: (x) => statuses.push(x),
    setTimer: b.setTimer, clearTimer: b.clearTimer, now: () => new Date("2026-11-26T10:00:00Z"),
  });
  return { s, statuses, last: () => statuses.at(-1)! };
}

describe("board sync", () => {
  it("does nothing but record local edits while signed out", async () => {
    const srv = server(null), b = browser(snap("mine"));
    const { s, last } = sync(srv, b, false);
    await s.start();
    expect(last()).toEqual({ state: "local" });
    b.edit("still mine");
    expect(b.stored.memo?.dirty).toBe(true);
    expect(srv.boards.size).toBe(0);
  });

  it("moves this browser's board to the account on first sign-in", async () => {
    const srv = server(), b = browser(snap("local work"));
    const { s, last } = sync(srv, b, true);
    await s.start();
    expect(text(srv.boards.get("main")!.snapshot)).toBe("local work");
    expect(last()).toMatchObject({ state: "saved", revision: 1, note: expect.stringContaining("Moved") });
    expect(b.stored.memo).toEqual({ account: "alice", boardId: "main", revision: 1, dirty: false, hash: contentHash(snap("local work")) });
  });

  it("loads the account's board into a clean browser without making a copy", async () => {
    const srv = server();
    await srv.api.put("main", 0, snap("from laptop"));
    const b = browser(snap("welcome board"));
    const { s, last } = sync(srv, b, false);
    await s.start();
    expect(text(b.doc)).toBe("from laptop");
    expect([...srv.boards.keys()]).toEqual(["main"]);
    expect(last()).toMatchObject({ state: "saved", revision: 1 });
    expect(b.stored.memo?.dirty).toBe(false);
  });

  it("keeps a browser's own earlier work as a separate board before loading the account's", async () => {
    const srv = server();
    await srv.api.put("main", 0, snap("from laptop"));
    const b = browser(snap("work only in this browser"));
    const { s, last } = sync(srv, b, true);
    await s.start();
    const id = copyId("main", new Date("2026-11-26T10:00:00Z"));
    expect(text(srv.boards.get(id)!.snapshot)).toBe("work only in this browser");
    expect(text(b.doc)).toBe("from laptop");
    expect(last()).toMatchObject({ note: expect.stringContaining(id) });
  });

  it("saves edits after a pause, on the revision it last saw", async () => {
    const srv = server(), b = browser(snap("v1"));
    const { s } = sync(srv, b, true);
    await s.start();
    b.edit("v2");
    expect(b.stored.memo?.dirty).toBe(true);
    await b.flush();
    expect(srv.boards.get("main")).toMatchObject({ revision: 2 });
    expect(text(srv.boards.get("main")!.snapshot)).toBe("v2");
    expect(b.stored.memo).toMatchObject({ revision: 2, dirty: false });
  });

  it("does not echo a board it loaded back to the server", async () => {
    const srv = server();
    await srv.api.put("main", 0, snap("server"));
    const b = browser(snap("welcome"));
    const { s } = sync(srv, b, false);
    await s.start();
    await b.flush();
    expect(srv.boards.get("main")!.revision).toBe(1);
  });

  it("on a stale save, keeps the other version in history and puts this tab's edit on top", async () => {
    const srv = server(), b = browser(snap("v1"));
    const { s, last } = sync(srv, b, true);
    await s.start();
    await srv.api.put("main", 1, snap("other tab")); // revision 2 from elsewhere
    b.edit("this tab");
    await b.flush();
    const board = srv.boards.get("main")!;
    expect(board.revision).toBe(3);
    expect(text(board.snapshot)).toBe("this tab");
    expect(board.history.map(text)).toEqual(["v1", "other tab", "this tab"]);
    expect(last()).toMatchObject({ state: "saved", note: expect.stringContaining("this tab's edit was kept") });
  });

  it("after a reload with unsaved edits, pushes them instead of loading over them", async () => {
    const srv = server();
    await srv.api.put("main", 0, snap("v1"));
    const b = browser(snap("edited offline"), { account: "alice", boardId: "main", revision: 1, dirty: true });
    const { s } = sync(srv, b, true);
    await s.start();
    expect(text(srv.boards.get("main")!.snapshot)).toBe("edited offline");
    expect(text(b.doc)).toBe("edited offline");
  });

  it("when both moved, never replaces the account's newer board: this browser's edits become a separate board", async () => {
    const srv = server();
    await srv.api.put("main", 0, snap("v1"));
    await srv.api.put("main", 1, snap("phone"));
    const b = browser(snap("laptop offline"), { account: "alice", boardId: "main", revision: 1, dirty: true });
    const { s, last } = sync(srv, b, true);
    await s.start();
    const id = copyId("main", new Date("2026-11-26T10:00:00Z"));
    expect(srv.boards.get("main")!.history.map(text)).toEqual(["v1", "phone"]);
    expect(text(srv.boards.get(id)!.snapshot)).toBe("laptop offline");
    expect(text(b.doc)).toBe("phone");
    expect(b.stored.memo).toMatchObject({ revision: 2, dirty: false });
    expect(last()).toMatchObject({ state: "saved", revision: 2, note: expect.stringContaining(id) });
  });

  it("at the board limit, never replaces the account's board when this browser's work cannot be set aside", async () => {
    const srv = server();
    await srv.api.put("main", 0, snap("v1"));
    await srv.api.put("main", 1, snap("phone"));
    // The account is at its board limit: any new board is refused, as the server does with 403.
    const put = srv.api.put;
    srv.api.put = async (id, rev, snapshot) =>
      id !== "main" && rev === 0 ? { ok: false, stale: false, refused: 403, error: "This account already has 50 boards" } : put(id, rev, snapshot);
    // Case 1: unsaved edits on an older revision. Case 2 (below): earlier work with no memo at all.
    for (const memo of [{ account: "alice", boardId: "main", revision: 1, dirty: true }, null] as const) {
    const b = browser(snap("laptop offline"), memo);
    const { s } = sync(srv, b, true);
    await s.start().catch(() => undefined);
    // Let any automatic retries run, then the person keeps working: the next save must still
    // not land on the account's board, which this browser never merged with.
    for (let i = 0; i < 4 && b.timers.length; i++) await Promise.resolve(b.timers.shift()!()).catch(() => undefined);
    for (const t of ["laptop, more work", "laptop, still more"]) {
      b.edit(t);
      for (let i = 0; i < 4 && b.timers.length; i++) await Promise.resolve(b.timers.shift()!()).catch(() => undefined);
    }
    expect(srv.boards.get("main")!.history.map(text)).toEqual(["v1", "phone"]);
    expect(text(b.doc)).toBe("laptop, still more");
    }
  });

  it("when two browsers create the account's board at once, the loser keeps its board as a separate one", async () => {
    const srv = server(), b = browser(snap("second browser"));
    const get = srv.api.get;
    // The account has no board when this browser looks, and one by the time it saves.
    srv.api.get = async (id) => {
      const found = await get(id);
      if (id === "main" && !found) await srv.api.put("main", 0, snap("first browser"));
      return found;
    };
    const { s, last } = sync(srv, b, true);
    await s.start();
    const id = copyId("main", new Date("2026-11-26T10:00:00Z"));
    expect(srv.boards.get("main")!.history.map(text)).toEqual(["first browser"]);
    expect(text(srv.boards.get(id)!.snapshot)).toBe("second browser");
    expect(text(b.doc)).toBe("first browser");
    expect(last()).toMatchObject({ state: "saved", revision: 1, note: expect.stringContaining(id) });
  });

  it("loads the account's newer board when this browser has nothing unsaved", async () => {
    const srv = server();
    await srv.api.put("main", 0, snap("v1"));
    await srv.api.put("main", 1, snap("phone"));
    const b = browser(snap("v1"), { account: "alice", boardId: "main", revision: 1, dirty: false });
    const { s } = sync(srv, b, true);
    await s.start();
    expect(text(b.doc)).toBe("phone");
    expect(srv.boards.size).toBe(1);
  });

  it("goes offline without losing edits and saves them when the server is back", async () => {
    const srv = server(), b = browser(snap("v1"));
    const { s, statuses } = sync(srv, b, true);
    await s.start();
    srv.setDown(true);
    b.edit("written offline");
    await b.timers.shift()!();
    expect(statuses.at(-1)).toMatchObject({ state: "offline" });
    expect(b.stored.memo?.dirty).toBe(true);
    srv.setDown(false);
    await b.flush();
    expect(text(srv.boards.get("main")!.snapshot)).toBe("written offline");
    expect(statuses.at(-1)).toMatchObject({ state: "saved" });
  });

  it("does not treat another account's memo as this account's", async () => {
    const srv = server("bob");
    await srv.api.put("main", 0, snap("bob's board"));
    const b = browser(snap("alice's local"), { account: "alice", boardId: "main", revision: 1, dirty: false });
    const { s } = sync(srv, b, true);
    await s.start();
    expect(text(b.doc)).toBe("bob's board");
  });
});

describe("board sync across accounts", () => {
  it("never uploads or overwrites another account's unsaved work", async () => {
    const srv = server("bob");
    await srv.api.put("main", 0, snap("bob's board"));
    const b = browser(snap("alice unsaved"), { account: "alice", boardId: "main", revision: 1, dirty: true });
    const { s, last } = sync(srv, b, true);
    await s.start();
    expect(text(b.doc)).toBe("alice unsaved");
    expect([...srv.boards.keys()]).toEqual(["main"]);
    expect(text(srv.boards.get("main")!.snapshot)).toBe("bob's board");
    expect(last()).toMatchObject({ state: "local", note: expect.stringContaining("another account") });
    b.edit("alice more");
    await b.flush();
    expect(text(srv.boards.get("main")!.snapshot)).toBe("bob's board");
  });
});

describe("board sync and late store events", () => {
  it("ignores changes reported before start decided, such as laying out the welcome board", async () => {
    const srv = server();
    await srv.api.put("main", 0, snap("from laptop"));
    const b = browser(snap("welcome"));
    const { s } = sync(srv, b, false);
    b.edit("welcome"); // the layout is already in the store; only its event arrives late
    await s.start();
    expect(text(b.doc)).toBe("from laptop");
    expect([...srv.boards.keys()]).toEqual(["main"]);
  });

  it("skips a save whose content is what was last loaded (a late echo of the load)", async () => {
    const srv = server();
    await srv.api.put("main", 0, snap("server"));
    const b = browser(snap("welcome"));
    const { s } = sync(srv, b, false);
    await s.start();
    b.local.listen(() => undefined);
    // The editor reports the load as a change after the fact; content is unchanged.
    b.edit("server");
    await b.flush();
    expect(srv.boards.get("main")!.revision).toBe(1);
    expect(b.stored.memo?.dirty).toBe(false);
  });
});

const doc = (records: Record<string, string>): Snapshot => ({
  store: Object.fromEntries(Object.entries(records).map(([id, v]) => [id, { id, typeName: "shape", v }])),
  schema: { schemaVersion: 2 },
});
const values = (s: Snapshot) => Object.fromEntries(Object.entries(s.store).map(([id, r]) => [id, (r as { v: string }).v]));

describe("mergeSnapshots", () => {
  const base = doc({ a: "a0", b: "b0", c: "c0" });
  it("keeps each side's changes to different objects, including additions and deletions", () => {
    const mine = doc({ a: "a-mine", b: "b0", c: "c0", m: "new mine" });
    const theirs = doc({ a: "a0", b: "b-theirs", t: "new theirs" }); // deleted c
    const { snapshot, conflicts } = mergeSnapshots(base, mine, theirs);
    expect(values(snapshot)).toEqual({ a: "a-mine", b: "b-theirs", m: "new mine", t: "new theirs" });
    expect(conflicts).toEqual([]);
  });
  it("keeps this tab's version where both changed the same object, and reports it", () => {
    const { snapshot, conflicts } = mergeSnapshots(base, doc({ a: "mine", b: "b0", c: "c0" }), doc({ a: "theirs", b: "b0", c: "c0" }));
    expect(values(snapshot).a).toBe("mine");
    expect(conflicts).toEqual(["a"]);
  });
  it("keeps an object one side edited and the other deleted", () => {
    expect(values(mergeSnapshots(base, doc({ a: "edited", b: "b0", c: "c0" }), doc({ b: "b0", c: "c0" })).snapshot).a).toBe("edited");
    expect(values(mergeSnapshots(base, doc({ b: "b0", c: "c0" }), doc({ a: "edited", b: "b0", c: "c0" })).snapshot).a).toBe("edited");
  });
  it("treats identical changes on both sides as no conflict", () => {
    expect(mergeSnapshots(base, doc({ a: "x", b: "b0", c: "c0" }), doc({ a: "x", b: "b0", c: "c0" })).conflicts).toEqual([]);
  });
});

describe("board sync merges a stale save", () => {
  it("keeps another tab's edit to one object and this tab's new object", async () => {
    const srv = server();
    const b = browser(doc({ a: "a0" }));
    const { s, last } = sync(srv, b, true);
    await s.start();
    const other = doc({ a: "edited elsewhere" });
    await srv.api.put("main", 1, other);
    // This tab adds an object without touching a.
    b.local.load(doc({ a: "a0", n: "new here" }));
    await b.flush();
    expect(values(srv.boards.get("main")!.snapshot)).toEqual({ a: "edited elsewhere", n: "new here" });
    expect(values(b.doc)).toEqual({ a: "edited elsewhere", n: "new here" });
    expect(last()).toMatchObject({ state: "saved", note: "Merged changes from another tab or device." });
  });
});

describe("board sync during the first load", () => {
  it("does not carry the welcome board settling (changes to existing records) onto the account's board", async () => {
    const srv = server();
    await srv.api.put("main", 0, doc({ a: "from laptop" }));
    const b = browser(doc({ w: "welcome" }));
    const { s } = sync(srv, b, false);
    const started = s.start();
    b.local.load(doc({ w: "welcome, re-measured" }));
    await started;
    expect(values(b.doc)).toEqual({ a: "from laptop" });
    expect(srv.boards.get("main")!.revision).toBe(1);
  });

  it("carries objects created while the account's board was loading onto it", async () => {
    const srv = server();
    await srv.api.put("main", 0, doc({ a: "from laptop" }));
    const b = browser(doc({ w: "welcome" }));
    const { s, last } = sync(srv, b, false);
    const started = s.start();
    b.local.load(doc({ w: "welcome", n: "typed while loading" })); // a real edit before start finished
    await started;
    expect(values(b.doc)).toEqual({ a: "from laptop", n: "typed while loading" });
    expect(values(srv.boards.get("main")!.snapshot)).toEqual({ a: "from laptop", n: "typed while loading" });
    expect(last()).toMatchObject({ state: "saved", revision: 2, note: expect.stringContaining("while your board was loading") });
  });
});

describe("withNewRecords", () => {
  const rec = (id: string, parentId?: string) => ({ id, typeName: id.startsWith("user") ? "user" : "shape", ...(parentId ? { parentId } : {}) });
  const snapOf = (...rs: ReturnType<typeof rec>[]): Snapshot => ({ store: Object.fromEntries(rs.map((r) => [r.id, r])), schema: { schemaVersion: 2 } });
  it("adds new records whose parents exist, in any order, and skips orphans and user records", () => {
    const initial = snapOf(rec("page:1"), rec("w", "page:1"));
    const current = snapOf(rec("page:1"), rec("w", "page:1"), rec("child", "frame"), rec("frame", "page:1"), rec("orphan", "gone"), rec("user:x"));
    const server = snapOf(rec("page:1"), rec("a", "page:1"));
    const { snapshot, kept } = withNewRecords(initial, current, server);
    expect(Object.keys(snapshot.store).sort()).toEqual(["a", "child", "frame", "page:1"]);
    expect(kept).toBe(2);
  });

  it("carries the person's edits to objects the account also has, field by field, but not derived fields", () => {
    const card = (over: Record<string, unknown> = {}, props: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) =>
      ({ id: "shape:c", typeName: "shape", type: "card", x: 0, y: 0, parentId: "page:1", props: { text: "old", h: 100, color: "black", ...props }, meta: { revision: 1, ...meta }, ...over });
    const page = { id: "page:1", typeName: "page" };
    const board = (...rs: object[]): Snapshot => ({ store: Object.fromEntries(rs.map((r) => [(r as { id: string }).id, r])), schema: { schemaVersion: 2 } });
    const initial = board(page, card());
    // While loading, the person moved the card; this tab also re-measured its height.
    const current = board(page, card({ x: 300 }, { h: 140 }, { revision: 2 }));
    // Meanwhile another device changed its text and colour.
    const server = board(page, card({}, { text: "new text", color: "violet" }, { revision: 2 }));
    const { snapshot, kept } = withNewRecords(initial, current, server);
    expect(kept).toBe(1);
    expect(snapshot.store["shape:c"]).toMatchObject({ x: 300, props: { text: "new text", color: "violet", h: 100 }, meta: { revision: 3 } });
    // Only a re-measure (no edit): the account's version stands untouched.
    const settled = withNewRecords(initial, board(page, card({}, { h: 140 })), server);
    expect(settled.kept).toBe(0);
    expect(settled.snapshot.store["shape:c"]).toEqual(server.store["shape:c"]);
    // A record the account lacks (a new browser's welcome card) is never carried.
    const welcome = withNewRecords(board(page, card()), board(page, card({ x: 300 })), board(page));
    expect(welcome.snapshot.store["shape:c"]).toBeUndefined();
  });

  it("moves parent and position together, and never leaves a card under a frame that is gone", () => {
    const shape = (id: string, over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({ id, typeName: "shape", type: id.includes("frame") ? "frame" : "card", x: 0, y: 0, rotation: 0, parentId: "page:1", props: {}, meta: { revision: 10, ...meta }, ...over });
    const page = { id: "page:1", typeName: "page" };
    const board = (...rs: object[]): Snapshot => ({ store: Object.fromEntries(rs.map((r) => [(r as { id: string }).id, r])), schema: { schemaVersion: 2 } });
    // The account grouped the card into a frame (x 50 inside it); this tab moved it on the page to 600.
    const frame = shape("shape:frame", { x: 450 });
    const initial = board(page, frame, shape("shape:c", { x: 500 }));
    const moved = board(page, frame, shape("shape:c", { x: 600 }, { revision: 11 }));
    const grouped = board(page, frame, shape("shape:c", { x: 50, parentId: "shape:frame" }, { revision: 11 }));
    const a = withNewRecords(initial, moved, grouped).snapshot.store["shape:c"] as Record<string, unknown>;
    expect([a.parentId, a.x]).toEqual(["page:1", 600]); // the person's placement, whole: still at page x 600
    // This tab dropped the card into a frame the account has since deleted: the account's placement stands.
    const dropped = board(page, frame, shape("shape:c", { x: 20, parentId: "shape:frame" }, { revision: 11 }));
    const frameGone = board(page, shape("shape:c", { x: 500 }));
    const b = withNewRecords(initial, dropped, frameGone).snapshot.store["shape:c"] as Record<string, unknown>;
    expect([b.parentId, b.x]).toEqual(["page:1", 500]);
  });

  it("never issues an object revision twice when the account changed it and changed it back", () => {
    const card = (meta: Record<string, unknown>, props: Record<string, unknown> = {}) => ({ id: "shape:c", typeName: "shape", type: "card", x: 0, y: 0, parentId: "page:1", props: { color: "black", ...props }, meta });
    const board = (r: object): Snapshot => ({ store: { "page:1": { id: "page:1", typeName: "page" }, "shape:c": r }, schema: { schemaVersion: 2 } });
    const merged = withNewRecords(board(card({ revision: 10 })), board(card({ revision: 11 }, { color: "red" })), board(card({ revision: 12 })));
    expect((merged.snapshot.store["shape:c"] as { meta: { revision: number } }).meta.revision).toBe(13);
  });

  it("restores an earlier revision as the newest one, keeping the board before it in history", async () => {
    const srv = server(), b = browser(snap("v1"));
    const { s, last } = sync(srv, b, true);
    await s.start();
    b.edit("v2");
    await b.flush();
    b.edit("v3");
    await b.flush();
    expect(srv.boards.get("main")!.revision).toBe(3);
    expect((await s.revisions())?.map((r) => r.revision)).toEqual([3, 2, 1]);
    expect(await s.restore(1)).toEqual({ revision: 4, restoredFrom: 1 });
    expect(text(b.doc)).toBe("v1");
    expect(text(srv.boards.get("main")!.snapshot)).toBe("v1");
    expect(text(srv.boards.get("main")!.history[2])).toBe("v3"); // nothing lost
    expect(last()).toMatchObject({ state: "saved", revision: 4, note: expect.stringContaining("revision 3") });
    expect(b.stored.memo).toMatchObject({ revision: 4, dirty: false });
    // The restore is undone by restoring the revision it replaced.
    await s.restore(3);
    expect(text(b.doc)).toBe("v3");
  });

  it("saves edits made in this tab before restoring, so they stay in history", async () => {
    const srv = server(), b = browser(snap("v1"));
    const { s } = sync(srv, b, true);
    await s.start();
    b.edit("unsaved thought"); // debounce timer not run yet
    await s.restore(1);
    expect(srv.boards.get("main")!.history.map(text)).toEqual(["v1", "unsaved thought", "v1"]);
    expect(text(b.doc)).toBe("v1");
  });

  it("refuses a pruned revision without touching the board, and needs an account", async () => {
    const srv = server(), b = browser(snap("v1"));
    const { s } = sync(srv, b, true);
    await s.start();
    await expect(s.restore(9)).rejects.toThrow(/no longer kept/);
    expect(text(b.doc)).toBe("v1");
    expect(srv.boards.get("main")!.revision).toBe(1);
    const out = sync(server(null), browser(snap("x")), false);
    await out.s.start();
    await expect(out.s.restore(1)).rejects.toThrow(/account/);
    expect(await out.s.revisions()).toBeNull();
  });

  it("opens another saved board, saving this one first, and keeps saving to the opened one", async () => {
    const srv = server();
    await srv.api.put("main-browser-202611260900", 0, snap("kept from an old browser"));
    const b = browser(snap("main work"));
    const { s, last } = sync(srv, b, true);
    await s.start();
    expect(s.boardId()).toBe("main");
    expect((await s.boards())?.map((x) => x.id).sort()).toEqual(["main", "main-browser-202611260900"]);
    b.edit("main, edited"); // not saved yet
    expect(await s.open("main-browser-202611260900")).toEqual({ boardId: "main-browser-202611260900", previous: "main" });
    expect(text(srv.boards.get("main")!.snapshot)).toBe("main, edited"); // saved before leaving
    expect(text(b.doc)).toBe("kept from an old browser");
    expect(last()).toMatchObject({ state: "saved", revision: 1, note: expect.stringContaining('"main" is saved') });
    expect(b.stored.memo).toEqual({ account: "alice", boardId: "main-browser-202611260900", revision: 1, dirty: false, hash: contentHash(snap("kept from an old browser")) });
    b.edit("old work, continued");
    await b.flush();
    expect(text(srv.boards.get("main-browser-202611260900")!.snapshot)).toBe("old work, continued");
    expect(text(srv.boards.get("main")!.snapshot)).toBe("main, edited");
  });

  it("reopens the board this browser last had open after a reload", async () => {
    const srv = server();
    await srv.api.put("main", 0, snap("main"));
    await srv.api.put("other", 0, snap("other board"));
    // tldraw kept the opened board in this browser, so that is what reopens locally.
    const b = browser(snap("other board"), { account: "alice", boardId: "other", revision: 1, dirty: false });
    const { s, last } = sync(srv, b, true);
    await s.start();
    expect(s.boardId()).toBe("other");
    expect(text(b.doc)).toBe("other board");
    expect(last()).toMatchObject({ state: "saved", revision: 1 });
    expect([...srv.boards.keys()].sort()).toEqual(["main", "other"]); // nothing set aside
    b.edit("other, edited");
    await b.flush();
    expect(text(srv.boards.get("other")!.snapshot)).toBe("other, edited");
    expect(text(srv.boards.get("main")!.snapshot)).toBe("main");
  });

  it("refuses to open a board that does not exist, leaving this one open", async () => {
    const srv = server(), b = browser(snap("v1"));
    const { s } = sync(srv, b, true);
    await s.start();
    await expect(s.open("nope")).rejects.toThrow(/not found/);
    expect(s.boardId()).toBe("main");
    expect(text(b.doc)).toBe("v1");
  });

  it("does not claim a restore when another tab or device saved since this tab last did", async () => {
    const srv = server(), b = browser(snap("v1"));
    const { s } = sync(srv, b, true);
    await s.start();
    b.edit("v2");
    await b.flush(); // this tab is clean at revision 2
    await srv.api.put("main", 2, snap("from another device")); // revision 3
    await expect(s.restore(2)).rejects.toThrow(/changed on another tab or device/);
    await expect(s.restore(1)).rejects.toThrow(/changed on another tab or device/);
    // Nothing was written and no hybrid was saved; this tab's board is as it was.
    expect(srv.boards.get("main")!.revision).toBe(3);
    expect(text(srv.boards.get("main")!.snapshot)).toBe("from another device");
    expect(text(b.doc)).toBe("v2");
  });

  it("restores the oldest kept revision even when saving pending edits prunes it", async () => {
    const srv = server("alice", 3), b = browser(snap("v1"));
    const { s } = sync(srv, b, true);
    await s.start();
    for (const t of ["v2", "v3"]) {
      b.edit(t);
      await b.flush();
    }
    expect((await s.revisions())?.map((r) => r.revision)).toEqual([3, 2, 1]);
    b.edit("pending"); // saving this prunes revision 1
    await s.restore(1);
    expect(text(b.doc)).toBe("v1");
    expect(text(srv.boards.get("main")!.snapshot)).toBe("v1");
    expect(srv.boards.get("main")!.history.map(text)).toEqual(["v3", "pending", "v1"]);
  });

  it("keeps an edit made while the earlier version is downloading", async () => {
    const srv = server(), b = browser(snap("v1"));
    const { s } = sync(srv, b, true);
    await s.start();
    b.edit("v2");
    await b.flush();
    let release!: () => void;
    srv.hooks.beforeRevision = () => new Promise<void>((done) => (release = done));
    const restoring = s.restore(1);
    await Promise.resolve();
    b.edit("typed during the download");
    release();
    await restoring;
    expect(text(b.doc)).toBe("v1");
    expect(srv.boards.get("main")!.history.map(text)).toEqual(["v1", "v2", "typed during the download", "v1"]);
  });

  it("forgets undo history when another board is opened", async () => {
    const srv = server();
    await srv.api.put("other", 0, snap("other board"));
    const b = browser(snap("main work"));
    const { s } = sync(srv, b, true);
    await s.start();
    await s.open("other");
    expect(b.resets).toBe(1);
  });

  it("keeps an edit made while the other board is loading", async () => {
    const srv = server();
    await srv.api.put("other", 0, snap("other board"));
    const b = browser(snap("main work"));
    const { s } = sync(srv, b, true);
    await s.start();
    let release!: () => void;
    srv.hooks.beforeGet = () => new Promise<void>((done) => (release = done));
    const opening = s.open("other");
    await Promise.resolve();
    b.edit("typed while opening");
    release();
    srv.hooks.beforeGet = undefined;
    await opening;
    expect(text(srv.boards.get("main")!.snapshot)).toBe("typed while opening");
    expect(text(b.doc)).toBe("other board");
  });

  it("saves to the board another tab of this browser opened, never over the one this tab started on", async () => {
    const srv = server();
    await srv.api.put("main", 0, snap("main"));
    await srv.api.put("other", 0, snap("other board"));
    const shared = { memo: { account: "alice", boardId: "main", revision: 1, dirty: false } as SyncMemo | null };
    const a = browser(snap("main"), null, shared), b = browser(snap("main"), null, shared);
    const tabA = sync(srv, a, true), tabB = sync(srv, b, true);
    await tabA.s.start();
    await tabB.s.start();
    await tabA.s.open("other");
    b.remote(a.doc); // tldraw broadcasts the switch to tab B's store
    b.edit("edited in tab B");
    await b.flush();
    expect(text(srv.boards.get("main")!.snapshot)).toBe("main");
    expect(text(srv.boards.get("other")!.snapshot)).toBe("edited in tab B");
    expect(tabB.s.boardId()).toBe("other");
  });

  it("keeps the open board when edited offline after a reload, and saves to it on reconnect", async () => {
    const srv = server();
    await srv.api.put("main", 0, snap("main"));
    await srv.api.put("other", 0, snap("other board"));
    const b = browser(snap("other board"), { account: "alice", boardId: "other", revision: 1, dirty: false });
    const { s } = sync(srv, b, true);
    srv.setDown(true);
    await s.start();
    b.edit("other, edited offline");
    expect(b.stored.memo).toMatchObject({ boardId: "other", revision: 1, dirty: true });
    srv.setDown(false);
    await b.flush();
    expect(text(srv.boards.get("other")!.snapshot)).toBe("other, edited offline");
    expect(text(srv.boards.get("main")!.snapshot)).toBe("main");
  });
  it("says why a refused save failed, and stops retrying until the board changes", async () => {
    const srv = server(), b = browser(snap("v1"));
    const { s, last } = sync(srv, b, true);
    await s.start();
    b.edit("HUGE board");
    await b.flush();
    expect(last()).toEqual({ state: "refused", account: "alice", code: 413, error: "Boards are limited to 10 MB" });
    expect(b.timers).toHaveLength(0); // no retry scheduled
    const tries = srv.uploads.length;
    // Saving again with nothing changed does not re-upload the same refused board.
    await s.save();
    expect(srv.uploads.length).toBe(tries);
    expect(last()).toMatchObject({ state: "refused" });
    expect(b.stored.memo?.dirty).toBe(true); // the work is still only in this browser
    // A change is tried once more; once the board fits, it saves.
    b.edit("HUGE but edited");
    await b.flush();
    expect(srv.uploads.length).toBe(tries + 1);
    expect(last()).toMatchObject({ state: "refused" });
    b.edit("small again");
    await b.flush();
    expect(text(srv.boards.get("main")!.snapshot)).toBe("small again");
    expect(last()).toMatchObject({ state: "saved", revision: 2 });
  });

  it("reports a refused first save instead of going offline", async () => {
    const srv = server(), b = browser(snap("HUGE local board"));
    const { s, last } = sync(srv, b, true);
    await s.start();
    expect(last()).toMatchObject({ state: "refused", code: 413 });
    expect(b.timers).toHaveLength(0);
  });


  it("holds what the server stores when the board has half an emoji, so a deletion is not undone by a merge", async () => {
    const card = (id: string, text: string) => ({ id, typeName: "shape", text });
    const board = (...cards: ReturnType<typeof card>[]): Snapshot => ({ store: Object.fromEntries(cards.map((c) => [c.id, c])), schema: { schemaVersion: 2 } });
    const srv = server();
    const a = browser(board(card("shape:a", "Plans \uD83D"), card("shape:b", "other")));
    const tabA = sync(srv, a, true);
    await tabA.s.start(); // first save; the server repairs the half emoji
    expect((a.doc.store["shape:a"] as { text: string }).text).toBe("Plans \uFFFD"); // this tab holds the same
    // Another browser opens the board and adds a card.
    const b = browser(board(), null);
    await sync(srv, b, false).s.start();
    b.local.load(board(...(Object.values(srv.boards.get("main")!.snapshot.store) as ReturnType<typeof card>[]), card("shape:c", "from B")));
    await srv.api.put("main", 1, b.local.snapshot());
    // A deletes card a; its save is stale and merges B's card in.
    const { "shape:a": _gone, ...rest } = a.doc.store;
    a.local.load({ ...a.doc, store: rest });
    await tabA.s.save();
    expect(Object.keys(srv.boards.get("main")!.snapshot.store).sort()).toEqual(["shape:b", "shape:c"]);
  });

  it("forgets undo and redo after a restore, so redo cannot bring a newer object back", async () => {
    const srv = server(), b = browser(snap("Draft"));
    const { s } = sync(srv, b, true);
    await s.start();
    b.edit("Final");
    await b.flush();
    await s.restore(1);
    expect(text(b.doc)).toBe("Draft");
    expect(b.resets).toBe(1);
  });

  it("reopens the restored board when the tab reloads before the browser stored it", async () => {
    const srv = server(), b = browser(snap("v1"));
    const { s } = sync(srv, b, true);
    await s.start();
    b.edit("v2");
    await b.flush();
    await s.restore(1); // the server and the memo now say "v1" at revision 3
    expect(b.stored.memo).toMatchObject({ revision: 3, dirty: false, hash: contentHash(snap("v1")) });
    // Reload at once: tldraw had not yet written the restored board, so this browser still holds v2.
    const again = browser(snap("v2"), b.stored.memo);
    const reopened = sync(srv, again, true);
    await reopened.s.start();
    expect(text(again.doc)).toBe("v1");
    again.edit("v1, then edited");
    await again.flush();
    expect(srv.boards.get("main")!.history.map(text)).toEqual(["v1", "v2", "v1", "v1, then edited"]);
  });

  it("keeps this browser's copy when it matches the last sync, and trusts memos without a hash", async () => {
    const srv = server();
    await srv.api.put("main", 0, snap("on the server"));
    const same = browser(snap("on the server"), { account: "alice", boardId: "main", revision: 1, dirty: false, hash: contentHash(snap("on the server")) });
    await sync(srv, same, true).s.start();
    expect(text(same.doc)).toBe("on the server");
    // A memo written before hashes existed behaves as before: the local copy is trusted.
    const old = browser(snap("local copy"), { account: "alice", boardId: "main", revision: 1, dirty: false });
    await sync(srv, old, true).s.start();
    expect(text(old.doc)).toBe("local copy");
  });

  it("hashes board content the same whatever the key order", () => {
    const a: Snapshot = { store: { "shape:a": { id: "shape:a", x: 1, props: { w: 2, h: 3 } } }, schema: {} };
    const b: Snapshot = { store: { "shape:a": { props: { h: 3, w: 2 }, x: 1, id: "shape:a" } }, schema: { other: true } };
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).not.toBe(contentHash(snap("x")));
  });

  it("keeps the recovered board through a second reload before the browser stores it", async () => {
    const srv = server(), b = browser(snap("v1"));
    const { s } = sync(srv, b, true);
    await s.start();
    b.edit("v2");
    await b.flush();
    await s.restore(1);
    // First reload: the browser still holds v2, so the account's v1 is loaded; tldraw reports it later.
    const first = browser(snap("v2"), b.stored.memo, undefined, { lateNotify: true });
    await sync(srv, first, true).s.start();
    first.deliver(); // the load's own report must not count as an edit
    expect(first.stored.memo).toMatchObject({ dirty: false });
    // Second reload, still before the browser stored v1.
    const second = browser(snap("v2"), first.stored.memo);
    await sync(srv, second, true).s.start();
    expect(text(second.doc)).toBe("v1");
    expect(text(srv.boards.get("main")!.snapshot)).toBe("v1");
  });

  it("keeps an edit made while a save was in flight when the tab reloads before saving it", async () => {
    const srv = server(), b = browser(snap("v1"));
    const { s } = sync(srv, b, true);
    await s.start();
    b.edit("first edit");
    let release!: () => void;
    srv.hooks.beforePut = () => new Promise<void>((done) => (release = done));
    const saving = b.timers.shift()!(); // saves "first edit"; the server holds the request
    await Promise.resolve();
    b.edit("second edit"); // its save is still waiting on its debounce
    srv.hooks.beforePut = undefined;
    release();
    await saving;
    expect(b.stored.memo).toMatchObject({ dirty: true });
    // Reload now: the browser stored "second edit", the account has "first edit".
    const again = browser(snap("second edit"), b.stored.memo);
    await sync(srv, again, true).s.start();
    expect(text(again.doc)).toBe("second edit");
    expect(text(srv.boards.get("main")!.snapshot)).toBe("second edit");
  });

  it("saves an edit made while the board was connecting instead of replacing it", async () => {
    const srv = server();
    await srv.api.put("main", 0, snap("on the server"));
    const b = browser(snap("on the server"), { account: "alice", boardId: "main", revision: 1, dirty: false, hash: contentHash(snap("on the server")) });
    let release!: () => void;
    srv.hooks.beforeGet = () => new Promise<void>((done) => (release = done));
    const starting = sync(srv, b, true).s.start();
    await Promise.resolve();
    b.edit("moved while connecting");
    srv.hooks.beforeGet = undefined;
    release();
    await starting;
    expect(text(b.doc)).toBe("moved while connecting");
    expect(text(srv.boards.get("main")!.snapshot)).toBe("moved while connecting");
  });

  it("saves an edit made while a refused upload was in flight", async () => {
    const srv = server(), b = browser(snap("v1"));
    const { s, last } = sync(srv, b, true);
    await s.start();
    b.edit("HUGE board");
    let release!: () => void;
    srv.hooks.beforePut = () => new Promise<void>((done) => (release = done));
    const uploading = b.timers.shift()!(); // the debounced save starts and waits on the server
    await Promise.resolve();
    b.edit("trimmed to fit"); // schedules its own save while the upload is in flight
    srv.hooks.beforePut = undefined;
    release();
    await uploading;
    expect(last()).toMatchObject({ state: "refused" });
    await b.flush();
    expect(text(srv.boards.get("main")!.snapshot)).toBe("trimmed to fit");
    expect(last()).toMatchObject({ state: "saved" });
  });

  it("keeps an edit to an existing object made while the account's newer board loads", async () => {
    const srv = server();
    await srv.api.put("main", 0, snap("v1"));
    await srv.api.put("main", 1, snap("v2 from another device"));
    // This browser last synced revision 1; its board loads while the person edits the card.
    const b = browser(snap("v1"), { account: "alice", boardId: "main", revision: 1, dirty: false });
    let release!: () => void;
    srv.hooks.beforeGet = () => new Promise<void>((done) => (release = done));
    const starting = sync(srv, b, true).s.start();
    await Promise.resolve();
    b.edit("edited while loading");
    srv.hooks.beforeGet = undefined;
    release();
    await starting;
    expect(text(b.doc)).toBe("edited while loading");
    expect(text(srv.boards.get("main")!.snapshot)).toBe("edited while loading");
    expect(srv.boards.get("main")!.history.map(text)).toEqual(["v1", "v2 from another device", "edited while loading"]);
  });
});

