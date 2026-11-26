// Keeps the open board saved to the person's account (server boards, /api/canvas/boards),
// while tldraw keeps saving it in this browser as before. Pure controller: the network,
// the editor and browser storage come in as adapters, so it is unit-tested without a DOM.
//
// Rules, in order of priority:
// 1. Never lose a human edit. Changes are merged by object when the version both sides
//    started from is known. When it is not, this browser's board is saved as a separate
//    board and the account's board is opened; a whole board is never replaced by another.
// 2. The server rejects a save on a stale revision; the controller then re-reads and decides.
// 3. Offline is normal: work stays in this browser and is saved when the server is back.
// 4. A save the server refuses (too large, invalid) is not offline: retrying the same board
//    cannot succeed, so the controller says why and waits until the board changes.

export type Snapshot = { store: Record<string, unknown>; schema: Record<string, unknown> };
export type ServerBoard = { revision: number; snapshot: Snapshot };
export type PutResult =
  | { ok: true; revision: number }
  | { ok: false; stale: true; revision: number }
  | { ok: false; stale: false; error: string; /** HTTP status when the server refused this board itself (400, 403 board limit, 413); retrying it unchanged cannot work. */ refused?: number };

export type BoardApi = {
  /** The signed-in account, or null when signed out. Throws when the server is unreachable. */
  account(): Promise<string | null>;
  get(id: string): Promise<ServerBoard | null>;
  put(id: string, expectedRevision: number, snapshot: Snapshot): Promise<PutResult>;
  /** Kept revisions of a board, newest first, or null if it does not exist. */
  revisions?(id: string): Promise<RevisionSummary[] | null>;
  /** One kept revision's snapshot, or null if it was pruned or never existed. */
  revision?(id: string, revision: number): Promise<ServerBoard | null>;
};
export type RevisionSummary = { revision: number; sizeBytes: number; savedAt: string };
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
  | { state: "offline"; account?: string; error: string }
  | { state: "refused"; account: string; code: number; error: string };

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

/**
 * The account's board plus the records created in this tab since `initial` (objects made
 * while the board was loading). Changes to records that already existed are not carried
 * over: on a new browser those are the welcome board settling (cards re-measuring), which
 * the account's board replaces. A new record whose parent is missing is left out.
 */
export function withNewRecords(initial: Snapshot, current: Snapshot, server: Snapshot) {
  const store: Record<string, unknown> = { ...server.store };
  const added = Object.entries(current.store).filter(([id, r]) => !(id in initial.store) && !(id in server.store) && (r as { typeName?: string }).typeName !== "user");
  let kept = 0;
  for (let pass = true; pass; ) {
    pass = false;
    for (const [id, r] of added) {
      if (id in store) continue;
      const parent = (r as { parentId?: string }).parentId;
      if (parent && !(parent in store)) continue;
      store[id] = r;
      kept++;
      pass = true;
    }
  }
  return { snapshot: { store, schema: server.schema }, kept };
}

