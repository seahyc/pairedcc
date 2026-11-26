import { atom, getSnapshot, loadSnapshot, type Editor } from "tldraw";
import { createBoardSync, type BoardApi, type MemoStore, type PutResult, type RevisionSummary, type BoardSummary, type Snapshot, type SyncMemo, type SyncStatus } from "./board-sync";

// Wires board sync to the editor, the network and localStorage. On paired.cc the account
// comes from the session (/auth/me) and boards from /api/canvas/boards. The development
// server serves the same board API for one local person (server/boards-dev.ts).

export const boardSync = atom<SyncStatus>("board sync", { state: "local" });

const MEMO_KEY = "paired-board-sync";

const memo: MemoStore = {
  get() {
    try {
      const raw = localStorage.getItem(MEMO_KEY);
      return raw ? (JSON.parse(raw) as SyncMemo) : null;
    } catch {
      return null;
    }
  },
  set(value) {
    try {
      if (value) localStorage.setItem(MEMO_KEY, JSON.stringify(value));
      else localStorage.removeItem(MEMO_KEY);
    } catch {
      /* storage blocked: sync still works for this tab */
    }
  },
};

const json = { "Content-Type": "application/json" };

export const boardApi: BoardApi = {
  async account() {
    if (import.meta.env.DEV) {
      const r = await fetch("/api/canvas/boards");
      return r.ok ? "local" : null;
    }
    const r = await fetch("/auth/me", { credentials: "same-origin" });
    if (r.status === 401) return null;
    if (!r.ok) throw new Error(`Account check failed (${r.status})`);
    const me = (await r.json()) as { userId?: string; id?: string; email?: string };
    return me.userId ?? me.id ?? me.email ?? null;
  },
  async get(id) {
    // Look in the list first: asking for a board that does not exist yet (every first
    // sign-in) would log a 404 in the person's console for something that is not an error.
    const list = await fetch("/api/canvas/boards", { credentials: "same-origin" });
    if (!list.ok) throw new Error(`Loading your boards failed (${list.status})`);
    const { boards } = (await list.json()) as { boards: { id: string }[] };
    if (!boards.some((b) => b.id === id)) return null;
    const r = await fetch(`/api/canvas/boards/${encodeURIComponent(id)}`, { credentials: "same-origin" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Loading the board failed (${r.status})`);
    const { board } = (await r.json()) as { board: { revision: number; snapshot: Snapshot } };
    return { revision: board.revision, snapshot: board.snapshot };
  },
  async list() {
    const r = await fetch("/api/canvas/boards", { credentials: "same-origin" });
    if (!r.ok) throw new Error(`Loading your boards failed (${r.status})`);
    return ((await r.json()) as { boards: BoardSummary[] }).boards;
  },
  async revisions(id) {
    const r = await fetch(`/api/canvas/boards/${encodeURIComponent(id)}/revisions`, { credentials: "same-origin" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Loading the board's history failed (${r.status})`);
    return ((await r.json()) as { revisions: RevisionSummary[] }).revisions;
  },
  async revision(id, revision) {
    const r = await fetch(`/api/canvas/boards/${encodeURIComponent(id)}/revisions/${revision}`, { credentials: "same-origin" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Loading revision ${revision} failed (${r.status})`);
    const body = (await r.json()) as { revision: { revision: number; snapshot: Snapshot } };
    return { revision: body.revision.revision, snapshot: body.revision.snapshot };
  },
  async put(id, expectedRevision, snapshot): Promise<PutResult> {
    const r = await fetch(`/api/canvas/boards/${encodeURIComponent(id)}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: json,
      body: JSON.stringify({ expectedRevision, snapshot }),
    });
    const body = (await r.json().catch(() => ({}))) as { board?: { revision: number }; current?: { revision: number }; error?: string };
    if (r.ok && body.board) return { ok: true, revision: body.board.revision };
    if (r.status === 409 && body.current) return { ok: false, stale: true, revision: body.current.revision };
    return { ok: false, stale: false, error: body.error ?? `Saving the board failed (${r.status})` };
  },
};

type Sync = ReturnType<typeof createBoardSync>;
let active: Sync | null = null;

/** The open board's history, for the "Earlier versions" dialog; null until sync has started. */
export const boardHistory = {
  revisions: () => (active ? active.revisions() : Promise.resolve(null)),
  restore: (revision: number) => {
    if (!active) return Promise.reject(new Error("This board is not saved to an account yet."));
    return active.restore(revision);
  },
  boards: () => (active ? active.boards() : Promise.resolve(null)),
  current: () => active?.boardId() ?? null,
  open: (boardId: string) => {
    if (!active) return Promise.reject(new Error("This board is not saved to an account yet."));
    return active.open(boardId);
  },
};

/** Start keeping this editor's board saved to the account. Returns a stop function. */
export function startBoardSync(editor: Editor, hadLocalWork: boolean) {
  const sync = createBoardSync({
    api: boardApi,
    memo,
    hadLocalWork,
    onStatus: (s) => boardSync.set(s),
    local: {
      snapshot: () => getSnapshot(editor.store).document as unknown as Snapshot,
      load: (snapshot) => {
        const page = editor.getCurrentPageId();
        loadSnapshot(editor.store, { document: snapshot as never });
        if (editor.getPage(page)) editor.setCurrentPage(page);
      },
      reset: () => editor.clearHistory(),
      listen: (fn) => editor.store.listen(fn, { scope: "document", source: "user" }),
    },
  });
  // Development only, like window.__pairedEditor: lets headless checks drive history.
  if (import.meta.env.DEV) (window as unknown as { __pairedBoardSync?: typeof sync }).__pairedBoardSync = sync;
  active = sync;
  void sync.start();
  return () => {
    if (active === sync) active = null;
    sync.stop();
  };
}
