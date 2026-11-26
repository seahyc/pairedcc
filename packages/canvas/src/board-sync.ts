// Keeps the open board saved to the person's account (server boards, /api/canvas/boards),
// while tldraw keeps saving it in this browser as before. Pure controller: the network,
// the editor and browser storage come in as adapters, so it is unit-tested without a DOM.
//
// Rules, in order of priority:
// 1. Never lose a human edit. When this browser and the account disagree, the version that
//    would be replaced is kept: as an earlier server revision, or as a separate board.
// 2. The server rejects a save on a stale revision; the controller then re-reads and decides.
// 3. Offline is normal: work stays in this browser and is saved when the server is back.

export type Snapshot = { store: Record<string, unknown>; schema: Record<string, unknown> };
export type ServerBoard = { revision: number; snapshot: Snapshot };
export type PutResult =
  | { ok: true; revision: number }
  | { ok: false; stale: true; revision: number }
  | { ok: false; stale: false; error: string };

export type BoardApi = {
  /** The signed-in account, or null when signed out. Throws when the server is unreachable. */
  account(): Promise<string | null>;
  get(id: string): Promise<ServerBoard | null>;
  put(id: string, expectedRevision: number, snapshot: Snapshot): Promise<PutResult>;
};
export type LocalBoard = {
  snapshot(): Snapshot;
  load(snapshot: Snapshot): void;
  /** Calls back on every document change made in this tab; returns an unsubscribe. */
  listen(onChange: () => void): () => void;
};
/** What this browser last agreed with the account; kept in localStorage. */
export type SyncMemo = { account: string; boardId: string; revision: number; dirty: boolean };
export type MemoStore = { get(): SyncMemo | null; set(memo: SyncMemo | null): void };

export type SyncStatus =
  | { state: "local"; note?: string }
  | { state: "loading" | "saving"; account: string }
  | { state: "saved"; account: string; revision: number; at: number; note?: string }
  | { state: "offline"; account?: string; error: string };

