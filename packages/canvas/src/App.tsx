import React, { useState, useRef, useEffect } from "react";
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
} from "lucide-react";
import {
  createObject,
  createBridge,
  patchObject,
  shapeName,
  revision,
  type CanvasBridge,
} from "./operations";
import { agentLink, connectAgentAccess } from "./agent-client";
import { createComment } from "./agent-operations";
import { FeedbackPanel, SaveState, AgentChip } from "./feedback-panel";
import { isLegacySeed, seed } from "./seed";
import { CardShapeUtil, CardShapeTool, refitCards } from "./card-shape";
import { PromptShapeUtil, createLearningPrototypePage, learningPrototypeEnabled, learningVisibility } from "./learning/prompt-shape";
import { ChartShapeUtil, DataLayer, DatasetShapeUtil, createDataPrototypePage, dataPrototypeEnabled } from "./data/shapes";
import {
  PaperBackground,
  ScratchbookLayer,
  MarksCounter,
  toggleMark,
  authorOf,
  humanStyle,
  collectFeedback,
  HUMAN,
} from "./scratchbook";
import { richTextPlain } from "./operations";
import "tldraw/tldraw.css";
import "./style.css";

declare global {
  interface Window {
    paired?: CanvasBridge;
    /** Development builds only: the editor, for `pnpm eval:canvas` fixtures and timing. */
    __pairedEditor?: Editor;
  }
}
const tools = [
  { id: "select", name: "Move", key: "V", icon: MousePointer2 },
  { id: "hand", name: "Pan", key: "H", icon: Hand },
  { id: "frame", name: "Frame", key: "F", icon: Frame },
  { id: "geo", name: "Rectangle", key: "R", icon: Square },
  { id: "ellipse", name: "Ellipse", key: "O", icon: Circle },
  { id: "draw", name: "Pen", key: "D", icon: Pencil },
  { id: "text", name: "Text", key: "T", icon: Type },
  { id: "card", name: "Note", key: "N", icon: StickyNote },
  { id: "arrow", name: "Arrow", key: "A", icon: ArrowUpRight },
];
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
          onClick={() => (location.href = `/docs/login?returnTo=${encodeURIComponent("/canvas/")}`)}
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
    title: "Feedback",
    rows: [
      ["Comment on the selection, or pin one at the pointer", "C"],
      ["Pick the selection (again to undo)", "P"],
      ["Reject the selection (again to undo)", "X"],
      ["Open or close the feedback queue", "Shift C"],
      ["Finish typing", "Esc"],
    ],
  },
  { title: "Tools", rows: tools.map((t) => [t.name, t.key] as [string, string]) },
  {
    title: "Move around",
    rows: [
      ["Pan", "Space + drag, or scroll"],
      ["Zoom", "Pinch, or ⌘ scroll"],
      ["Fit everything", "Shift 1"],
      ["Fit selection", "Shift 2"],
    ],
  },
  {
    title: "Edit",
    rows: [
      ["Undo / redo", "⌘ Z / ⇧ ⌘ Z"],
      ["Duplicate", "⌘ D"],
      ["Select all", "⌘ A"],
      ["Delete", "⌫"],
      ["Edit text", "Double-click or Enter"],
      ["Deselect, back to Move", "Esc"],
      ["This list", "?"],
    ],
  },
];

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="agent-dialog shortcut-dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-heading">
          <Keyboard size={18} />
          <h2>Keyboard shortcuts</h2>
          <IconButton label="Close shortcuts" onClick={onClose}>
            <X size={17} />
          </IconButton>
        </div>
        <p>
          Pink is you, lavender with ✦ is your agent. Everything you comment on, pick or reject goes into one feedback queue that your agent reads and answers.
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

