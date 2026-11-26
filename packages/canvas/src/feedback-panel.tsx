import { useEffect, useState } from "react";
import { Box, useEditor, useValue, type Editor, type TLShapeId } from "tldraw";
import { Check, CircleCheck, Download, MessageCircle, PenLine, RotateCcw, X, ClipboardCopy } from "lucide-react";
import { agentActivity, agentLink, agentListeners } from "./agent-client";
import { collectFeedback, collectLooseNotes, resolveMark, HUMAN } from "./scratchbook";
import {
  feedbackCounts,
  feedbackMarkdown,
  feedbackTitle,
  filterFeedback,
  type FeedbackItem,
  type FeedbackStatus,
} from "./feedback";

const ago = (iso: string | undefined, now: number) => {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Everything an export needs: the queue, the counts and the human's other notes. */
export function feedbackExport(editor: Editor) {
  const items = collectFeedback(editor);
  return {
    exportedAt: new Date().toISOString(),
    pages: editor.getPages().map((p) => ({ id: p.id, name: p.name })),
    counts: feedbackCounts(items),
    items,
    notes: collectLooseNotes(editor),
  };
}
export function feedbackExportMarkdown(editor: Editor) {
  const title = editor.getPages().map((p) => p.name).join(", ");
  const notes = collectLooseNotes(editor);
  const extra = notes.length
    ? `\n## Other notes on the board (${notes.length})\n\n${notes.map((n) => `- ${n.text.replace(/\s*\n\s*/g, " ")} · page "${n.pageName}" · ${n.createdAt} · id ${n.id}`).join("\n")}\n`
    : "";
  return feedbackMarkdown(collectFeedback(editor), { title, exportedAt: new Date() }) + extra;
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Go to a feedback item: switch page if needed, select it and bring it and its target into view. */
export function jumpToFeedback(editor: Editor, item: FeedbackItem) {
  if (item.pageId !== editor.getCurrentPageId()) editor.setCurrentPage(item.pageId as never);
  const ids = [item.id, ...item.targetIds].filter((id) => editor.getShape(id as TLShapeId)) as TLShapeId[];
  if (!ids.length) return;
  editor.setCurrentTool("select");
  editor.select(item.id as TLShapeId);
  const box = Box.Common(ids.flatMap((id) => editor.getShapePageBounds(id) ?? []));
  editor.zoomToBounds(box.expandBy(160), { animation: { duration: 220 }, targetZoom: 1 });
}

const kindIcon = { comment: MessageCircle, pick: CircleCheck, reject: X, ink: PenLine } as const;

/** The feedback queue: every open and resolved mark on the board, with replies and export. */
export function FeedbackPanel({ onNotice }: { onNotice: (text: string) => void }) {
  const editor = useEditor();
  const [filter, setFilter] = useState<FeedbackStatus | "all">("open");
  const items = useValue("feedback queue", () => collectFeedback(editor), [editor]);
  const selected = useValue("feedback selection", () => new Set<string>(editor.getSelectedShapeIds()), [editor]);
  const now = useNow(30_000);
  const counts = feedbackCounts(items);
  const shown = filterFeedback(items, filter);

  function setStatus(item: FeedbackItem, status: FeedbackStatus) {
    const shape = editor.getShape(item.id as TLShapeId);
    if (!shape) return;
    try {
      resolveMark(editor, shape, status, HUMAN);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Could not update that item");
    }
  }

  return (
    <div className="feedback-panel">
      <div className="feedback-filters" role="tablist" aria-label="Feedback filter">
        {(
          [
            ["open", `Open ${counts.open}`],
            ["resolved", `Resolved ${counts.resolved}`],
            ["all", `All ${counts.total}`],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? "on" : ""} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      <ol className="feedback-list">
        {shown.map((item) => {
          const Icon = kindIcon[item.kind];
          return (
            <li
              key={`${item.kind}:${item.id}`}
              className={`feedback-item ${item.status} ${selected.has(item.id) ? "current" : ""}`}
              data-feedback-id={item.id}
            >
              <button className="feedback-jump" onClick={() => jumpToFeedback(editor, item)} title="Go to this on the board">
                <span className={`feedback-kind ${item.kind}`}>
                  <Icon size={13} strokeWidth={2.2} />
                </span>
                <span className="feedback-body">
                  <span className={item.kind === "comment" ? "feedback-text hand" : "feedback-text"}>{feedbackTitle(item)}</span>
                  <span className="feedback-meta">
                    {item.ask ? `ask · ${item.ask} · ` : ""}
                    {item.kind === "comment" &&
                      (item.targets.length ? `on ${item.targets.map((t) => t.name ?? "deleted object").join(", ")} · ` : "pinned to the board · ")}
                    {item.pageName}
                    {item.createdAt ? ` · ${ago(item.createdAt, now)}` : ""}
                    {item.status === "resolved" ? ` · resolved${item.resolvedBy ? ` by ${item.resolvedBy === HUMAN ? "you" : item.resolvedBy}` : ""}` : ""}
                  </span>
                  {item.replies.map((r) => (
                    <span key={r.id} className="feedback-reply">
                      <b>✦ {r.author}</b> {r.text}
                    </span>
                  ))}
                </span>
              </button>
              <button
                className="feedback-resolve"
                aria-label={item.status === "open" ? "Resolve" : "Reopen"}
                title={item.status === "open" ? "Mark resolved" : "Reopen"}
                onClick={() => setStatus(item, item.status === "open" ? "resolved" : "open")}
              >
                {item.status === "open" ? <Check size={14} /> : <RotateCcw size={13} />}
              </button>
            </li>
          );
        })}
      </ol>
      {!shown.length && (
        <p className="feedback-empty">
          {items.length && filter === "open" ? (
            <>Nothing open. Everything you marked has been resolved.</>
          ) : (
            <>
              No feedback {filter === "resolved" ? "resolved " : ""}yet.
              <br />
              Select anything and press <kbd>C</kbd> to comment, <kbd>P</kbd> to pick or <kbd>X</kbd> to reject. With nothing selected, <kbd>C</kbd> pins a comment where your pointer is.
            </>
          )}
        </p>
      )}
      <div className="feedback-export">
        <span>Export</span>
        <button
          onClick={() =>
            void navigator.clipboard
              .writeText(feedbackExportMarkdown(editor))
              .then(() => onNotice("Feedback copied as Markdown"))
              .catch(() => onNotice("Could not copy. Use the .md download instead"))
          }
        >
          <ClipboardCopy size={12} /> Copy
        </button>
        <button onClick={() => download("paired-feedback.md", feedbackExportMarkdown(editor), "text/markdown")}>
          <Download size={12} /> .md
        </button>
        <button onClick={() => download("paired-feedback.json", `${JSON.stringify(feedbackExport(editor), null, 2)}\n`, "application/json")}>
          <Download size={12} /> .json
        </button>
      </div>
    </div>
  );
}

/** Live save state: tldraw writes each change to this browser's storage a moment after it happens. */
export function SaveState() {
  const editor = useEditor();
  const [state, setState] = useState<{ saving: boolean; at?: number }>({ saving: false });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = editor.store.listen(
      () => {
        setState((s) => (s.saving ? s : { ...s, saving: true }));
        clearTimeout(timer);
        timer = setTimeout(() => setState({ saving: false, at: Date.now() }), 700);
      },
      { source: "user", scope: "document" },
    );
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [editor]);
  const time = state.at ? new Date(state.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <span className={state.saving ? "save-state saving" : "save-state"} role="status" title="This board is saved in this browser only. Export to move it.">
      {state.saving ? <span className="save-dot" /> : <Check size={12} />}
      {state.saving ? "Saving…" : time ? `Saved on this device · ${time}` : "Saved on this device"}
    </span>
  );
}

/** Whether an agent can reach this tab, and what one last did here. */
export function AgentChip({ onOpen }: { onOpen: () => void }) {
  const link = useValue("agent link", () => agentLink.get(), []);
  const activity = useValue("agent activity", () => agentActivity.get(), []);
  const now = useNow(2000);
  const listeners = useValue("agent listeners", () => agentListeners.get(), []);
  const nobody = link.mode === "local" && listeners !== null && listeners.length === 0;
  const down = link.mode === "local" ? link.state === "disconnected" : link.state !== "connected";
  const fresh = activity && now - activity.at < 6000;
  const label = down
    ? link.mode === "hosted" && link.state === "signed-out"
      ? "No agent connected"
      : link.mode === "hosted"
        ? "Connecting agent link…"
        : "Agent link down"
    : fresh
      ? `${activity.actor}: ${activity.op}${activity.ok ? "" : " failed"}`
      : listeners?.length
        ? `${listeners[0]} is listening`
        : nobody
          ? "No agent listening"
          : activity
            ? `Agent ready · ${activity.actor} ${ago(new Date(activity.at).toISOString(), now)}`
            : "Agent ready";
  return (
    <button
      type="button"
      className={`agent-chip ${down ? "down" : "up"} ${fresh ? (activity.ok ? "working" : "failed") : nobody ? "idle" : ""}`}
      title={
        down
          ? "Agents cannot reach this tab right now. Click for setup."
          : activity && !activity.ok
            ? `Last agent action failed: ${activity.error}`
            : nobody
              ? "Nothing will answer an ask until an agent is listening. Click to see how to start one."
              : "Agents can read and write this board while this tab is open. Click for setup."
      }
      onClick={onOpen}
    >
      <span className="agent-chip-dot" />
      {fresh && "✦ "}
      {label}
    </button>
  );
}
