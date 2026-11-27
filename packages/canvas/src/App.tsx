import React, { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Tldraw,
  useEditor,
  useValue,
  DefaultDashStyle,
  DefaultColorStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  serializeTldrawJson,
  parseTldrawJsonFile,
  startEditingShapeWithRichText,
  type Editor,
  type TLShape,
  type TLShapeId,
  Box,
  type TLComponents,
} from "tldraw";
import {
  MousePointer2,
  Hand,
  Frame,
  Square,
  Circle,
  Pencil,
  Type,
  StickyNote,
  ArrowUpRight,
  ImagePlus,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Undo2,
  Redo2,
  Minus,
  Maximize,
  Download,
  Upload,
  SlidersHorizontal,
  Copy,
  Trash2,
  LockKeyhole,
  UnlockKeyhole,
  Check,
  Braces,
  X,
  Bird,
  MessageSquarePlus,
  MessagesSquare,
  Keyboard,
  Ellipsis,
  Menu,
  LayoutGrid,
  Sparkles,
  Layers,
  FilePlus2,
  FileInput,
  Map as MapIcon,
  History,
  FolderOpen,
} from "lucide-react";
import {
  createObject,
  createBridge,
  patchObject,
  shapeName,
  revision,
  type CanvasBridge,
} from "./operations";
import { agentLink, agentListeners, connectAgentAccess } from "./agent-client";
import { convergeForPerson, createComment } from "./agent-operations";
import { prototypeEnabled, canvasReturnTo } from "./prototype-flags";
import { toggleLeftOut, togglePinned } from "./leave-out";
import { followConnectors } from "./connector-follow";
import { FeedbackPanel, SaveState, AgentChip } from "./feedback-panel";
import { boardHistory, boardSync, startBoardSync } from "./board-sync-browser";
import { HistoryDialog, SavedBoardsDialog } from "./history-dialog";
import { bringContentIntoView } from "./reframe";
import { calmSeed, seed } from "./seed";
import { checkable, startCheck } from "./learning/check-ui";
import { AskLayer, AutoAsk, SelectionBar, resendAsk, selectedRetry } from "./ask-ui";
import { BoardImageShapeUtil } from "./image-shape";
import { boardImageStore, moveLocalImagesIntoBoard } from "./image-assets";
import { elsewhereNotice, elsewhereShow, markOf, noticeDelay } from "./ask-rules";
import { askOf } from "./asks";
import { landedAnswers } from "./ask-rules";
import { CardShapeUtil, CardShapeTool } from "./card-shape";
import { DataTableShapeUtil } from "./table-shape";
import { ImportLayer, chooseImportFile } from "./import-ui";
import { PromptShapeUtil, createLearningPrototypePage, learningPrototypeEnabled, learningVisibility } from "./learning/prompt-shape";
import { ChartShapeUtil, DataLayer, DatasetShapeUtil, createDataPrototypePage, dataPrototypeEnabled } from "./data/shapes";
import {
  PaperBackground,
  ScratchbookLayer,
  MarksCounter,
  toggleMark,
  authorOf,
  humanStyle,
  openFeedbackCount,
  HUMAN,
} from "./scratchbook";
import { richTextPlain } from "./operations";
import { onlyDerivedChange } from "./revision";
import { canvasOptions } from "./canvas-options";
import { layerTree } from "./layer-tree";
import { followPause, followers } from "./follow";
import { toggleSettled } from "./settled";
import { BoardOverview } from "./overview-ui";
import { firstTabStop, keyboardCardSpot, selectionAnnouncement, stopAnnouncement } from "./keyboard-nav";
import { useDialogFocus, useMenuKeys } from "./focus-keys";
import { localMcpConfig } from "./mcp-config";
import "tldraw/tldraw.css";
import "./style.css";