function Shell() {
  const editor = useEditor();
  const [rightTab, setRightTab] = useState<"properties" | "feedback">("properties");
  const [helpOpen, setHelpOpen] = useState(false);
  const openCount = useValue("open feedback", () => collectFeedback(editor).filter((i) => i.status === "open").length, [editor]);
  const link = useValue("agent link", () => agentLink.get(), []);
  const editingId = useValue("editing", () => editor.getEditingShapeId(), [editor]);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const shapes = useValue("layers", () => editor.getCurrentPageShapesSorted(), [
    editor,
  ]);
  const selected = useValue("selection", () => editor.getSelectedShapes(), [
    editor,
  ]);
  const currentTool = useValue("tool", () => editor.getCurrentToolId(), [
    editor,
  ]);
  const zoom = useValue("zoom", () => editor.getZoomLevel(), [editor]);
  const pages = useValue("pages", () => editor.getPages(), [editor]);
  const page = useValue("page", () => editor.getCurrentPage(), [editor]);
  const undo = useValue("can undo", () => editor.getCanUndo(), [editor]),
    redo = useValue("can redo", () => editor.getCanRedo(), [editor]);
  const [leftOpen, setLeftOpen] = useState(true),
    [agentOpen, setAgentOpen] = useState(false),
    [notice, setNotice] = useState(""),
    [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const importRef = useRef<HTMLInputElement>(null),
    imageRef = useRef<HTMLInputElement>(null);
  const shape = selected.length === 1 ? selected[0] : undefined;
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input,textarea,select,[contenteditable=true]")
      )
        return;
      if (event.altKey) return;
      const key = event.key.toLowerCase(),
        mod = event.metaKey || event.ctrlKey;
      if (mod) {
        if (key === "z") {
          event.preventDefault();
          event.shiftKey ? editor.redo() : editor.undo();
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
      if (
        target instanceof HTMLElement &&
        target.closest("input,textarea,select,[contenteditable=true]")
      )
        return;
      const key = event.key.toLowerCase();
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (editor.getEditingShapeId()) return;
      // ? shows the shortcuts, C comments, Shift+C opens the feedback queue.
      if (event.key === "?" || (key === "c" && !event.repeat)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "?") setHelpOpen((open) => !open);
        else if (event.shiftKey) setRightTab((tab) => (tab === "feedback" ? "properties" : "feedback"));
        else addComment();
        return;
      }
      if (event.shiftKey) return;
      if (key !== "p" && key !== "x") return;
      const picked = editor.getSelectedShapes();
      if (!picked.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleMark(editor, picked, key === "p" ? "picked" : "rejected");
    }
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
      if (box) {
        const from = editor.pageToScreen({ x: box.x, y: box.y }), to = editor.pageToScreen({ x: box.maxX, y: box.maxY });
        const left = document.querySelector(".editor-chrome.left-closed") ? 70 : 300, right = window.innerWidth - 260, top = 64, bottom = window.innerHeight - 90;
        const dx = to.x > right ? right - to.x : from.x < left ? left - from.x : 0;
        const dy = to.y > bottom ? bottom - to.y : from.y < top ? top - from.y : 0;
        const camera = editor.getCamera();
        if (dx || dy) editor.setCamera({ x: camera.x + dx / camera.z, y: camera.y + dy / camera.z, z: camera.z }, { animation: { duration: 160 } });
      }
      startEditingShapeWithRichText(editor, id as never, { selectAll: true });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not add a comment");
    }
  }
  const shapeColor =
    shape && "color" in shape.props ? shape.props.color : undefined;
  const bounds = shape ? editor.getShapePageBounds(shape) : undefined;
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);
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

  function addPage() {
    const id = PageRecordType.createId();
    editor.createPage({ id, name: `Page ${pages.length + 1}` });
    editor.setCurrentPage(id);
  }
  // A result hidden behind a learning prompt must not leak through its layer name.
  function layerName(s: TLShape) {
    return editor.isShapeHidden(s) ? "Hidden until you answer" : shapeName(s);
  }
  function layerRows(parentId: string, depth = 0): React.ReactNode {
    return shapes
      .filter((s) => s.parentId === parentId)
      .reverse()
      .map((s) => {
        const children = shapes.some((c) => c.parentId === s.id),
          isCollapsed = collapsed.has(s.id);
        return (
          <React.Fragment key={s.id}>
            <div
              className={`layer ${selected.some((t) => t.id === s.id) ? "selected" : ""}`}
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
    <div className={`editor-chrome ${!leftOpen ? "left-closed" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <Bird size={20} strokeWidth={2.1} />
          <span>paired</span>
        </div>
        <div className="file-title">
          <span>Untitled exploration</span>
          <ChevronDown size={12} />
          <span className="local-badge">Local</span>
          <MarksCounter onOpen={() => setRightTab("feedback")} />
        </div>
        <div className="top-actions">
          <SaveState />
          <AgentChip onOpen={() => setAgentOpen(true)} />
          <button className="subtle-button" onClick={() => setAgentOpen(true)}>
            <Braces size={14} /> Agent access
          </button>
          <button className="dark-button" onClick={exportFile}>
            <Download size={13} /> Export
          </button>
        </div>
      </header>
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
        <div className="section-heading border-top">
          <span>Objects</span>
          <span>{shapes.length}</span>
        </div>
        <div className="layer-list">
          {layerRows(page.id)}
          {shapes.length === 0 && (
            <p className="empty-layers">
              Your first thought starts here.
              <br />
              Choose a tool and draw.
            </p>
          )}
        </div>
        <footer className="left-footer">
          <span className="small-bird">
            <Bird size={14} />
          </span>
          A place to think.
        </footer>
      </aside>
      {!leftOpen && (
        <div className="restore-panel">
          <IconButton label="Show layers" onClick={() => setLeftOpen(true)}>
            <PanelLeftOpen size={17} />
          </IconButton>
        </div>
      )}
      <nav className="tool-strip" aria-label="Canvas tools">
        {tools.map((t, i) => (
          <React.Fragment key={t.id}>
            {i === 2 && <div className="tool-divider" />}
            <IconButton
              label={`${t.name} (${t.key})`}
              active={t.id === "ellipse" ? false : currentTool === t.id}
              onClick={() => chooseTool(t.id)}
            >
              <t.icon size={18} strokeWidth={1.6} />
            </IconButton>
          </React.Fragment>
        ))}
        <div className="tool-divider" />
        <IconButton label="Comment on the selection, or on the board (C)" onClick={addComment}>
          <MessageSquarePlus size={18} />
        </IconButton>
        <IconButton
          label="Import image"
          onClick={() => imageRef.current?.click()}
        >
          <ImagePlus size={18} />
        </IconButton>
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
      <aside className="right-panel">
        <div className="panel-tabs right-tabs" role="tablist">
          <button role="tab" aria-selected={rightTab === "properties"} className={rightTab === "properties" ? "tab-current" : "tab-other"} onClick={() => setRightTab("properties")}>
            <SlidersHorizontal size={14} /> Properties
          </button>
          <button role="tab" aria-selected={rightTab === "feedback"} className={rightTab === "feedback" ? "tab-current" : "tab-other"} onClick={() => setRightTab("feedback")}>
            <MessagesSquare size={14} /> Feedback
            <span className={openCount ? "tab-count has-open" : "tab-count"}>{openCount}</span>
          </button>
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
                  Reject (X)
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
            <div className="inspector-section">
              <div className="section-title">Shortcuts</div>
              <dl className="shortcuts">
                <div>
                  <dt>Comment</dt>
                  <dd>C</dd>
                </div>
                <div>
                  <dt>Pick / reject</dt>
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
                  <dd>⌘ D</dd>
                </div>
                <div>
                  <dt>Undo</dt>
                  <dd>⌘ Z</dd>
                </div>
              </dl>
            </div>
            <div className="inspector-section">
              <button
                className="wide-button"
                onClick={() => importRef.current?.click()}
              >
                <Upload size={14} /> Open canvas file
              </button>
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
        <span className="bottom-divider" />
        <span className="canvas-caption">{page.name}</span>
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
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {link.mode === "local" && link.state === "disconnected" && (
        <div className="link-banner" role="alert">
          Lost the connection to the local server, so agents cannot reach this board. Your work is still saved here. It reconnects by itself; reload if it does not.
        </div>
      )}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      {agentOpen && (
        <div className="modal-backdrop" onClick={() => setAgentOpen(false)}>
          <section
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
            <p>
              Connect Claude Code, Codex or another MCP client to this open
              canvas. The local HTTP API uses the same objects and history as
              your edits.
            </p>
            <CopyBlock
              text={JSON.stringify({ mcpServers: { paired: { command: "node", args: [
                "/Users/yingcong/Code/tools/pairedcc/packages/canvas/node_modules/tsx/dist/cli.mjs",
                "/Users/yingcong/Code/tools/pairedcc/packages/canvas/tools/mcp.ts",
              ], env: { PAIRED_SESSION: sessionStorage.getItem("picabird-agent-session") ?? "" } } } }, null, 2)}
              onCopied={setNotice}
            />
            <p className="inspector-help">
              HTTP: POST http://localhost:5183/api/canvas/command. Keep this tab
              open. Access is local to this computer.
            </p>
            </> : <HostedAgentAccess onCopied={setNotice} />}
            <button
              className="wide-button"
              onClick={() => {
                const center = editor.getViewportPageBounds().center;
                createObject(editor, {
                  kind: "note",
                  x: center.x - 100,
                  y: center.y - 100,
                  text: "What else could be true?",
                  name: "A question worth exploring",
                });
                setAgentOpen(false);
                editor.focus();
              }}
            >
              Try creating an object
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
import { GeoShapeGeoStyle, PageRecordType } from "tldraw";
const scratchShapes = [CardShapeUtil, PromptShapeUtil, DatasetShapeUtil, ChartShapeUtil];
const scratchTools = [CardShapeTool];
function CanvasLayers() {
  return (
    <>
      <ScratchbookLayer />
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
    if (import.meta.env.DEV) window.__pairedEditor = editor;
    setAgentEditor(editor);
    const page = editor.getCurrentPage();
    const fresh = editor.getCurrentPageShapes().length === 0 && editor.getPages().length === 1 && !page.meta.seeded;
    // Swap the old starter board for the welcome board, but only if nobody has touched it.
    const legacy = page.meta.seeded === true && isLegacySeed(editor);
    // Cards size themselves from measured text, so wait for the board's fonts, then
    // re-measure existing cards and lay out the welcome board if this is a new canvas.
    const fonts = Promise.all(
      ["16px 'Shantell Sans'", "bold 30px 'Shantell Sans'", "27px 'Caveat Brush'", "italic 19px Newsreader", "13px 'JetBrains Mono'"].map((f) => document.fonts.load(f)),
    );
    const timeout = new Promise((done) => setTimeout(done, 2500));
    void Promise.race([fonts, timeout]).catch(() => undefined).then(() => {
      refitCards(editor);
      if (!(fresh || legacy) || editor.getCurrentPage().meta.seeded === 2) return;
      if (legacy) editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
      else if (editor.getCurrentPageShapes().length) return;
      seed(editor);
      // Mark the welcome board's own objects, so its text is never mistaken for the human's notes.
      editor.updateShapes(editor.getCurrentPageShapes().map((s) => ({ id: s.id, type: s.type, meta: { ...s.meta, seed: true } })));
      editor.updatePage({ id: page.id, meta: { ...editor.getCurrentPage().meta, seeded: 2 } });
    });
    setReady(true);
    return () => {
      delete window.paired;
      delete window.__pairedEditor;
    };
  }
  return (
    <main className="app">
      <div className="canvas-stage">
        <Tldraw
          licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
          persistenceKey="picabird-canvas-v1"
          shapeUtils={scratchShapes}
          getShapeVisibility={learningVisibility}
          tools={scratchTools}
          hideUi
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