export type SyncOptions = {
  api: BoardApi;
  local: LocalBoard;
  memo: MemoStore;
  boardId?: string;
  /** Whether this browser held work before sync started (false for a brand-new board). */
  hadLocalWork: boolean;
  onStatus?: (status: SyncStatus) => void;
  debounceMs?: number;
  now?: () => Date;
  setTimer?: (fn: () => unknown, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/**
 * Three-way merge of tldraw documents by record. A record only one side changed since
 * `base` takes that side's version (including deletion); a record both changed takes
 * `mine`, the edit made in this tab, except that an edit always beats a deletion. Returns the merge and the IDs both sides changed.
 */
export function mergeSnapshots(base: Snapshot, mine: Snapshot, theirs: Snapshot) {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const store: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const id of new Set([...Object.keys(base.store), ...Object.keys(mine.store), ...Object.keys(theirs.store)])) {
    const b = base.store[id], m = mine.store[id], t = theirs.store[id];
    const mineChanged = !same(b, m), theirsChanged = !same(b, t);
    let pick = mineChanged ? m : t;
    if (mineChanged && theirsChanged && !same(m, t)) {
      // An edit beats a deletion, so no one's edit disappears; otherwise this tab wins.
      pick = m === undefined ? t : m;
      if (m !== undefined && t !== undefined) conflicts.push(id);
    }
    if (pick !== undefined) store[id] = pick;
  }
  return { snapshot: { store, schema: mine.schema }, conflicts };
}

export function copyId(boardId: string, at: Date) {
  return `${boardId}-browser-${at.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
}

export function createBoardSync(o: SyncOptions) {
  const boardId = o.boardId ?? "main";
  const now = o.now ?? (() => new Date());
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let account: string | null = null;
  let revision = 0;
  let applying = false;
  let saving: Promise<void> | null = null;
  let again = false;
  let timer: unknown;
  let retry = 1000;
  let stopped = false;
  // tldraw reports store changes after the fact (batched per frame), so changes made before
  // sync started, and the echo of a board it loaded, can arrive late. Edits only count once
  // start() has decided, and a save whose content matches what was last synced is skipped.
  let started = false;
  let synced = "";
  let base: Snapshot | null = null;
  let status: SyncStatus = { state: "local" };
  const emit = (s: SyncStatus) => {
    status = s;
    o.onStatus?.(s);
  };
  const remember = (dirty: boolean) => account && o.memo.set({ account, boardId, revision, dirty });
  const markDirty = () => {
    const m = o.memo.get();
    if (account) remember(true);
    else if (!m?.dirty) o.memo.set({ account: m?.account ?? "", boardId, revision: m?.revision ?? 0, dirty: true });
  };
  const failed = (error: unknown) => {
    emit({ state: "offline", ...(account ? { account } : {}), error: error instanceof Error ? error.message : String(error) });
    if (!stopped) timer = setTimer(() => (account ? save() : start()), (retry = Math.min(retry * 2, 30_000)));
  };

  const unlisten = o.local.listen(() => {
    if (applying || stopped || !started) return;
    markDirty();
    if (!account) return;
    clearTimer(timer);
    timer = setTimer(() => save(), o.debounceMs ?? 1200);
  });

  /** Put this browser's board on top of whatever revision the server has now. */
  async function push(note?: string, attempt = 0): Promise<void> {
    const snapshot = o.local.snapshot(), json = JSON.stringify(snapshot);
    if (json === synced && attempt === 0 && !note) {
      remember(false);
      return emit({ state: "saved", account: account!, revision, at: now().getTime() });
    }
    emit({ state: "saving", account: account! });
    const result = await o.api.put(boardId, revision, snapshot);
    if (result.ok) {
      revision = result.revision;
      synced = json;
      base = snapshot;
      remember(again);
      retry = 1000;
      emit({ state: "saved", account: account!, revision, at: now().getTime(), ...(note ? { note } : {}) });
      return;
    }
    if (!result.stale) throw new Error(result.error);
    if (attempt >= 3) throw new Error("The board keeps changing on the server; will retry.");
    // Another tab or device saved first. Merge by object: its changes and this tab's both
    // survive; where both changed the same object, this tab's edit wins and the other
    // version stays in the board's revision history.
    const server = await o.api.get(boardId);
    if (!server) throw new Error("The board was deleted on the server.");
    revision = server.revision;
    if (!base) return push("Replaced a version saved from another tab or device; it is kept in the board's history.", attempt + 1);
    const merged = mergeSnapshots(base, o.local.snapshot(), server.snapshot);
    apply(merged.snapshot);
    base = server.snapshot;
    return push(
      merged.conflicts.length
        ? `Merged changes from another tab or device; where both changed the same object (${merged.conflicts.length}), this tab's edit was kept and the other is in the board's history.`
        : "Merged changes from another tab or device.",
      attempt + 1,
    );
  }

  function apply(snapshot: Snapshot) {
    applying = true;
    try {
      o.local.load(snapshot);
    } finally {
      applying = false;
    }
  }

  async function save(): Promise<void> {
    if (!account || stopped) return;
    if (saving) {
      again = true;
      return saving;
    }
    again = false;
    saving = push()
      .catch(failed)
      .finally(() => {
        saving = null;
        if (again) void save();
      });
    return saving;
  }

  async function start(): Promise<void> {
    try {
      account = await o.api.account();
      if (!account) return emit({ state: "local" });
      emit({ state: "loading", account });
      const memo = o.memo.get();
      if (memo?.dirty && memo.account && memo.account !== account) {
        // Unsaved work from another account: never upload it here or load over it.
        account = null;
        return emit({ state: "local", note: "This browser has unsaved work from another account. Sign in as that account to save it." });
      }
      const known = memo && memo.account === account && memo.boardId === boardId ? memo : null;
      const localWork = memo ? memo.dirty : o.hadLocalWork;
      const server = await o.api.get(boardId);
      if (!server) {
        // First sign-in on this account: this browser's board becomes the account's board.
        revision = 0;
        return await push("Moved this browser's board to your account.");
      }
      if (known && known.revision === server.revision) {
        revision = server.revision;
        base = server.snapshot;
        if (known.dirty) return await push();
        synced = JSON.stringify(o.local.snapshot());
        remember(false);
        return emit({ state: "saved", account, revision, at: now().getTime() });
      }
      if (known && known.dirty) {
        // Both moved and the common base is unknown: keep the account's version in history,
        // put this browser's edits on top.
        revision = server.revision;
        return await push("This browser had unsaved edits; the account's newer version is kept in the board's history.");
      }
      let note: string | undefined;
      if (!known && localWork) {
        // This browser has its own work and the account already has a board: keep both.
        const id = copyId(boardId, now());
        const copy = await o.api.put(id, 0, o.local.snapshot());
        if (!copy.ok) throw new Error(copy.stale ? `Board ${id} already exists` : copy.error);
        note = `This browser's earlier board was saved to your account as "${id}".`;
      }
      apply(server.snapshot);
      base = server.snapshot;
      synced = JSON.stringify(o.local.snapshot());
      revision = server.revision;
      remember(false);
      emit({ state: "saved", account, revision, at: now().getTime(), ...(note ? { note } : {}) });
    } catch (error) {
      failed(error);
    } finally {
      started = true;
    }
  }

  return {
    start,
    save,
    status: () => status,
    stop() {
      stopped = true;
      clearTimer(timer);
      unlisten();
    },
  };
}
