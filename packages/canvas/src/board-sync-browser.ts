import { atom, getSnapshot, loadSnapshot, type Editor } from "tldraw";
import { createBoardSync, type BoardApi, type MemoStore, type PutResult, type Snapshot, type SyncMemo, type SyncStatus } from "./board-sync";

// Wires board sync to the editor, the network and localStorage. On paired.cc the account
// comes from the session (/auth/me) and boards from /api/canvas/boards. The development
// server serves the same board API for one local person (server/boards-dev.ts), unless
// PAIRED_SERVER_URL proxies it to a real server (vite.config.ts).

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
    if (!__BOARDS_ON_SERVER__) {
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
    const r = await fetch(`/api/canvas/boards/${encodeURIComponent(id)}`, { credentials: "same-origin" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Loading the board failed (${r.status})`);
    const { board } = (await r.json()) as { board: { revision: number; snapshot: Snapshot } };
    return { revision: board.revision, snapshot: board.snapshot };
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
      listen: (fn) => editor.store.listen(fn, { scope: "document", source: "user" }),
    },
  });
  void sync.start();
  return () => sync.stop();
}
