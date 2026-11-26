import { useEffect, useState } from "react";
import { FolderOpen, History, X } from "lucide-react";
import type { BoardSummary, RevisionSummary } from "./board-sync";
import { boardHistory } from "./board-sync-browser";
import { boardLabel, historyRows, sizeLabel, whenLabel } from "./history";

// "Earlier versions": the board's kept revisions, each restorable. A restore saves the
// board as it is now first, so it is always one more restore away.

type State =
  | { kind: "loading" }
  | { kind: "failed"; error: string }
  | { kind: "ready"; revisions: RevisionSummary[]; busy?: number; done?: string; error?: string };

export function HistoryDialog({ onClose, where }: { onClose: () => void; where: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const load = (done?: string) =>
    boardHistory.revisions().then(
      (revisions) =>
        setState(revisions?.length ? { kind: "ready", revisions, done } : { kind: "failed", error: `No earlier versions are kept in ${where} yet.` }),
      (e: Error) => setState({ kind: "failed", error: e.message }),
    );
  useEffect(() => {
    void load();
  }, []);
  const restore = async (revision: number) => {
    if (state.kind !== "ready") return;
    setState({ ...state, busy: revision, done: undefined, error: undefined });
    try {
      const r = await boardHistory.restore(revision);
      await load(`Restored the board from revision ${r.restoredFrom}. The board as it was is revision ${r.revision - 1}; restore it to undo.`);
    } catch (e) {
      setState({ ...state, busy: undefined, error: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="agent-dialog history-dialog" role="dialog" aria-modal="true" aria-label="Earlier versions" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-heading">
          <History size={18} />
          <h2>Earlier versions</h2>
          <button className="icon-button" aria-label="Close earlier versions" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <p>Restoring keeps the board as it is now as another version, so nothing is lost.</p>
        {state.kind === "loading" && <p className="history-status" role="status">Loading versions…</p>}
        {state.kind === "failed" && <p className="history-status" role="status">{state.error}</p>}
        {state.kind === "ready" && (
          <>
            {state.done && <p className="history-status done" role="status">{state.done}</p>}
            {state.error && <p className="history-status failed" role="alert">{state.error}</p>}
            <ol className="history-list">
              {historyRows(state.revisions, new Date()).map((row) => (
                <li key={row.revision} className={row.current ? "current" : ""}>
                  <span className="history-when">{row.label}</span>
                  <span className="history-detail">{row.detail}</span>
                  {row.current ? (
                    <span className="history-now">Current</span>
                  ) : (
                    <button className="subtle-button history-restore" disabled={state.busy !== undefined} onClick={() => void restore(row.revision)}>
                      {state.busy === row.revision ? "Restoring…" : "Restore"}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}

// "Saved boards": the account's boards (the main one, and a browser's earlier work kept
// as its own board). Opening one saves the current board first.

type BoardsState =
  | { kind: "loading" }
  | { kind: "failed"; error: string }
  | { kind: "ready"; boards: BoardSummary[]; current: string | null; busy?: string; error?: string };

export function SavedBoardsDialog({ onClose, where }: { onClose: () => void; where: string }) {
  const [state, setState] = useState<BoardsState>({ kind: "loading" });
  useEffect(() => {
    boardHistory.boards().then(
      (boards) => setState(boards ? { kind: "ready", boards, current: boardHistory.current() } : { kind: "failed", error: `No boards are saved in ${where}.` }),
      (e: Error) => setState({ kind: "failed", error: e.message }),
    );
  }, []);
  const open = async (id: string) => {
    if (state.kind !== "ready") return;
    setState({ ...state, busy: id, error: undefined });
    try {
      await boardHistory.open(id);
      onClose();
    } catch (e) {
      setState({ ...state, busy: undefined, error: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="agent-dialog history-dialog" role="dialog" aria-modal="true" aria-label="Saved boards" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-heading">
          <FolderOpen size={18} />
          <h2>Saved boards</h2>
          <button className="icon-button" aria-label="Close saved boards" title="Close" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <p>Boards kept in {where}. Opening one saves this board first.</p>
        {state.kind === "loading" && <p className="history-status" role="status">Loading boards…</p>}
        {state.kind === "failed" && <p className="history-status" role="status">{state.error}</p>}
        {state.kind === "ready" && (
          <>
            {state.error && <p className="history-status failed" role="alert">{state.error}</p>}
            <ol className="history-list">
              {[...state.boards].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map((b) => (
                <li key={b.id} className={b.id === state.current ? "current" : ""}>
                  <span className="history-when">{boardLabel(b.id)}</span>
                  <span className="history-detail">
                    {b.updatedAt ? `Saved ${whenLabel(b.updatedAt, new Date())} · ` : ""}
                    {sizeLabel(b.sizeBytes)}
                  </span>
                  {b.id === state.current ? (
                    <span className="history-now">Current</span>
                  ) : (
                    <button className="subtle-button history-restore" disabled={state.busy !== undefined} onClick={() => void open(b.id)}>
                      {state.busy === b.id ? "Opening…" : "Open"}
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}