/** The server refused this board itself; trying the same board again cannot succeed. */
export class SaveRefused extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
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
  // The board content the server last refused; it is not uploaded again until it changes.
  let refusedJson = "";
  // The board as it was when sync was created; objects created while the account's board
  // is loading are carried onto it instead of being replaced.
  const initial = o.local.snapshot();
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
    if (error instanceof SaveRefused && account) {
      clearTimer(timer);
      return emit({ state: "refused", account, code: error.code, error: error.message });
    }
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
    if (json === refusedJson && status.state === "refused") return emit(status);
    emit({ state: "saving", account: account! });
    const result = await o.api.put(boardId, revision, snapshot);
    if (!result.ok && !result.stale && result.refused) {
      refusedJson = json;
      throw new SaveRefused(result.refused, result.error);
    }
    if (result.ok) {
      revision = result.revision;
      synced = json;
      refusedJson = "";
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
    if (!base) {
      // No common version to merge from, so neither side may replace the other: this
      // browser's board is set aside as its own board and the account's board is opened.
      // The server's revision is adopted only once the copy is safe: if setting aside is
      // refused (at the board limit), a later save must not land on the account's board.
      const note = await setAside("Another tab or device saved this board first.");
      revision = server.revision;
      apply(server.snapshot);
      base = server.snapshot;
      synced = JSON.stringify(o.local.snapshot());
      remember(false);
      return emit({ state: "saved", account: account!, revision, at: now().getTime(), note });
    }
    revision = server.revision;
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

  /** Save this browser's board to the account as a separate board, which is never pruned. */
  async function setAside(why: string) {
    const id = copyId(boardId, now());
    const copy = await o.api.put(id, 0, o.local.snapshot());
    if (!copy.ok && !copy.stale && copy.refused) throw new SaveRefused(copy.refused, copy.error);
    if (!copy.ok) throw new Error(copy.stale ? `Board ${id} already exists` : copy.error);
    return `${why} This browser's board was saved to your account as "${id}".`;
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
      let note: string | undefined;
      if (known ? known.dirty : localWork) {
        // This browser holds work the account does not, and the account's board has moved on
        // (or was never this browser's). The version they last shared is not known here, so
        // they cannot be merged, and replacing either would discard a whole board: keep both.
        note = await setAside(
          known ? "The board changed on another device while this browser had unsaved edits." : "Your account already had a board.",
        );
      }
      const loaded = withNewRecords(initial, o.local.snapshot(), server.snapshot);
      apply(loaded.snapshot);
      base = server.snapshot;
      revision = server.revision;
      if (loaded.kept) {
        started = true;
        return await push(note ?? "Kept the changes made while your board was loading.");
      }
      synced = JSON.stringify(o.local.snapshot());
      remember(false);
      emit({ state: "saved", account, revision, at: now().getTime(), ...(note ? { note } : {}) });
    } catch (error) {
      failed(error);
    } finally {
      started = true;
    }
  }

  /**
   * Put an earlier revision back as the board's newest revision. Edits not yet saved are
   * saved first, so the board as it was before the restore stays in the history and the
   * restore itself can be undone by restoring that revision.
   */
  async function restore(target: number, attempt = 0): Promise<{ revision: number; restoredFrom: number }> {
    if (!account || !o.api.revision) throw new Error("Revisions are only kept for boards saved to an account.");
    const elsewhere = "This board changed on another tab or device since this tab last saved. Nothing was restored; reload to see the newest version, then choose again.";
    // Fetch first: saving this tab's edits adds a revision, which can prune the oldest one.
    const old = await o.api.revision(boardId, target);
    if (!old) throw new Error(`Revision ${target} is no longer kept.`);
    // Save every edit made so far, including any made during the download, so it stays in history.
    await settle();
    if (target === revision) {
      const head = (await o.api.revisions?.(boardId))?.[0]?.revision;
      if (head === revision) return { revision, restoredFrom: target };
      throw new Error(elsewhere);
    }
    const before = revision;
    let result: PutResult | undefined;
    // One exclusive step: autosaves wait for it, and the old version is written exactly,
    // only on top of the revision this tab saved (never merged into a newer one).
    const step = (async () => {
      const current = o.local.snapshot();
      if (JSON.stringify(current) !== synced) return; // edited again just now: caller retries
      apply(old.snapshot);
      result = await o.api.put(boardId, before, old.snapshot);
      if (!result.ok) {
        apply(current);
        return;
      }
      revision = result.revision;
      base = old.snapshot;
      synced = JSON.stringify(o.local.snapshot());
      remember(false);
      retry = 1000;
      emit({ state: "saved", account: account!, revision, at: now().getTime(), note: `Restored revision ${target}. The board as it was before is revision ${before} in the history.` });
    })();
    saving = step.finally(() => {
      saving = null;
      if (again) void save();
    });
    await saving;
    if (!result) {
      if (attempt >= 3) throw new Error("The board keeps changing; try again in a moment.");
      return restore(target, attempt + 1);
    }
    if (!result.ok) throw new Error(result.stale ? elsewhere : result.error);
    return { revision, restoredFrom: target };
  }

  /** Save until nothing in this tab is unsaved; fails if the board cannot be saved now. */
  async function settle() {
    for (let i = 0; i < 5; i++) {
      await save();
      while (saving) await saving;
      if (status.state !== "saved") throw new Error("Save the board before restoring an earlier version.");
      if (JSON.stringify(o.local.snapshot()) === synced) return;
    }
    throw new Error("The board keeps changing; try again in a moment.");
  }

  return {
    start,
    save,
    restore,
    revisions: () => (account && o.api.revisions ? o.api.revisions(boardId) : Promise.resolve(null)),
    status: () => status,
    stop() {
      stopped = true;
      clearTimer(timer);
      unlisten();
    },
  };
}
