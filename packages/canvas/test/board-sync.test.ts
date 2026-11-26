import { describe, expect, it } from "vitest";
import { contentHash, copyId, createBoardSync, mergeSnapshots, withNewRecords, type BoardApi, type Snapshot, type SyncMemo, type SyncStatus } from "../src/board-sync";

const snap = (text: string): Snapshot => ({ store: { "shape:a": { id: "shape:a", typeName: "shape", text } }, schema: { schemaVersion: 2 } });
const text = (s: Snapshot) => (s.store["shape:a"] as { text: string }).text;

/** A fake server with the real contract: revisions, stale rejection, create at 0. */
function server(signedIn: string | null = "alice", keep = 50) {
  // history[i] is revision first + i; the oldest are pruned beyond `keep`, as on the server.
  const boards = new Map<string, { revision: number; snapshot: Snapshot; history: Snapshot[]; first: number }>();
  let down = false;
  const hooks: { beforeRevision?: () => Promise<void> } = {};
  const uploads: string[] = [];
  const api: BoardApi = {
    async account() {
      if (down) throw new Error("offline");
      return signedIn;
    },
    async get(id) {
      if (down) throw new Error("offline");
      const b = boards.get(id);
      return b ? { revision: b.revision, snapshot: structuredClone(b.snapshot) } : null;
    },
    async put(id, expectedRevision, snapshot) {
      if (down) throw new Error("offline");
      uploads.push(id);
      if (JSON.stringify(snapshot).includes("HUGE")) return { ok: false, stale: false, refused: 413, error: "Boards are limited to 10 MB" };
      const b = boards.get(id);
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

function browser(initial: Snapshot, memo: SyncMemo | null = null) {
  let doc = structuredClone(initial);
  const listeners = new Set<() => void>();
  const stored = { memo };
  const timers: (() => void)[] = [];
  return {
    get doc() {
      return doc;
    },
    edit(t: string) {
      doc = snap(t);
      for (const l of listeners) l();
    },
    local: {
      snapshot: () => structuredClone(doc),
      load(s: Snapshot) {
        doc = structuredClone(s);
        for (const l of listeners) l();
      },
      listen(fn: () => void) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    memo: { get: () => stored.memo, set: (m: SyncMemo | null) => (stored.memo = m) },
    stored,
    timers,
    setTimer: (fn: () => void) => timers.push(fn),
    clearTimer: () => undefined,
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
});

