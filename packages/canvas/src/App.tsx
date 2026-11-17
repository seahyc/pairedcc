import React, { useState, useRef, useEffect } from "react";
import {
  Tldraw,
  useEditor,
  useValue,
  DefaultDashStyle,
  DefaultFillStyle,
  DefaultFontStyle,
  serializeTldrawJson,
  parseTldrawJsonFile,
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
} from "lucide-react";
import {
  createObject,
  createBridge,
  patchObject,
  shapeName,
  revision,
  type CanvasBridge,
} from "./operations";
import { connectAgentAccess } from "./agent-client";
import { annotateObject } from "./agent-operations";
import { seed } from "./seed";
import "tldraw/tldraw.css";
import "./style.css";

declare global {
  interface Window {
    paired?: CanvasBridge;
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
  { id: "note", name: "Note", key: "N", icon: StickyNote },
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
  if (shape.type === "note") return <StickyNote size={14} />;
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
function Shell() {
  const editor = useEditor();
  const [feedbackTarget, setFeedbackTarget] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
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
    [saved] = useState("Stored on this device"),
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
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [editor]);
  const shapeColor =
    shape && "color" in shape.props ? shape.props.color : undefined;
  const bounds = shape ? editor.getShapePageBounds(shape) : undefined;
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  function chooseTool(id: string) {
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
                  aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${shapeName(s)}`}
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
                aria-label={`Select ${shapeName(s)}`}
              >
                <ShapeIcon shape={s} />
                <span>{shapeName(s)}</span>
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
        </div>
        <div className="top-actions">
          <span className="save-state">
            <Check size={12} />
            {saved}
          </span>
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
        <div className="pages">
          {pages.map((p) => (
            <button
              key={p.id}
              className={`page-row ${p.id === page.id ? "current" : ""}`}
              onClick={() => editor.setCurrentPage(p.id)}
            >
              <Frame size={13} />
              <span>{p.name}</span>
              {p.id === page.id && <Check size={12} />}
            </button>
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
        <IconButton
          label="Add feedback to selection"
          onClick={() => {
            const target = editor.getOnlySelectedShape();
            if (target) {
              setFeedbackText("");
              setFeedbackTarget(target.id);
            } else setNotice("Select an object to attach feedback");
          }}
        >
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
        <div className="panel-tabs">
          <SlidersHorizontal size={14} />
          <span className="tab-current">Properties</span>
          <span className="panel-caption">
            {selected.length > 1
              ? `${selected.length} objects`
              : (shape?.type ?? "Page")}
          </span>
        </div>
        {shape && bounds ? (
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
              <div className="section-title">Navigation</div>
              <dl className="shortcuts">
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
      </div>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {feedbackTarget && (
        <div className="modal-backdrop" onClick={() => setFeedbackTarget(null)}>
          <section
            className="agent-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Add feedback"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-heading">
              <MessageSquarePlus size={18} />
              <h2>Feedback on this object</h2>
              <IconButton
                label="Close feedback"
                onClick={() => setFeedbackTarget(null)}
              >
                <X size={17} />
              </IconButton>
            </div>
            <textarea
              autoFocus
              className="feedback-input"
              aria-label="Feedback"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.currentTarget.value)}
              placeholder="I like this direction. Try…"
            />
            <button
              className="wide-button"
              disabled={!feedbackText.trim()}
              onClick={() => {
                annotateObject(editor, {
                  targetId: feedbackTarget,
                  text: feedbackText,
                  author: "Human",
                });
                setFeedbackTarget(null);
                setFeedbackText("");
              }}
            >
              Add to canvas
            </button>
          </section>
        </div>
      )}
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
              <h2>One canvas. Shared objects.</h2>
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
            <pre>
              {JSON.stringify(
                {
                  mcpServers: {
                    paired: {
                      command: "node",
                      args: [
                        "/Users/yingcong/Code/pairedcc/packages/canvas/node_modules/tsx/dist/cli.mjs",
                        "/Users/yingcong/Code/pairedcc/packages/canvas/tools/mcp.ts",
                      ],
                      env: {
                        PAIRED_SESSION:
                          sessionStorage.getItem("picabird-agent-session") ??
                          "",
                      },
                    },
                  },
                },
                null,
                2,
              )}
            </pre>
            <button
              className="wide-button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(
                    JSON.stringify(
                      {
                        mcpServers: {
                          paired: {
                            command: "node",
                            args: [
                              "/Users/yingcong/Code/pairedcc/packages/canvas/node_modules/tsx/dist/cli.mjs",
                              "/Users/yingcong/Code/pairedcc/packages/canvas/tools/mcp.ts",
                            ],
                            env: {
                              PAIRED_SESSION:
                                sessionStorage.getItem(
                                  "picabird-agent-session",
                                ) ?? "",
                            },
                          },
                        },
                      },
                      null,
                      2,
                    ),
                  )
                  .then(() => setNotice("MCP configuration copied"))
                  .catch(() =>
                    setNotice("Select and copy the configuration above"),
                  );
              }}
            >
              Copy MCP configuration
            </button>
            <p className="inspector-help">
              HTTP: POST http://localhost:5183/api/canvas/command. Keep this tab
              open. Access is local to this computer.
            </p>
            <p className="inspector-help">
              Updates check the current revision. Human and agent edits share
              the same selection, history and saved document.
            </p>
            </> : <p>
              This canvas saves work in this browser. Export a file to back it up or move it to another device.
              External agent access is currently available in the local development version; hosted agent connections are not enabled yet.
            </p>}
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
function App() {
  const [ready, setReady] = useState(false);
  const [agentEditor, setAgentEditor] = useState<Editor | null>(null);
  useEffect(() => {
    if (agentEditor) return connectAgentAccess(agentEditor);
  }, [agentEditor]);
  const components: TLComponents = { InFrontOfTheCanvas: Shell };
  function mount(editor: Editor) {
    editor.user.updateUserPreferences({
      colorScheme: "light",
      isSnapMode: true,
      isDynamicSizeMode: false,
    });
    editor.setStyleForNextShapes(DefaultDashStyle, "solid");
    editor.setStyleForNextShapes(DefaultFontStyle, "sans");
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
    window.paired = createBridge(editor);
    setAgentEditor(editor);
    if (
      editor.getCurrentPageShapes().length === 0 &&
      editor.getPages().length === 1 &&
      !editor.getCurrentPage().meta.seeded
    ) {
      seed(editor);
      editor.updatePage({
        id: editor.getCurrentPageId(),
        meta: { ...editor.getCurrentPage().meta, seeded: true },
      });
    }
    setReady(true);
    return () => {
      delete window.paired;
    };
  }
  return (
    <main className="app">
      <div className="canvas-stage">
        <Tldraw
          licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY}
          persistenceKey="picabird-canvas-v1"
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