declare global {
  interface Window {
    paired?: CanvasBridge;
    /** Development builds only: the editor, for `pnpm eval:canvas` fixtures and timing. */
    __pairedEditor?: Editor;
  }
}
// What a thinker needs is on the strip; everything else is one click away under More.
const mainTools = [
  { id: "select", name: "Select", key: "V", icon: MousePointer2 },
  { id: "card", name: "Write", key: "N", icon: StickyNote },
  { id: "draw", name: "Pen", key: "D", icon: Pencil },
  { id: "arrow", name: "Arrow", key: "A", icon: ArrowUpRight },
];
const moreTools = [
  { id: "hand", name: "Pan", key: "H", icon: Hand },
  { id: "frame", name: "Frame", key: "F", icon: Frame },
  { id: "geo", name: "Rectangle", key: "R", icon: Square },
  // O is the overview of the board (P3); the Ellipse is a click away here.
  { id: "ellipse", name: "Ellipse", key: "", icon: Circle },
  { id: "text", name: "Plain text", key: "T", icon: Type },
];
const tools = [...mainTools, ...moreTools];
const palette = [
  { id: "black", hex: "#242528" },
  { id: "grey", hex: "#9ba1a8" },
  { id: "blue", hex: "#3b5be4" },
  { id: "light-blue", hex: "#a8caee" },
  { id: "yellow", hex: "#f4d65a" },
  { id: "orange", hex: "#f7a45c" },
  { id: "green", hex: "#528e63" },
  { id: "violet", hex: "#9d77d6" },
  { id: "red", hex: "#e66f74" },
] satisfies { id: string; hex: string }[];
function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function ShapeIcon({ shape }: { shape: TLShape }) {
  if (shape.type === "frame") return <Frame size={14} />;
  if (shape.type === "text") return <Type size={14} />;
  if (shape.type === "note" || shape.type === "card") return <StickyNote size={14} />;
  if (shape.type === "image") return <ImagePlus size={14} />;
  if (shape.type === "arrow") return <ArrowUpRight size={14} />;
  if (shape.type === "draw") return <Pencil size={14} />;
  return <Square size={14} />;
}
function Numeric({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        value={Math.round(value * 100) / 100}
        onChange={(e) => {
          const n = e.currentTarget.valueAsNumber;
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}
/** A copyable code block. */
function CopyBlock({ text, onCopied }: { text: string; onCopied: (notice: string) => void }) {
  return (
    <div className="copy-block">
      <pre>{text}</pre>
      <button
        className="copy-button"
        onClick={() =>
          void navigator.clipboard
            .writeText(text)
            .then(() => onCopied("Copied"))
            .catch(() => onCopied("Select the text and copy it"))
        }
      >
        Copy
      </button>
    </div>
  );
}

/** Agent setup on paired.cc: one sentence for the agent, or one command per client. */
function HostedAgentAccess({ onCopied }: { onCopied: (notice: string) => void }) {
  const link = useValue("agent link", () => agentLink.get(), []);
  const listeners = useValue("agent listeners", () => agentListeners.get(), []);
  const origin = location.origin;
  if (link.mode !== "hosted") return null;
  if (link.state === "signed-out")
    return (
      <>
        <p>
          Claude Code, Codex, Cursor or any MCP agent can read this board and work on it with you.
          Sign in first, so your agent connects to your canvas and nobody else's.
        </p>
        <button
          className="wide-button dark"
          onClick={() => (location.href = `/docs/login?returnTo=${encodeURIComponent(canvasReturnTo())}`)}
        >
          Sign in to connect an agent
        </button>
      </>
    );
  return (
    <>
      <p className="agent-status">
        <span className={`status-dot ${link.state}`} />
        {link.state === "connected" ? `This tab is ready for your agent${link.email ? ` (${link.email})` : ""}.` : "Connecting this tab…"}
      </p>
      {listeners !== null && (
        <p className="agent-status">
          <span className={`status-dot ${listeners.length ? "connected" : "connecting"}`} />
          {listeners.length ? `${listeners.join(", ")} is listening and answers your asks.` : "The resident agent is offline, so asks wait until it is back or you connect your own."}
        </p>
      )}
      <p>Paste this into your agent:</p>
      <CopyBlock text={`Read ${origin}/agent-setup.md and connect me to Paired.`} onCopied={onCopied} />
      <p>Or add it yourself:</p>
      <p className="inspector-help">Claude Code</p>
      <CopyBlock text={`claude mcp add --transport http paired ${origin}/mcp`} onCopied={onCopied} />
      <p className="inspector-help">Codex</p>
      <CopyBlock text={`codex mcp add paired --url ${origin}/mcp && codex mcp login paired`} onCopied={onCopied} />
      <p className="inspector-help">Cursor, Claude.ai, ChatGPT and other clients: add a remote MCP server at</p>
      <CopyBlock text={`${origin}/mcp`} onCopied={onCopied} />
      <p className="inspector-help">
        Your agent opens a sign-in page the first time. Keep this tab open while it works: the board itself is still saved in this browser.
      </p>
    </>
  );
}

const shortcutGroups: { title: string; rows: [string, string][] }[] = [
  {
    title: "Think",
    rows: [
      ["Write a thought", "N, then click or Enter; or double-click the board"],
      ["Ask: write a question and finish, or send any card; also resends a failed ask", keys("end with ?, or ⌘ ↵")],
      ["Comment on the selection, or pin one at the pointer", "C"],
      ["Pick the selection (again to undo)", "P"],
      ["Cross out the selection (again to undo)", "X"],
      ["Check me on an agent's answer: explain it from memory, then compare", "E"],
      ["Settle it: done for now (again to reopen)", "S"],
      ["See the whole board: its groups, open and settled; press one to go there", "O"],
      ...(prototypeEnabled("context")
        ? [
            ["Leave the selection out of asks (again to bring it back)", "L"] as [string, string],
            ["Pin the selection into every ask on this page (again to unpin)", "I"] as [string, string],
          ]
        : []),
      ["Open or close the feedback queue", "Shift C"],
      ["Bring in a table or document as cards", keys("⌘ V, or drop a file")],
      ["Next / previous imported record", "J / K"],
      ["Go to an answer that landed on another page, while its notice is up", "G"],
      ["Finish typing", "Esc"],
    ],
  },
  { title: "Tools", rows: tools.map((t) => [t.name, t.key || "under More"] as [string, string]) },
  {
    title: "Move around",
    rows: [
      ["Next / previous thing on the board", "Tab / Shift Tab"],
      ["To the menu and tools", "Esc, then Shift Tab"],
      ["Pan", "Space + drag, or scroll"],
      ["Zoom", keys("Pinch, or ⌘ scroll")],
      ["Fit everything", "Shift 1"],
      ["Fit selection", "Shift 2"],
    ],
  },
  {
    title: "Edit",
    rows: [
      ["Undo / redo", keys("⌘ Z / ⇧ ⌘ Z")],
      ["Duplicate", keys("⌘ D")],
      ["Select all", keys("⌘ A")],
      ["Delete", keys("⌫")],
      ["Edit text", "Double-click or Enter"],
      ["Deselect, back to Move", "Esc"],
      ["This list", "?"],
    ],
  },
];

/**
 * The board's Tab order: page-level objects in reading order. Connectors are not stops (they
 * join thoughts and have no next step of their own), nor is anything hidden, such as a result
 * still behind a learning prompt.
 */
function tabStops(editor: Editor) {
  return editor.getCurrentPageShapesInReadingOrder().flatMap((s) => {
    const b = s.type === "arrow" || editor.isShapeHidden(s) ? undefined : editor.getShapePageBounds(s.id);
    return b ? [{ id: s.id as string, box: { x: b.x, y: b.y, w: b.w, h: b.h } }] : [];
  });
}

/**
 * Says the selection to a screen reader, politely and unseen: who made it, its text, its state
 * and its place in the Tab order. The canvas runs with tldraw's UI hidden, which also drops
 * tldraw's own announcer.
 */
function StopAnnouncer() {
  const editor = useEditor();
  // What is said depends on the selection and the selected object's words, mark and ask, not
  // on where it is: dragging it must not walk a big board's reading order on every step.
  const key = useValue(
    "selection announcement key",
    () => {
      if (editor.getEditingShapeId()) return "editing";
      const ids = editor.getSelectedShapeIds();
      const shape = ids.length === 1 ? editor.getShape(ids[0]) : undefined;
      if (!shape) return ids.join(",");
      // While a drag is under way the place in the order is not said; it is worked out again
      // when the drag ends, and whenever objects are added or removed (an answer lands).
      const dragging = editor.isIn("select.translating");
      const count = editor.getCurrentPageShapeIds().size;
      return JSON.stringify([shape.id, "richText" in shape.props ? shape.props.richText : null, shape.meta.mark, shape.meta.ask, shape.meta.name, editor.isShapeHidden(shape), dragging, dragging ? 0 : count]);
    },
    [editor],
  );
  const said = useMemo(
    () => {
      if (editor.getEditingShapeId()) return "";
      const ids = editor.getSelectedShapeIds();
      if (ids.length !== 1) return selectionAnnouncement(ids);
      const shape = editor.getShape(ids[0]);
      // Nothing hidden is read out, such as a result still behind a learning prompt.
      if (!shape || editor.isShapeHidden(shape)) return "";
      const author = authorOf(shape);
      const ask = askOf(shape);
      const text = "richText" in shape.props ? richTextPlain(shape.props.richText) : "";
      const repliesTo = typeof shape.meta.replyTo === "string" ? editor.getShape(shape.meta.replyTo as TLShapeId) : undefined;
      const answer = shape.meta.role === "annotation" && Boolean(askOf(repliesTo));
      const kind = ask ? "ask" : answer ? "answer" : shape.meta.role === "annotation" ? "comment" : shape.type === "card" ? "card" : "other";
      const type = shape.type[0].toUpperCase() + shape.type.slice(1);
      const name = shapeName(shape);
      const order = tabStops(editor);
      const index = order.findIndex((o) => o.id === shape.id) + 1;
      return stopAnnouncement({
        kind,
        author,
        human: author === HUMAN,
        text,
        name: name === type ? type : `${type}: ${name}`,
        question: answer && shape.meta.name === "Question",
        mark: markOf(shape.meta),
        ask: ask ? { state: ask.state, agent: ask.agent } : undefined,
        ...(index ? { index, total: order.length } : {}),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, key],
  );
  return createPortal(
    <div role="status" aria-live="polite" data-stop-announcer style={{ position: "absolute", width: 1, height: 1, margin: -1, padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 }}>
      {said}
    </div>,
    document.body,
  );
}

/** A dialog's section that takes focus, keeps Tab inside, closes on Escape and gives focus back. */
function FocusSection({ onClose, children, ...rest }: { onClose: () => void } & React.HTMLAttributes<HTMLElement>) {
  const focus = useDialogFocus<HTMLElement>(onClose);
  return (
    <section {...rest} {...focus}>
      {children}
    </section>
  );
}

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const focus = useDialogFocus<HTMLElement>(onClose);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section {...focus} className="agent-dialog shortcut-dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-heading">
          <Keyboard size={18} />
          <h2>Keyboard shortcuts</h2>
          <IconButton label="Close shortcuts" onClick={onClose}>
            <X size={17} />
          </IconButton>
        </div>
        <p>
          Pink handwriting is you, lavender with ✦ is your agent. Write a question and it is asked when you finish; any other card is asked with ⌘↵. Everything you ask, comment on, pick or cross out goes into one queue your agent reads.
        </p>
        <div className="shortcut-grid">
          {shortcutGroups.map((group) => (
            <div key={group.title}>
              <h3>{group.title}</h3>
              <dl className="shortcuts">
                {group.rows.map(([name, keys]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{keys}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * The layers panel's object list. Its own component, mounted only while the panel is open:
 * it follows every shape on the page, and in the shell that cost a row per object, and a
 * re-render of the whole shell, on every change even with the panel hidden.
 */
function LayerList({ pageId, collapsed, setCollapsed }: { pageId: string; collapsed: Set<string>; setCollapsed: React.Dispatch<React.SetStateAction<Set<string>>> }) {
  const editor = useEditor();
  const shapes = useValue("layers", () => editor.getCurrentPageShapesSorted(), [editor]);
  const selectedIds = useValue("layer selection", () => new Set<string>(editor.getSelectedShapeIds()), [editor]);
  const tree = useMemo(() => layerTree(shapes), [shapes]);
  // A result hidden behind a learning prompt must not leak through its layer name.
  function layerName(s: TLShape) {
    return editor.isShapeHidden(s) ? "Hidden until you answer" : shapeName(s);
  }
  function layerRows(parentId: string, depth = 0): React.ReactNode {
    return tree
      .childrenOf(parentId)
      .map((s) => {
        const children = tree.hasChildren(s.id),
          isCollapsed = collapsed.has(s.id);
        return (
          <React.Fragment key={s.id}>
            <div
              className={`layer ${selectedIds.has(s.id) ? "selected" : ""}`}
              style={{ paddingLeft: 12 + depth * 16 }}
            >
              {children ? (
                <button
                  className="disclosure"
                  aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${layerName(s)}`}
                  onClick={() =>
                    setCollapsed((prev) => {
                      const n = new Set(prev);
                      if (n.has(s.id)) n.delete(s.id);
                      else n.add(s.id);
                      return n;
                    })
                  }
                >
                  {isCollapsed ? (
                    <ChevronRight size={12} />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                </button>
              ) : (
                <span className="disclosure-space" />
              )}
              <button
                className="layer-target"
                onClick={(e) => {
                  editor.setCurrentTool("select");
                  if (e.shiftKey)
                    editor.select(
                      ...new Set([...editor.getSelectedShapeIds(), s.id]),
                    );
                  else editor.select(s.id);
                  editor.focus();
                }}
                onDoubleClick={() =>
                  editor.zoomToSelection({ animation: { duration: 180 } })
                }
                aria-label={`Select ${layerName(s)}`}
                disabled={editor.isShapeHidden(s)}
              >
                <ShapeIcon shape={s} />
                <span>{layerName(s)}</span>
                {s.isLocked && <LockKeyhole size={11} />}
              </button>
            </div>
            {!isCollapsed && layerRows(s.id, depth + 1)}
          </React.Fragment>
        );
      });
  }
  return (
    <>
      <div className="section-heading border-top">
        <span>Objects</span>
        <span>{shapes.length}</span>
      </div>
      <div className="layer-list">
        {layerRows(pageId)}
        {shapes.length === 0 && (
          <p className="empty-layers">
            Your first thought starts here.
            <br />
            Choose a tool and draw.
          </p>
        )}
      </div>
    </>
  );
}

function Shell() {
  const editor = useEditor();
  const [panel, setPanel] = useState<"properties" | "feedback" | null>(null);
  const rightTab = panel ?? "properties";
  const setRightTab = setPanel;
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null),
    moreButton = useRef<HTMLButtonElement>(null);
  const mainMenu = useMenuKeys<HTMLDivElement>(menuOpen, () => setMenuOpen(false), menuButton),
    moreMenu = useMenuKeys<HTMLDivElement>(moreOpen, () => setMoreOpen(false), moreButton);
  const [asking, setAsking] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [boardsOpen, setBoardsOpen] = useState(false);
  const sync = useValue("board sync", () => boardSync.get(), []);
  // Versions are kept only for boards saved to an account (or the local dev server).
  const historyWhere = sync.state === "local" ? null : "account" in sync && sync.account === "local" ? "the local server" : "your account";
  // "Saved boards" appears only when the account holds more than one board.
  const [savedBoards, setSavedBoards] = useState(0);
  useEffect(() => {
    if (!menuOpen || !historyWhere) return;
    let live = true;
    boardHistory.boards().then((list) => live && setSavedBoards(list?.length ?? 0), () => live && setSavedBoards(0));
    return () => {
      live = false;
    };
  }, [menuOpen, historyWhere]);
  const openCount = useValue("open feedback", () => openFeedbackCount(editor), [editor]);
  const link = useValue("agent link", () => agentLink.get(), []);
  const listeners = useValue("agent listeners", () => agentListeners.get(), []);
  const editingId = useValue("editing", () => editor.getEditingShapeId(), [editor]);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // The object last selected: a card written from the keyboard goes under it.
  const lastSelected = useRef<TLShapeId | null>(null);
  const selected = useValue("selection", () => editor.getSelectedShapes(), [
    editor,
  ]);
  const currentTool = useValue("tool", () => editor.getCurrentToolId(), [
    editor,
  ]);
  useEffect(() => {
    const last = [...selected].reverse().find((s) => s.type !== "arrow");
    if (last) lastSelected.current = last.id;
  }, [selected]);
  const zoom = useValue("zoom", () => editor.getZoomLevel(), [editor]);
  const pages = useValue("pages", () => editor.getPages(), [editor]);
  const page = useValue("page", () => editor.getCurrentPage(), [editor]);
  const undo = useValue("can undo", () => editor.getCanUndo(), [editor]),
    redo = useValue("can redo", () => editor.getCanRedo(), [editor]);
  const [leftOpen, setLeftOpen] = useState(false),
    [agentOpen, setAgentOpen] = useState(false),
    [notice, setNoticeShown] = useState(""),
    // Bumped each time a notice is shown, so the same words shown again get their full time.
    [noticeAt, setNoticeAt] = useState(0),
    // The ask a notice is about when it was answered (or failed) on another page: Show goes there.
    [noticeShow, setNoticeShow] = useState<string | null>(null),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const setNoticeText = (text: string) => {
    setNoticeShown(text);
    setNoticeAt((n) => n + 1);
  };
  // Any other notice is about something else, so it drops the Show from the one before.
  const setNotice = (text: string) => {
    setNoticeText(text);
    setNoticeShow(null);
  };
  const importRef = useRef<HTMLInputElement>(null),
    imageRef = useRef<HTMLInputElement>(null);
  const shape = selected.length === 1 ? selected[0] : undefined;
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input,textarea,select,[contenteditable=true],[role=dialog]")
      )
        return;
      if (event.altKey) return;
      const key = event.key.toLowerCase(),
        mod = event.metaKey || event.ctrlKey;
      if (mod) {
        if (key === "z") {
          // The canvas's own shortcut has usually undone already; a second undo here would take two steps.
          if (!event.defaultPrevented) event.shiftKey ? editor.redo() : editor.undo();
          event.preventDefault();
        } else if (key === "d") {
          event.preventDefault();
          editor.markHistoryStoppingPoint("duplicate");
          editor.duplicateShapes(editor.getSelectedShapeIds(), {
            x: 24,
            y: 24,
          });
        } else if (key === "a") {
          event.preventDefault();
          editor.selectAll();
        }
        return;
      }
      if (event.shiftKey && key === "1") {
        event.preventDefault();
        editor.zoomToFit({ animation: { duration: 180 } });
        return;
      }
      if (event.shiftKey && key === "2") {
        event.preventDefault();
        editor.zoomToSelection({ animation: { duration: 180 } });
        return;
      }
      if (key === "delete" || key === "backspace") {
        event.preventDefault();
        editor.markHistoryStoppingPoint("delete");
        editor.deleteShapes(editor.getSelectedShapeIds());
        return;
      }
      if (key === "escape") {
        setHelpOpen(false);
        setMenuOpen(false);
        setMoreOpen(false);
        setAsking(false);
        editor.cancel();
        editor.setCurrentTool("select");
        editor.selectNone();
        return;
      }
      const tool = tools.find((t) => t.key.toLowerCase() === key);
      if (tool && !event.shiftKey) {
        event.preventDefault();
        chooseTool(tool.id);
      }
    }
    // P and X judge the selection. Capture first so tldraw's own X (pen) shortcut doesn't fire.
    function judge(event: KeyboardEvent) {
      const target = event.target;
      // Keys meant for the board do nothing behind an open dialog; ? still closes the shortcuts.
      const dialog = target instanceof HTMLElement ? target.closest("[role=dialog]") : null;
      if (dialog) {
        if (event.key === "?" && dialog.getAttribute("aria-label") === "Keyboard shortcuts") {
          event.preventDefault();
          event.stopImmediatePropagation();
          setHelpOpen(false);
        }
        return;
      }
      const typingOnBoard = target instanceof HTMLElement && Boolean(target.closest(".tl-container [contenteditable=true]"));
      const asksNow = (event.metaKey || event.ctrlKey) && event.key === "Enter" && typingOnBoard;
      if (
        !asksNow &&
        target instanceof HTMLElement &&
        target.closest("input,textarea,select,[contenteditable=true]")
      )
        return;
      const key = event.key.toLowerCase();
      // ⌘↵ asks about what is selected, or about the card being written.
      if ((event.metaKey || event.ctrlKey) && key === "enter") {
        event.preventDefault();
        event.stopImmediatePropagation();
        // The canvas starts editing a selected card when Enter is released; this Enter is ours.
        swallowEnterUp = true;
        if (!event.repeat) askAboutSelection();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (editor.getEditingShapeId()) return;
      // Without a pointer: N then Enter writes a card in view; Tab with nothing selected
      // lands on the board. Once something is selected the canvas's own Tab moves on.
      // Enter from the board itself or from the armed Write button; any other control keeps its own Enter.
      const boardItself = target === document.body || (target instanceof HTMLElement && /\btl-(container|canvas)\b/.test(target.className));
      const onBoard = !(target instanceof HTMLElement) || boardItself || target.matches(".tool-button.active");
      if (event.key === "Enter" && onBoard && editor.getCurrentToolId() === "card" && !event.shiftKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        swallowEnterUp = true;
        writeFromKeyboard();
        return;
      }
      // Tab only from the board itself: a flag or button on it keeps the browser's own Tab.
      if (event.key === "Tab" && boardItself && editor.getCurrentToolId() === "select") {
        // Ours either way: the next object, or out to the controls (the browser alone would
        // find nothing before the board, which holds them).
        if (!tabOnBoard(event.shiftKey)) leaveBoard(event.shiftKey);
        event.preventDefault();
        event.stopImmediatePropagation();
        // The canvas moves the selection when Tab is released; this Tab is ours.
        swallowTabUp = true;
        return;
      }
      // ? shows the shortcuts, C comments, Shift+C opens the feedback queue.
      if (event.key === "?" || (key === "c" && !event.repeat)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "?") setHelpOpen((open) => !open);
        else if (event.shiftKey) setPanel((tab) => (tab === "feedback" ? null : "feedback"));
        else addComment();
        return;
      }
      if (event.shiftKey) return;
      // O shows the whole board: its groups with what is open and settled in each.
      if (key === "o") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) setOverviewOpen((open) => !open);
        return;
      }
      // G goes to an ask answered on another page, while the notice about it is up.
      if (key === "g" && showing.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) showRef.current();
        return;
      }
      // L leaves the selection out of asks (the context prototype). Capture first so tldraw's own L (line) doesn't fire.
      if (key === "l" && prototypeEnabled("context")) {
        const chosen = editor.getSelectedShapes();
        if (!chosen.length) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) toggleLeftOut(editor, chosen);
        return;
      }
      // E checks the person on a selected agent answer. Only then: otherwise E stays tldraw's.
      if (key === "e" && checkable(editor)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) startCheck(editor, setNotice, keepInView);
        return;
      }
      // I pins the selection into every ask on its page (the context prototype).
      if (key === "i" && prototypeEnabled("context")) {
        const chosen = editor.getSelectedShapes();
        if (!chosen.length) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) togglePinned(editor, chosen);
        return;
      }
      if (key !== "p" && key !== "x" && key !== "s") return;
      const picked = editor.getSelectedShapes();
      if (!picked.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // S settles (or reopens) what is selected; P and X judge it.
      if (key === "s") toggleSettled(editor, picked);
      else toggleMark(editor, picked, key === "p" ? "picked" : "rejected");
    }
    let swallowEnterUp = false, swallowTabUp = false;
    const enterUp = (event: KeyboardEvent) => {
      if (event.key === "Tab" && swallowTabUp) {
        swallowTabUp = false;
        event.stopImmediatePropagation();
        return;
      }
      if (event.key !== "Enter" || !swallowEnterUp) return;
      swallowEnterUp = false;
      event.stopImmediatePropagation();
    };
    window.addEventListener("keyup", enterUp, { capture: true });
    const track = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", track, { capture: true });
    window.addEventListener("pointerdown", track, { capture: true });
    window.addEventListener("keydown", judge, { capture: true });
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("pointermove", track, { capture: true });
      window.removeEventListener("pointerdown", track, { capture: true });
      window.removeEventListener("keydown", judge, { capture: true });
      window.removeEventListener("keyup", enterUp, { capture: true });
      window.removeEventListener("keydown", keydown);
    };
  }, [editor]);
  // A comment left empty is dropped when the human stops typing in it.
  const lastEditing = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastEditing.current;
    lastEditing.current = editingId;
    if (!previous || previous === editingId) return;
    const left = editor.getShape(previous as never);
    if (!left || left.meta.role !== "annotation" || authorOf(left) !== HUMAN) return;
    if ("richText" in left.props && richTextPlain(left.props.richText).trim()) return;
    const arrows = editor.getCurrentPageShapes().filter((a) => a.type === "arrow" && a.meta.fromId === left.id);
    editor.deleteShapes([left.id, ...arrows.map((a) => a.id)]);
  }, [editor, editingId]);
  // A note dropped with a single click starts in typing mode, like one drawn by dragging.
  const lastTool = useRef(currentTool);
  useEffect(() => {
    const previous = lastTool.current;
    lastTool.current = currentTool;
    if (previous !== "card" || currentTool !== "select") return;
    const fresh = editor.getOnlySelectedShape();
    if (!fresh || fresh.type !== "card" || editor.getEditingShapeId()) return;
    if ("richText" in fresh.props && richTextPlain(fresh.props.richText).trim()) return;
    startEditingShapeWithRichText(editor, fresh.id, { selectAll: true });
  }, [editor, currentTool]);
  /** Pan just enough that a page-space box clears the chrome and the window edges. */
  function keepInView(box: { x: number; y: number; maxX: number; maxY: number }) {
    const from = editor.pageToScreen({ x: box.x, y: box.y }), to = editor.pageToScreen({ x: box.maxX, y: box.maxY });
    const left = document.querySelector(".editor-chrome.left-closed") ? 80 : 310;
    const right = window.innerWidth - (document.querySelector(".editor-chrome.right-closed") ? 24 : 260), top = 104, bottom = window.innerHeight - 90;
    const dx = to.x > right ? Math.max(right - to.x, left - from.x) : from.x < left ? left - from.x : 0;
    const dy = to.y > bottom ? Math.max(bottom - to.y, top - from.y) : from.y < top ? top - from.y : 0;
    const camera = editor.getCamera();
    if (dx || dy) editor.setCamera({ x: camera.x + dx / camera.z, y: camera.y + dy / camera.z, z: camera.z }, { animation: { duration: 160 } });
  }
  /** The part of the board the person can see, in page space, clear of the chrome. */
  function visiblePage() {
    const left = document.querySelector(".editor-chrome.left-closed") ? 80 : 310;
    const right = window.innerWidth - (document.querySelector(".editor-chrome.right-closed") ? 24 : 260), top = 104, bottom = window.innerHeight - 90;
    const from = editor.screenToPage({ x: left, y: top }), to = editor.screenToPage({ x: Math.max(left + 1, right), y: Math.max(top + 1, bottom) });
    return { x: from.x, y: from.y, w: to.x - from.x, h: to.y - from.y };
  }
  /** N then Enter: a pink card in view, clear of everything, under what was last selected. */
  function writeFromKeyboard() {
    const view = visiblePage();
    const boxOf = (id: TLShapeId) => {
      const b = editor.getShapePageBounds(id);
      return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : undefined;
    };
    const others = editor.getCurrentPageShapes().filter((s) => s.type !== "arrow" && !s.parentId.startsWith("shape:")).flatMap((s) => boxOf(s.id) ?? []);
    const near = lastSelected.current && editor.getShape(lastSelected.current) ? boxOf(lastSelected.current) : undefined;
    const spot = keyboardCardSpot(view, others, { w: 300, h: 72 }, near && near.y + near.h < view.y + view.h ? near : undefined);
    const id = createShapeId();
    editor.markHistoryStoppingPoint("write a thought");
    editor.createShape({ id, type: "card", x: spot.x, y: spot.y, props: { tone: "human" } });
    editor.setCurrentTool("select");
    editor.select(id);
    startEditingShapeWithRichText(editor, id, { selectAll: true });
  }
  /**
   * Tab on the board: with nothing selected, select the first thing on screen; otherwise move
   * to the next object in reading order, brought clear of the chrome. The board does not trap
   * the keyboard: Shift+Tab with nothing selected, and Tab past either end, return false so
   * the browser moves on to the menu, agent chip and tools.
   */
  function tabOnBoard(backwards: boolean) {
    const ordered = tabStops(editor);
    const selectedIds = editor.getSelectedShapeIds() as string[];
    const at = ordered.findIndex((o) => o.id === selectedIds[selectedIds.length - 1]);
    let id: string | undefined;
    if (!selectedIds.length) {
      if (backwards) return false;
      id = firstTabStop(ordered, visiblePage());
    } else if (at >= 0) {
      id = ordered[at + (backwards ? -1 : 1)]?.id;
      if (!id) {
        editor.selectNone();
        return false;
      }
    } else {
      // Inside a frame or group: the canvas's own order among its siblings, past connectors
      // and anything hidden (the same rule as the page's own stops).
      for (let tries = 0; tries < 200; tries++) {
        editor.selectAdjacentShape(backwards ? "prev" : "next");
        const landed = editor.getOnlySelectedShape();
        if (!landed || (landed.type !== "arrow" && !editor.isShapeHidden(landed))) break;
      }
      id = editor.getOnlySelectedShapeId() ?? undefined;
    }
    if (!id) return false;
    editor.select(id as TLShapeId);
    const box = editor.getShapePageBounds(id as TLShapeId);
    if (box) keepInView(box);
    editor.focus();
    return true;
  }
  /** Out of the board by keyboard: the first control (Tab) or the last (Shift+Tab). */
  function leaveBoard(backwards: boolean) {
    const controls = [...document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
      (el) => !el.closest(".tl-shape, .tl-html-layer, [contenteditable=true], [class^='tl-watermark']") && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0,
    );
    (backwards ? controls[controls.length - 1] : controls[0])?.focus();
  }
  /** Ask: finish typing if a card is being written, then open the question box on the selection. */
  function askAboutSelection() {
    const editing = editor.getEditingShapeId();
    if (editing) {
      editor.complete();
      editor.setCurrentTool("select");
      editor.select(editing);
    }
    if (!editor.getSelectedShapes().some((s) => s.type !== "arrow")) {
      setNotice("Select what you mean first, then ask");
      return;
    }
    // A failed or unheard ask is sent again rather than asked about.
    const retry = editing ? undefined : selectedRetry(editor);
    if (retry) {
      resendAsk(editor, retry.id);
      return;
    }
    setAsking(true);
  }
  /** C: comment on the selection, or pin a comment where the pointer is, and start typing. */
  function addComment() {
    try {
      const targets = editor.getSelectedShapes().filter((s) => s.type !== "arrow");
      let id: string;
      if (targets.length) id = createComment(editor, { targetIds: targets.map((s) => s.id) });
      else {
        const at = pointer.current;
        const overCanvas = at && !document.elementFromPoint(at.x, at.y)?.closest("aside,header,nav,.bottom-left,.zoom-controls,.modal-backdrop");
        const point = at && overCanvas ? editor.screenToPage(at) : editor.getViewportPageBounds().center;
        id = createComment(editor, { x: point.x - 12, y: point.y - 12 });
      }
      editor.setCurrentTool("select");
      editor.select(id as never);
      // Keep the new comment clear of the side panels and the edges of the window.
      const box = editor.getShapePageBounds(id as never);
      if (box) keepInView(box);
      startEditingShapeWithRichText(editor, id as never, { selectAll: true });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not add a comment");
    }
  }
  const shapeColor =
    shape && "color" in shape.props ? shape.props.color : undefined;
  const bounds = shape ? editor.getShapePageBounds(shape) : undefined;
  // An ask answered (or failed) on a page the person has left: say so where they are now.
  useEffect(
    () =>
      editor.store.listen(
        ({ changes }) => {
          for (const [before, after] of Object.values(changes.updated)) {
            if (after.typeName !== "shape") continue;
            const shape = after as TLShape, pageId = editor.getAncestorPageId(shape);
            const said = elsewhereNotice(askOf(before as TLShape), askOf(shape), {
              onScreen: pageId === editor.getCurrentPageId(),
              question: "richText" in shape.props ? richTextPlain(shape.props.richText).trim() : "",
              pageName: (pageId && editor.getPage(pageId)?.name) || "another page",
            });
            if (said) {
              setNoticeText(said);
              setNoticeShow(shape.id);
            }
          }
        },
        { scope: "document" },
      ),
    [editor],
  );
  // The pointer over the notice, or focus in it, holds it up (timing adjustable).
  const [noticeHeld, setNoticeHeld] = useState(false);
  useEffect(() => {
    if (!notice) return;
    const delay = noticeDelay(Boolean(noticeShow), noticeHeld);
    if (delay === null) return;
    const t = setTimeout(() => setNotice(""), delay);
    return () => clearTimeout(t);
  }, [notice, noticeAt, noticeShow, noticeHeld]);
  useEffect(() => {
    if (!notice) setNoticeHeld(false);
  }, [notice]);
  /** Show: open the ask's page, select its answer (or the failed ask) and bring it into view. */
  function showElsewhere(askId: string) {
    setNotice("");
    const ask = editor.getShape(askId as TLShapeId), pageId = ask && editor.getAncestorPageId(ask);
    if (!ask || !pageId) {
      setNotice("That ask is no longer on the board");
      return;
    }
    editor.setCurrentPage(pageId);
    const onPage = [...editor.getPageShapeIds(pageId)].flatMap((id) => editor.getShape(id) ?? []);
    const ids = elsewhereShow(askOf(ask)?.state ?? "", ask.id, onPage.map((s) => ({ id: s.id, replyTo: s.meta.replyTo, hidden: editor.isShapeHidden(s) })));
    editor.setCurrentTool("select");
    editor.select(...(ids as TLShapeId[]));
    // Centre the ask and what answered it together, so the answer is seen with its question;
    // zoom out only when they do not fit the window at this zoom.
    const box = Box.Common([ask.id, ...ids].flatMap((id) => editor.getShapePageBounds(id as TLShapeId) ?? []));
    const view = editor.getViewportPageBounds();
    if (box.w > view.w * 0.8 || box.h > view.h * 0.7) editor.zoomToBounds(box, { inset: 80, animation: { duration: 180 } });
    else editor.centerOnPoint(box.center, { animation: { duration: 180 } });
    editor.focus();
  }
  const showRef = useRef<() => void>(() => {});
  showRef.current = () => noticeShow && showElsewhere(noticeShow);
  const showing = useRef(false);
  showing.current = Boolean(notice && noticeShow);
  function chooseTool(id: string) {
    // Scratchbook defaults: the human writes in pink ink and handwriting.
    const scratch = id === "draw" || id === "note" || id === "arrow";
    editor.setStyleForNextShapes(
      DefaultColorStyle,
      id === "note" ? humanStyle.note : scratch ? humanStyle.ink : "black",
    );
    editor.setStyleForNextShapes(
      DefaultFontStyle,
      id === "note" ? humanStyle.font : "sans",
    );
    editor.setStyleForNextShapes(DefaultDashStyle, id === "draw" ? "draw" : "solid");
    if (id === "ellipse") {
      editor.setStyleForNextShapes(GeoShapeGeoStyle, "ellipse");
      editor.setCurrentTool("geo");
    } else {
      if (id === "geo")
        editor.setStyleForNextShapes(GeoShapeGeoStyle, "rectangle");
      editor.setCurrentTool(id);
    }
    editor.focus();
  }
  function patch(value: object) {
    if (!shape) return;
    try {
      patchObject(editor, {
        id: shape.id,
        expectedRevision: revision(shape),
        ...value,
      });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not update object");
    }
  }
  async function addImage(files: FileList | null) {
    if (!files?.length) return;
    try {
      await editor.putExternalContent({
        type: "files",
        files: Array.from(files),
        point: editor.getViewportPageBounds().center,
      });
      setNotice("Image added");
    } catch {
      setNotice("Could not import that image");
    }
  }
  async function exportFile() {
    try {
      const blob = new Blob([await serializeTldrawJson(editor)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "paired.canvas.json";
      a.click();
      URL.revokeObjectURL(url);
      setNotice("Canvas exported");
    } catch {
      setNotice("Could not export the canvas");
    }
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      const result = parseTldrawJsonFile({
        json: await file.text(),
        schema: editor.store.schema,
      });
      if (!result.ok) throw Error();
      editor.store.loadStoreSnapshot(result.value.getStoreSnapshot());
      editor.clearHistory();
      editor.zoomToFit();
      setNotice("Canvas imported");
    } catch {
      setNotice("That file is not a valid Paired canvas");
    }
  }

  /** A new board is one click: an empty page with the invitation, the old ones kept. */
  function addPage() {
    const id = PageRecordType.createId();
    editor.createPage({ id, name: `Board ${pages.length + 1}`, meta: { seeded: 3 } });
    editor.setCurrentPage(id);
    calmSeed(editor);
    editor.clearHistory();
    setMenuOpen(false);
  }
  /** The longer tour of what the canvas can do, on its own board. */
  function openTour() {
    const existing = pages.find((p) => p.meta.tour === true);
    if (existing) editor.setCurrentPage(existing.id);
    else {
      const id = PageRecordType.createId();
      editor.createPage({ id, name: "Tour", meta: { seeded: 2, tour: true } });
      editor.setCurrentPage(id);
      seed(editor);
      editor.updateShapes(editor.getCurrentPageShapes().map((s) => ({ id: s.id, type: s.type, meta: { ...s.meta, seed: true } })));
      editor.clearHistory();
    }
    editor.zoomToFit();
    setMenuOpen(false);
  }
  // While a card is being written, follow its growing bottom edge so the text stays on screen.
  const editingBottom = useValue("editing bottom", () => {
    const id = editor.getEditingShapeId();
    return id ? (editor.getShapePageBounds(id)?.maxY ?? null) : null;
  }, [editor]);
  useEffect(() => {
    const id = editor.getEditingShapeId(), box = id && editor.getShapePageBounds(id);
    if (box && editor.pageToScreen({ x: box.x, y: box.maxY }).y > window.innerHeight - 60) keepInView(box);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingBottom]);
  // An answer that lands while the person is looking at its ask is brought wholly into view:
  // four options in a row are wider than the room made when the ask was sent. Never while they
  // are typing, dragging or asking about something else, and never if they have looked away.
  const answeredAsks = useValue("answered asks", () => editor.getCurrentPageShapes().flatMap((s) => {
    const ask = askOf(s);
    return ask?.state === "answered" && ask.answeredAt ? [`${s.id}@${ask.answeredAt}`] : [];
  }).join(","), [editor]);
  const seenAnswers = useRef<Set<string> | null>(null);
  useEffect(() => {
    const asks = answeredAsks ? answeredAsks.split(",").map((key) => { const at = key.lastIndexOf("@"); return { id: key.slice(0, at), answeredAt: Number(key.slice(at + 1)) }; }) : [];
    if (!seenAnswers.current) {
      // Answers already on the board when this tab opened are not landing now.
      seenAnswers.current = new Set(asks.map((a) => `${a.id}@${a.answeredAt}`));
      return;
    }
    const landed = landedAnswers(asks, seenAnswers.current, Date.now());
    if (!landed.length || asking || editor.getEditingShapeId() || !editor.isIn("select.idle")) return;
    const view = editor.getViewportPageBounds();
    for (const id of landed) {
      const ask = editor.getShapePageBounds(id as TLShape["id"]);
      if (!ask || !view.collides(ask)) continue;
      const boxes = [ask, ...editor.getCurrentPageShapes().filter((s) => s.meta.replyTo === id).flatMap((s) => editor.getShapePageBounds(s) ?? [])];
      keepInView({ x: Math.min(...boxes.map((b) => b.x)), y: Math.min(...boxes.map((b) => b.y)), maxX: Math.max(...boxes.map((b) => b.maxX)), maxY: Math.max(...boxes.map((b) => b.maxY)) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answeredAsks]);
  return (
    <div className={`editor-chrome ${!leftOpen ? "left-closed" : ""} ${panel ? "" : "right-closed"}`}>
      <header className="topbar">
        <div className="brand">
          <Bird size={20} strokeWidth={2.1} />
          <span>paired</span>
        </div>
        <div className="top-actions">
          <SaveState />
          {openCount > 0 && <MarksCounter onOpen={() => setPanel("feedback")} />}
          <AgentChip onOpen={() => setAgentOpen(true)} />
          <button ref={menuButton} className={`subtle-button menu-button ${menuOpen ? "open" : ""}`} aria-label="Menu" aria-haspopup="menu" aria-expanded={menuOpen} title="Boards, panels, export" onClick={() => setMenuOpen((open) => !open)}>
            <Menu size={15} />
          </button>
        </div>
        {menuOpen && (
          <div ref={mainMenu.ref} onClickCapture={mainMenu.onClickCapture} className="menu" role="menu" aria-label="Menu">
            <button role="menuitem" onClick={addPage}>
              <FilePlus2 size={14} /> New board
            </button>
            {pages.length > 1 && <div className="menu-label">Boards</div>}
            {pages.length > 1 &&
              pages.map((p) => (
                <button
                  key={p.id}
                  role="menuitem"
                  className={p.id === page.id ? "current" : ""}
                  onClick={() => {
                    editor.setCurrentPage(p.id);
                    setMenuOpen(false);
                  }}
                >
                  {p.id === page.id ? <Check size={14} /> : <span className="menu-gap" />} {p.name}
                </button>
              ))}
            <div className="menu-rule" />
            <button role="menuitem" onClick={() => { setPanel(panel === "feedback" ? null : "feedback"); setMenuOpen(false); }}>
              <MessagesSquare size={14} /> Feedback queue <kbd>{keys("⇧C")}</kbd>
            </button>
            <button role="menuitem" onClick={() => { setLeftOpen(!leftOpen); setMenuOpen(false); }}>
              <Layers size={14} /> {leftOpen ? "Hide" : "Show"} layers and pages
            </button>
            <button role="menuitem" onClick={() => { setPanel(panel === "properties" ? null : "properties"); setMenuOpen(false); }}>
              <SlidersHorizontal size={14} /> {panel === "properties" ? "Hide" : "Show"} properties
            </button>
            <div className="menu-rule" />
            <button role="menuitem" onClick={() => { setAgentOpen(true); setMenuOpen(false); }}>
              <Braces size={14} /> Connect an agent
            </button>
            <button role="menuitem" onClick={openTour}>
              <MapIcon size={14} /> Tour board
            </button>
            <button role="menuitem" onClick={() => { setOverviewOpen(true); setMenuOpen(false); }}>
              <LayoutGrid size={14} /> The whole board <kbd>O</kbd>
            </button>
            <button role="menuitem" onClick={() => { setHelpOpen(true); setMenuOpen(false); }}>
              <Keyboard size={14} /> Shortcuts <kbd>?</kbd>
            </button>
            <div className="menu-rule" />
            <button role="menuitem" onClick={() => { chooseImportFile(); setMenuOpen(false); }}>
              <FileInput size={14} /> Import a file
            </button>
            {historyWhere && savedBoards > 1 && (
              <button role="menuitem" onClick={() => { setBoardsOpen(true); setMenuOpen(false); }}>
                <FolderOpen size={14} /> Saved boards
              </button>
            )}
            {historyWhere && (
              <button role="menuitem" onClick={() => { setHistoryOpen(true); setMenuOpen(false); }}>
                <History size={14} /> Earlier versions
              </button>
            )}
            <button role="menuitem" onClick={() => { void exportFile(); setMenuOpen(false); }}>
              <Download size={14} /> Export board file
            </button>
            <button role="menuitem" onClick={() => { importRef.current?.click(); setMenuOpen(false); }}>
              <Upload size={14} /> Open board file
            </button>
          </div>
        )}
        <input
          ref={importRef}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => {
            void importFile(e.currentTarget.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
      </header>
      {leftOpen && (
      <aside className="left-panel">
        <div className="panel-tabs">
          <span className="tab-current">Layers</span>
          <span className="panel-caption">Canvas</span>
          <IconButton label="Hide layers" onClick={() => setLeftOpen(false)}>
            <PanelLeftClose size={15} />
          </IconButton>
        </div>
        <div className="section-heading">
          <span>Pages</span>
          <IconButton label="Add page" onClick={addPage}>
            <Plus size={13} />
          </IconButton>
        </div>
        {learningPrototypeEnabled() && (
          <button className="page-row prototype-row" onClick={() => createLearningPrototypePage(editor)}>
            <Plus size={13} />
            <span>Learning prototype page</span>
          </button>
        )}
        {dataPrototypeEnabled() && (
          <button className="page-row prototype-row" onClick={() => createDataPrototypePage(editor)}>
            <Plus size={13} />
            <span>Data prototype page</span>
          </button>
        )}
        <div className="pages">
          {pages.map((p) => (
            <div key={p.id} className="page-row-wrap">
              <button
                className={`page-row ${p.id === page.id ? "current" : ""}`}
                onClick={() => editor.setCurrentPage(p.id)}
              >
                <Frame size={13} />
                <span>{p.name}</span>
                {p.id === page.id && <Check size={12} />}
              </button>
              {p.id === page.id && pages.length > 1 && (
                <IconButton
                  label={`Delete page ${p.name}`}
                  onClick={() => {
                    if (!window.confirm(`Delete page "${p.name}" and everything on it? You can undo.`)) return;
                    editor.markHistoryStoppingPoint("delete page");
                    editor.deletePage(p.id);
                  }}
                >
                  <Trash2 size={12} />
                </IconButton>
              )}
            </div>
          ))}
        </div>
        <LayerList pageId={page.id} collapsed={collapsed} setCollapsed={setCollapsed} />
        <footer className="left-footer">
          <span className="small-bird">
            <Bird size={14} />
          </span>
          A place to think.
        </footer>
      </aside>
      )}
      <nav className="tool-strip" aria-label="Canvas tools">
        {mainTools.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tool-button ${currentTool === t.id ? "active" : ""}`}
            aria-pressed={currentTool === t.id}
            title={`${t.name} (${t.key})`}
            onClick={() => chooseTool(t.id)}
          >
            <t.icon size={18} strokeWidth={1.6} />
            <span>{t.name}</span>
          </button>
        ))}
        <button type="button" className="tool-button ask" title={keys("Send what you wrote to your agent (⌘↵)")} onClick={askAboutSelection}>
          <Sparkles size={18} strokeWidth={1.6} />
          <span>Ask</span>
        </button>
        <div className="tool-divider" />
        <button ref={moreButton} type="button" className={`tool-button ${moreOpen || moreTools.some((t) => t.id === currentTool) ? "active" : ""}`} aria-haspopup="menu" aria-expanded={moreOpen} title="More tools" onClick={() => setMoreOpen((open) => !open)}>
          <Ellipsis size={18} strokeWidth={1.6} />
          <span>More</span>
        </button>
        {moreOpen && (
          <div ref={moreMenu.ref} onClickCapture={moreMenu.onClickCapture} className="menu more-menu" role="menu" aria-label="More tools">
            {moreTools.map((t) => (
              <button key={t.id} role="menuitem" className={currentTool === t.id ? "current" : ""} onClick={() => { chooseTool(t.id); setMoreOpen(false); }}>
                <t.icon size={14} /> {t.name} {t.key && <kbd>{t.key}</kbd>}
              </button>
            ))}
            <button role="menuitem" onClick={() => { addComment(); setMoreOpen(false); }}>
              <MessageSquarePlus size={14} /> Comment <kbd>C</kbd>
            </button>
            <button role="menuitem" onClick={() => { imageRef.current?.click(); setMoreOpen(false); }}>
              <ImagePlus size={14} /> Add an image
            </button>
          </div>
        )}
        <input
          ref={imageRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void addImage(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
      </nav>
      <ImportLayer onNotice={setNotice} />
      <StopAnnouncer />
      <SelectionBar asking={asking} setAsking={setAsking} onComment={addComment} onNotice={setNotice} keepInView={keepInView} />
      <AutoAsk keepInView={keepInView} />
      <aside className="right-panel">
        <div className="panel-tabs right-tabs" role="tablist">
          <button role="tab" aria-selected={rightTab === "properties"} className={rightTab === "properties" ? "tab-current" : "tab-other"} onClick={() => setRightTab("properties")}>
            <SlidersHorizontal size={14} /> Properties
          </button>
          <button role="tab" aria-selected={rightTab === "feedback"} className={rightTab === "feedback" ? "tab-current" : "tab-other"} onClick={() => setRightTab("feedback")}>
            <MessagesSquare size={14} /> Feedback
            <span className={openCount ? "tab-count has-open" : "tab-count"}>{openCount}</span>
          </button>
          <IconButton label="Close panel" onClick={() => setPanel(null)}>
            <X size={15} />
          </IconButton>
        </div>
        {rightTab === "feedback" ? (
          <FeedbackPanel onNotice={setNotice} />
        ) : shape && bounds ? (
          <>
            <div className="inspector-section">
              <label className="field-label" htmlFor="object-name">
                Name
              </label>
              <input
                id="object-name"
                className="name-input"
                value={shapeName(shape)}
                onChange={(e) => patch({ name: e.currentTarget.value })}
              />
            </div>
            <div className="inspector-section">
              <div className="section-title">Position & size</div>
              <div className="numeric-grid">
                <Numeric
                  label="X"
                  value={shape.x}
                  onChange={(x) => patch({ x })}
                />
                <Numeric
                  label="Y"
                  value={shape.y}
                  onChange={(y) => patch({ y })}
                />
                {"w" in shape.props && typeof shape.props.w === "number" && (
                  <Numeric
                    label="W"
                    value={shape.props.w}
                    onChange={(width) => {
                      if (width > 0) patch({ width });
                    }}
                  />
                )}
                {"h" in shape.props && typeof shape.props.h === "number" && (
                  <Numeric
                    label="H"
                    value={shape.props.h}
                    onChange={(height) => {
                      if (height > 0) patch({ height });
                    }}
                  />
                )}
              </div>
            </div>
            {"color" in shape.props && (
              <div className="inspector-section">
                <div className="section-title">Color</div>
                <div className="swatches">
                  {palette.map((c) => (
                    <button
                      key={c.id}
                      className={`swatch ${shapeColor === c.id ? "chosen" : ""}`}
                      style={{ background: c.hex }}
                      title={c.id}
                      aria-label={`Color ${c.id}`}
                      aria-pressed={shapeColor === c.id}
                      onClick={() => patch({ color: c.id })}
                    />
                  ))}
                </div>
              </div>
            )}
            {"richText" in shape.props && (
              <div className="inspector-section">
                <div className="section-title">Text</div>
                <div className="segmented">
                  <button
                    onClick={() =>
                      editor.setStyleForSelectedShapes(DefaultFontStyle, "sans")
                    }
                  >
                    Sans
                  </button>
                  <button
                    onClick={() =>
                      editor.setStyleForSelectedShapes(
                        DefaultFontStyle,
                        "serif",
                      )
                    }
                  >
                    Serif
                  </button>
                  <button
                    onClick={() =>
                      editor.setStyleForSelectedShapes(DefaultFontStyle, "mono")
                    }
                  >
                    Mono
                  </button>
                </div>
                <p className="inspector-help">
                  Double-click text on the canvas to edit.
                </p>
              </div>
            )}
            <div className="inspector-section">
              <div className="section-title">Judge</div>
              <div className="arrange-actions">
                <button
                  className={shape.meta.mark === "picked" ? "judge-on" : ""}
                  onClick={() => toggleMark(editor, selected, "picked")}
                >
                  Pick (P)
                </button>
                <button
                  className={shape.meta.mark === "rejected" ? "judge-on" : ""}
                  onClick={() => toggleMark(editor, selected, "rejected")}
                >
                  Cross out (X)
                </button>
              </div>
            </div>
            <div className="inspector-section">
              <div className="section-title">Arrange</div>
              <div className="arrange-actions">
                <button
                  onClick={() =>
                    editor.bringToFront(editor.getSelectedShapeIds())
                  }
                >
                  To front
                </button>
                <button
                  onClick={() =>
                    editor.sendToBack(editor.getSelectedShapeIds())
                  }
                >
                  To back
                </button>
              </div>
              <div className="object-actions">
                <IconButton
                  label="Duplicate selection"
                  onClick={() =>
                    editor.duplicateShapes(editor.getSelectedShapeIds())
                  }
                >
                  <Copy size={16} />
                </IconButton>
                <IconButton
                  label={shape.isLocked ? "Unlock object" : "Lock object"}
                  onClick={() =>
                    editor.updateShape({
                      id: shape.id,
                      type: shape.type,
                      isLocked: !shape.isLocked,
                    })
                  }
                >
                  {shape.isLocked ? (
                    <UnlockKeyhole size={16} />
                  ) : (
                    <LockKeyhole size={16} />
                  )}
                </IconButton>
                <IconButton
                  label="Delete selection"
                  onClick={() =>
                    editor.deleteShapes(editor.getSelectedShapeIds())
                  }
                >
                  <Trash2 size={16} />
                </IconButton>
              </div>
            </div>
            <div className="object-identity">
              <span>Object identity</span>
              <code>{shape.id}</code>
              <span>Revision {revision(shape)}</span>
              <span>By {authorOf(shape)}</span>
            </div>
          </>
        ) : (
          <>
            <div className="inspector-section">
              <div className="section-title">Your thinking space</div>
              <p className="inspector-help">
                Select anything to inspect and edit it.
              </p>
            </div>
            {selected.length > 1 && (
              <div className="inspector-section">
                <div className="section-title">Alignment</div>
                <div className="arrange-actions">
                  <button
                    onClick={() =>
                      editor.alignShapes(editor.getSelectedShapeIds(), "left")
                    }
                  >
                    Left
                  </button>
                  <button
                    onClick={() =>
                      editor.alignShapes(editor.getSelectedShapeIds(), "top")
                    }
                  >
                    Top
                  </button>
                  <button
                    onClick={() =>
                      editor.distributeShapes(
                        editor.getSelectedShapeIds(),
                        "horizontal",
                      )
                    }
                  >
                    Space evenly
                  </button>
                  <button
                    onClick={() =>
                      editor.groupShapes(editor.getSelectedShapeIds())
                    }
                  >
                    Group
                  </button>
                </div>
              </div>
            )}
            {selected.length > 1 && prototypeEnabled("converge") && (
              <div className="inspector-section">
                <div className="section-title">Converge · prototype</div>
                <p className="inspector-help">
                  Pull these into one synthesis card that links back to each of them. Write the conclusion in your own words.
                </p>
                <button
                  className="wide-button"
                  onClick={() => convergeForPerson(editor, editor.getSelectedShapes().filter((s) => s.type !== "arrow").map((s) => s.id))}
                >
                  Pull into a synthesis
                </button>
              </div>
            )}
            <div className="inspector-section">
              <div className="section-title">Shortcuts</div>
              <dl className="shortcuts">
                <div>
                  <dt>Comment</dt>
                  <dd>C</dd>
                </div>
                <div>
                  <dt>Pick / cross out</dt>
                  <dd>P / X</dd>
                </div>
                <div>
                  <dt>All shortcuts</dt>
                  <dd>?</dd>
                </div>
                <div>
                  <dt>Pan</dt>
                  <dd>Space + drag</dd>
                </div>
                <div>
                  <dt>Zoom</dt>
                  <dd>Pinch</dd>
                </div>
                <div>
                  <dt>Fit everything</dt>
                  <dd>Shift + 1</dd>
                </div>
                <div>
                  <dt>Fit selection</dt>
                  <dd>Shift + 2</dd>
                </div>
                <div>
                  <dt>Duplicate</dt>
                  <dd>{keys("⌘ D")}</dd>
                </div>
                <div>
                  <dt>Undo</dt>
                  <dd>{keys("⌘ Z")}</dd>
                </div>
              </dl>
            </div>
          </>
        )}
      </aside>
      <div className="bottom-left">
        <IconButton label="Undo" disabled={!undo} onClick={() => editor.undo()}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton label="Redo" disabled={!redo} onClick={() => editor.redo()}>
          <Redo2 size={16} />
        </IconButton>
      </div>
      <div className="zoom-controls">
        <IconButton
          label="Zoom out"
          onClick={() =>
            editor.zoomOut(editor.getViewportScreenCenter(), {
              animation: { duration: 140 },
            })
          }
        >
          <Minus size={14} />
        </IconButton>
        <button
          className="zoom-value"
          onClick={() =>
            editor.resetZoom(editor.getViewportScreenCenter(), {
              animation: { duration: 140 },
            })
          }
          aria-label="Reset zoom to 100 percent"
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton
          label="Zoom in"
          onClick={() =>
            editor.zoomIn(editor.getViewportScreenCenter(), {
              animation: { duration: 140 },
            })
          }
        >
          <Plus size={14} />
        </IconButton>
        <span className="bottom-divider" />
        <IconButton
          label="Fit all objects"
          onClick={() => editor.zoomToFit({ animation: { duration: 180 } })}
        >
          <Maximize size={15} />
        </IconButton>
        <IconButton label="Keyboard shortcuts (?)" onClick={() => setHelpOpen(true)}>
          <Keyboard size={15} />
        </IconButton>
      </div>
      {notice && (
        <div
          className="toast"
          role="status"
          onPointerEnter={() => setNoticeHeld(true)}
          onPointerLeave={() => setNoticeHeld(false)}
          onFocus={() => setNoticeHeld(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setNoticeHeld(false);
          }}
        >
          {notice}
          {noticeShow && (
            <button type="button" className="toast-action" onClick={() => showRef.current()}>
              Show{!TOUCH && <kbd>G</kbd>}
            </button>
          )}
        </div>
      )}
      {link.mode === "local" && link.state === "disconnected" && (
        <div className="link-banner" role="alert">
          Lost the connection to the local server, so agents cannot reach this board. Your work is still saved here. It reconnects by itself; reload if it does not.
        </div>
      )}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {overviewOpen && <BoardOverview onClose={() => setOverviewOpen(false)} />}
      {historyOpen && historyWhere && <HistoryDialog where={historyWhere} onClose={() => setHistoryOpen(false)} />}
      {boardsOpen && historyWhere && <SavedBoardsDialog where={historyWhere} onClose={() => setBoardsOpen(false)} />}
      {agentOpen && (
        <div className="modal-backdrop" onClick={() => setAgentOpen(false)}>
          <FocusSection
            onClose={() => setAgentOpen(false)}
            className="agent-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Agent access"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-heading">
              <Braces size={18} />
              <h2>Bring your own agent</h2>
              <IconButton
                label="Close agent access"
                onClick={() => setAgentOpen(false)}
              >
                <X size={17} />
              </IconButton>
            </div>
            {import.meta.env.DEV ? <>
            <p className="agent-status">
              <span className={`status-dot ${listeners?.length ? "connected" : "connecting"}`} />
              {listeners?.length ? `${listeners.join(", ")} is listening and answers your asks.` : "No agent is listening, so asks will wait."}
            </p>
            <p>The resident agent answers asks with Claude Code on this computer. Start it in a terminal and leave it running:</p>
            <CopyBlock text="pnpm --filter @pairedcc/canvas agent" onCopied={setNotice} />
            <p>
              Or connect Claude Code, Codex or another MCP client to this open
              canvas. It uses the same objects and history as your edits.
            </p>
            <CopyBlock
              text={JSON.stringify(localMcpConfig(__CANVAS_DIR__, sessionStorage.getItem("picabird-agent-session") ?? ""), null, 2)}
              onCopied={setNotice}
            />
            <p className="inspector-help">
              HTTP: POST http://localhost:5183/api/canvas/command. Keep this tab
              open. Access is local to this computer.
            </p>
            </> : <HostedAgentAccess onCopied={setNotice} />}
          </FocusSection>
        </div>
      )}
    </div>
  );
}
import { GeoShapeGeoStyle, PageRecordType, createShapeId, react } from "tldraw";
import { TOUCH, keys } from "./keys";
const scratchShapes = [CardShapeUtil, DataTableShapeUtil, PromptShapeUtil, DatasetShapeUtil, ChartShapeUtil, BoardImageShapeUtil];
const TEXT_WRAP = 460;
// One set of editor options: the page limit, and double-click writes a card rather than plain text.
const editorOptions = { ...canvasOptions, createTextOnCanvasDoubleClick: false };
const scratchTools = [CardShapeTool];
function CanvasLayers() {
  return (
    <>
      <ScratchbookLayer />
      <AskLayer />
      <DataLayer />
    </>
  );
}
function App() {
  const [ready, setReady] = useState(false);
  const [agentEditor, setAgentEditor] = useState<Editor | null>(null);
  useEffect(() => {
    if (agentEditor) return connectAgentAccess(agentEditor);
  }, [agentEditor]);
  if (import.meta.env.PROD && !import.meta.env.VITE_TLDRAW_LICENSE_KEY) {
    return <main style={{ padding: 64, maxWidth: 640, margin: "auto", fontFamily: "sans-serif" }}>
      <h1>Paired canvas</h1>
      <p>The canvas is being set up. The document editor is available now.</p>
      <a href="/documents">Open the document editor</a>
    </main>;
  }
  const components: TLComponents = {
    InFrontOfTheCanvas: Shell,
    OnTheCanvas: CanvasLayers,
    Background: PaperBackground,
  };
  function mount(editor: Editor) {
    editor.user.updateUserPreferences({
      colorScheme: "light",
      isSnapMode: true,
      isDynamicSizeMode: false,
    });
    editor.setStyleForNextShapes(DefaultDashStyle, "solid");
    editor.setStyleForNextShapes(DefaultFontStyle, "sans");
    // Thariq's palette: deep indigo for agent connectors, crimson for the human's ink.
    editor.updateThemes((themes) => {
      const theme = themes.default, light = theme.colors.light;
      return {
        ...themes,
        default: {
          ...theme,
          colors: {
            ...theme.colors,
            light: {
              ...light,
              violet: { ...light.violet, solid: "#3a2fd0" },
              red: { ...light.red, solid: "#c8125a" },
            },
          },
          // Scratchbook type: the pen is a brush marker, plain text is a casual print,
          // serif is for quoted sources and mono for data. Faces load from Google Fonts.
          fonts: {
            ...theme.fonts,
            draw: { ...theme.fonts.draw, fontFamily: "'Caveat Brush', cursive", faces: [] },
            sans: { ...theme.fonts.sans, fontFamily: "'Shantell Sans', sans-serif", faces: [] },
            serif: { ...theme.fonts.serif, fontFamily: "Newsreader, Georgia, serif", faces: [] },
            mono: { ...theme.fonts.mono, fontFamily: "'JetBrains Mono', ui-monospace, monospace", faces: [] },
          },
        },
      };
    });
    editor.setStyleForNextShapes(DefaultFillStyle, "solid");
    const revisions = new Map<string, number>();
    editor.sideEffects.registerBeforeChangeHandler(
      "shape",
      (previous, next) => {
        // Re-derived values (a card re-measuring its text) are not edits: leave the revision.
        if (onlyDerivedChange(previous, next)) return next;
        const version =
          Math.max(
            revisions.get(next.id) ?? 0,
            revision(previous),
            revision(next),
          ) + 1;
        revisions.set(next.id, version);
        return { ...next, meta: { ...next.meta, revision: version } };
      },
    );
    // Timestamps: when each object was made and when its text last changed.
    editor.sideEffects.registerBeforeCreateHandler("shape", (shape, source) =>
      source === "user" ? { ...shape, meta: { ...shape.meta, createdAt: Date.now() } } : shape,
    );
    editor.sideEffects.registerBeforeChangeHandler("shape", (previous, next, source) => {
      if (source !== "user" || !("richText" in previous.props) || !("richText" in next.props)) return next;
      if (previous.props.richText === next.props.richText) return next;
      return { ...next, meta: { ...next.meta, updatedAt: Date.now() } };
    });
    window.paired = createBridge(editor);
    // Images from before boards kept them: copy them into the board so the next save carries
    // them. Done once sync is listening (after a save or load), so the copy is itself saved;
    // a board with no account gets it after a few seconds. A no-op when there is nothing to move.
    let moving = false;
    const moveImages = () => {
      if (moving) return;
      moving = true;
      void moveLocalImagesIntoBoard(editor).finally(() => (moving = false));
    };
    const stopImageMove = react("move older images into the board", () => {
      if (boardSync.get().state === "saved") moveImages();
    });
    const imageMoveTimer = setTimeout(moveImages, 8000);
    if (import.meta.env.DEV) window.__pairedEditor = editor;
    setAgentEditor(editor);
    const page = editor.getCurrentPage();
    // A brand-new canvas: nothing on it and never laid out. It holds no work of the person's own.
    const fresh = editor.getCurrentPageShapes().length === 0 && editor.getPages().length === 1 && !page.meta.seeded;
    // Plain text wraps at a reading width and grows downward instead of running off the board.
    const wrapText = (shape: TLShape) => {
      if (shape.type !== "text" || !("autoSize" in shape.props) || !shape.props.autoSize || shape.meta.fixedWidth) return;
      const scale = "scale" in shape.props && typeof shape.props.scale === "number" ? shape.props.scale : 1;
      if (editor.getShapeGeometry(shape).bounds.w <= TEXT_WRAP * scale) return;
      editor.updateShape({ id: shape.id, type: "text", props: { autoSize: false, w: TEXT_WRAP } });
    };
    editor.sideEffects.registerAfterCreateHandler("shape", (shape) => {
      wrapText(shape);
      // Pasted text arrives at a fixed width close to the whole screen; bring it to a reading width.
      if (shape.type === "text" && "w" in shape.props && !shape.props.autoSize && shape.props.w > TEXT_WRAP && !shape.meta.fixedWidth)
        editor.updateShape({ id: shape.id, type: "text", props: { w: TEXT_WRAP } });
    });
    editor.sideEffects.registerAfterChangeHandler("shape", (_previous, next) => wrapText(next));
    // What the person moves takes its comments, notes and replies along (same step, same undo).
    // Undo, redo and a cancelled drag (bail) restore followers from history themselves, so
    // following pauses while they run.
    let replaying = false;
    for (const name of ["undo", "redo", "bail", "bailToMark"] as const) {
      const original = editor[name].bind(editor) as (...args: unknown[]) => Editor;
      (editor as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        replaying = true;
        try {
          return original(...args);
        } finally {
          replaying = false;
        }
      };
    }
    editor.sideEffects.registerAfterChangeHandler("shape", (previous, next) => {
      if (replaying || followPause.active) return;
      const dx = next.x - previous.x, dy = next.y - previous.y;
      if ((!dx && !dy) || previous.parentId !== next.parentId) return;
      const selected = new Set<string>(editor.getSelectedShapeIds());
      if (!selected.has(next.id)) return;
      // A frame or group carries its subtree: comments on its children follow, and nothing
      // inside it (say a comment about the frame placed in the frame) is moved a second time.
      const subtree = [...editor.getShapeAndDescendantIds([next.id])] as string[];
      const ids = followers(subtree, editor.getCurrentPageShapes(), new Set([...selected, ...subtree]));
      if (!ids.length) return;
      editor.updateShapes(
        ids.flatMap((id) => {
          const s = editor.getShape(id as TLShape["id"]);
          return s && !s.isLocked ? [{ id: s.id, type: s.type, x: s.x + dx, y: s.y + dy }] : [];
        }),
      );
    });
    followConnectors(editor);
    // Double-click the empty board to write a thought: a pink card, already in typing mode.
    const writeOnDoubleClick = (info: { type: string; name?: string; phase?: string; target?: string }) => {
      if (info.type !== "click" || info.name !== "double_click" || info.phase !== "up" || info.target !== "canvas") return;
      if (editor.getCurrentToolId() !== "select" || editor.getEditingShapeId()) return;
      const point = editor.inputs.getCurrentPagePoint();
      if (editor.getShapeAtPoint(point, { hitInside: true, margin: 4 })) return;
      const id = createShapeId();
      editor.markHistoryStoppingPoint("write a thought");
      editor.createShape({ id, type: "card", x: point.x - 24, y: point.y - 28, props: { tone: "human" } });
      editor.select(id);
      startEditingShapeWithRichText(editor, id, { selectAll: true });
    };
    editor.on("event", writeOnDoubleClick);
    // Lay out the first board once the board's fonts are in, so its cards measure right.
    // Existing cards keep their saved heights: a card on screen re-measures itself when
    // its fonts arrive (useAutoHeight), and re-estimating all of them here changed saved
    // objects on every reload.
    const fonts = Promise.all(
      ["16px 'Shantell Sans'", "bold 30px 'Shantell Sans'", "27px 'Caveat Brush'", "italic 19px Newsreader", "13px 'JetBrains Mono'"].map((f) => document.fonts.load(f)),
    );
    const timeout = new Promise((done) => setTimeout(done, 2500));
    const prepare = () => {
      // The calm first board is laid out once per document. A board saved by an earlier
      // version is kept as its own page; the calm board opens beside it.
      const settings = editor.getDocumentSettings();
      if (settings.meta.calm === 3) return;
      const untouched = editor.getPages().length === 1 && editor.getCurrentPageShapes().length === 0;
      if (untouched) editor.updatePage({ id: editor.getCurrentPageId(), name: "Board 1", meta: { seeded: 3 } });
      else {
        const working = editor.getCurrentPageId();
        // A board that was empty when this tab opened and has been worked on since (an agent
        // acted before the fonts arrived, or the person started writing) keeps that work in
        // view: the calm board is laid out on its own page without moving there. If the tab's
        // first page was left empty (an agent made a page of its own), that page takes it.
        const empty = fresh ? editor.getPages().find((p) => p.id !== working && editor.getSortedChildIdsForParent(p.id).length === 0) : undefined;
        const id = empty?.id ?? PageRecordType.createId();
        if (empty) editor.updatePage({ id: empty.id, name: "Board 1", meta: { ...empty.meta, seeded: 3 } });
        else editor.createPage({ id, name: "Thinking", meta: { seeded: 3 } });
        editor.setCurrentPage(id);
        if (fresh) {
          calmSeed(editor);
          editor.setCurrentPage(working);
          editor.updateDocumentSettings({ meta: { ...settings.meta, calm: 3 } });
          editor.clearHistory();
          return;
        }
      }
      calmSeed(editor);
      editor.updateDocumentSettings({ meta: { ...settings.meta, calm: 3 } });
      editor.clearHistory();
    };
    let disposed = false;
    let stopSync: (() => void) | undefined;
    void Promise.race([fonts, timeout]).catch(() => undefined).then(() => {
      prepare();
      // A board laid out on a wider screen can open with nothing in view here.
      bringContentIntoView(editor);
      // Then keep the board saved to the account; a brand-new board holds no work of its own.
      // A board saved before the calm canvas, loaded from the account, gets the calm board too:
      // the load replaces what prepare() laid out on this tab's copy.
      if (!disposed) stopSync = startBoardSync(editor, !fresh, () => {
        if (disposed) return;
        prepare();
        bringContentIntoView(editor);
      });
    });
    setReady(true);
    return () => {
      disposed = true;
      stopSync?.();
      editor.off("event", writeOnDoubleClick);
      delete window.paired;
      delete window.__pairedEditor;
      stopImageMove();
      clearTimeout(imageMoveTimer);
    };
  }
  return (
    <main className="app">
      <div className="canvas-stage">
        <Tldraw
          licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
          persistenceKey="picabird-canvas-v1"
          assets={boardImageStore}
          shapeUtils={scratchShapes}
          getShapeVisibility={learningVisibility}
          tools={scratchTools}
          hideUi
          options={editorOptions}
          components={components}
          onMount={mount}
        />
      </div>
      {!ready && (
        <div className="loading">
          <Bird size={24} />
          <span>Opening your canvas…</span>
        </div>
      )}
    </main>
  );
}
export default App;
