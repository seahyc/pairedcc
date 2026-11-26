import { useEffect, useRef, useState } from "react";
import { useEditor, useValue, type TLShapeId } from "tldraw";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { ImportError, detectPaste, formatOfFile, type ImportAs, type ImportFormat } from "./import-parse";
import { importContent, importFingerprint, importImages, removeImport, showBox, type ImportResult } from "./import-board";
import { sourceOf } from "./import-meta";
import { readXlsx, rowsToTsv } from "./xlsx";
import { importCsvFiles, isCsvFile } from "./data/csv";
import { dataPrototypeEnabled } from "./data/shapes";

// Paste, drop and "Import a file" all end in the same importer. Afterwards a small summary
// offers the other view and undo, and a stepper walks through the records one at a time.

let openPicker: (() => void) | null = null;
/** Open the file chooser (from the menu). */
export const chooseImportFile = () => openPicker?.();

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest("input,textarea,select,[contenteditable=true],[contenteditable='']"));

type Last = { result: ImportResult; source: { content: string; format: ImportFormat; from: string } | null; as: "cards" | "table" | null; fingerprint: string };

export function ImportLayer({ onNotice }: { onNotice: (text: string) => void }) {
  const editor = useEditor();
  const [last, setLast] = useState<Last | null>(null);
  const [at, setAt] = useState<number | null>(null);
  /** The import being stepped through: the one last brought in or last stepped in. */
  const [active, setActive] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const steps = useValue(
    "import steps",
    () => {
      let shapes = editor
        .getCurrentPageShapes()
        .flatMap((shape) => {
          const source = sourceOf(shape);
          return source && (source.kind === "record" || source.kind === "section") && source.order !== undefined ? [{ shape, source }] : [];
        })
        .sort((a, b) => a.source.at.localeCompare(b.source.at) || a.source.importId.localeCompare(b.source.importId) || a.source.order! - b.source.order!);
      const all = shapes;
      const selected = editor.getSelectedShapes().map((s) => (sourceOf(s)?.kind === "field" || sourceOf(s)?.kind === "title" ? s.parentId : s.id) as string);
      // One import at a time: the one the selection is in, else the one last used, else the newest.
      const chosen =
        (selected.length === 1 ? all.find(({ shape }) => shape.id === selected[0])?.source.importId : undefined) ??
        (all.some(({ source }) => source.importId === active) ? active : all[all.length - 1]?.source.importId);
      shapes = all.filter(({ source }) => source.importId === chosen);
      const judged = shapes.filter(({ shape }) => {
        const marked = (id: TLShapeId) => Boolean(editor.getShape(id)?.meta.mark);
        return marked(shape.id) || editor.getSortedChildIdsForParent(shape.id).some(marked);
      }).length;
      return {
        ids: shapes.map(({ shape }) => shape.id).join(","),
        selected: selected.length === 1 ? shapes.findIndex(({ shape }) => shape.id === selected[0]) : -1,
        judged,
        records: shapes.some(({ source }) => source.kind === "record"),
        importId: chosen ?? null,
      };
    },
    [editor, active],
  );
  const ids = steps.ids ? (steps.ids.split(",") as TLShapeId[]) : [];
  const current = steps.selected >= 0 ? steps.selected : at !== null && at < ids.length ? at : null;

  function go(index: number) {
    if (!ids.length) return;
    const next = Math.max(0, Math.min(ids.length - 1, index));
    const box = editor.getShapePageBounds(ids[next]);
    if (!box) return;
    setAt(next);
    setActive(steps.importId);
    editor.setCurrentTool("select");
    editor.select(ids[next]);
    showBox(editor, box);
    editor.focus();
  }
  const step = (by: 1 | -1) => go(current === null ? (by === 1 ? 0 : ids.length - 1) : current + by);
  const stepRef = useRef(step);
  stepRef.current = step;

  function done(result: ImportResult, source: Last["source"], as: Last["as"]) {
    showBox(editor, result.focus);
    setLast({ result, source, as, fingerprint: importFingerprint(editor, result.importId) });
    setAt(null);
    setActive(result.importId);
    editor.focus();
  }
  function fail(error: unknown) {
    onNotice(error instanceof ImportError ? error.message : error instanceof Error && error.message ? error.message : "Could not import that");
  }
  function run(source: { content: string; format: ImportFormat; from: string }, as: ImportAs = "auto") {
    try {
      const { plan, result } = importContent(editor, { ...source, as });
      done(result, plan.kind === "prose" ? null : source, plan.kind === "records" ? "cards" : plan.kind === "table" ? "table" : null);
    } catch (error) {
      fail(error);
    }
  }
  async function importFiles(files: File[], point?: { x: number; y: number }) {
    const images: File[] = [];
    for (const file of files) {
      const format = formatOfFile(file.name) ?? (file.type.startsWith("image/") ? "image" : file.type.startsWith("text/") ? "text" : null);
      if (format === "image") images.push(file);
      else if (format === "xlsx" && !/\.xlsx$/i.test(file.name)) onNotice(`${file.name} is not read yet: only .xlsx workbooks are. Save it as .xlsx or CSV, or copy the cells and paste them here.`);
      else if (format === "xlsx" && file.size > 10_000_000) onNotice(`${file.name} is too large to lay out as cards (10 MB at most).`);
      else if (format === "xlsx") {
        try {
          // The first sheet goes through the same importer as a pasted spreadsheet range.
          const book = await readXlsx(new Uint8Array(await file.arrayBuffer()));
          if (!book.rows.some((r) => r.some((c) => c.trim()))) throw new ImportError(`The first sheet of ${file.name}, “${book.sheet}”, is empty.`);
          run({ content: rowsToTsv(book.rows), format: "tsv", from: file.name });
          if (book.sheets > 1) onNotice(`Read the first sheet of ${file.name}, “${book.sheet}”. Other sheets are not read yet.`);
        } catch (error) {
          fail(error);
        }
      }
      else if (!format) onNotice(`Cannot read ${file.name} yet. Try CSV, TSV, Markdown, text, JSON or an image.`);
      else if (file.size > 2_000_000) onNotice(`${file.name} is too large to lay out as cards (2 MB at most).`);
      else run({ content: await file.text(), format, from: file.name });
    }
    if (images.length) {
      try {
        done(await importImages(editor, images, point), null, null);
      } catch (error) {
        fail(error);
      }
    }
  }
  const filesRef = useRef(importFiles);
  filesRef.current = importFiles;
  const onNoticeRef = useRef(onNotice);
  onNoticeRef.current = onNotice;
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    openPicker = () => picker.current?.click();
    function paste(event: ClipboardEvent) {
      // Pasting into a card being written, or into any field, is not an import.
      if (typing(event.target) || editor.getEditingShapeId()) return;
      const data = event.clipboardData;
      if (!data) return;
      const found = detectPaste({ html: data.getData("text/html"), text: data.getData("text/plain") });
      if (!found) return; // ordinary text and pictures keep the canvas's own paste
      event.preventDefault();
      event.stopImmediatePropagation();
      runRef.current({ ...found, from: "pasted" });
    }
    const hasFiles = (event: DragEvent) => Boolean(event.dataTransfer && Array.from(event.dataTransfer.types).includes("Files"));
    function dragOver(event: DragEvent) {
      if (hasFiles(event)) event.preventDefault();
    }
    function drop(event: DragEvent) {
      let files = Array.from(event.dataTransfer?.files ?? []);
      if (!files.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = editor.screenToPage({ x: event.clientX, y: event.clientY });
      // PROTOTYPE (?prototype=data): a dropped CSV becomes a typed dataset object, as before
      // import and paste existed; other files still go to the importer.
      if (dataPrototypeEnabled()) {
        const csvs = files.filter(isCsvFile);
        if (csvs.length) void importCsvFiles(editor, csvs, point).then(onNoticeRef.current);
        files = files.filter((f) => !isCsvFile(f));
        if (!files.length) return;
      }
      void filesRef.current(files, point);
    }
    function keydown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || typing(event.target) || editor.getEditingShapeId()) return;
      const next = event.key === "j" || event.key === "]", previous = event.key === "k" || event.key === "[";
      if (!next && !previous) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      stepRef.current(next ? 1 : -1);
    }
    // What the person adds while inside a record (a comment, a pasted note) sits beside the
    // record on the board; it does not become part of the source material.
    const keepOut = editor.sideEffects.registerAfterCreateHandler("shape", (shape) => {
      const parent = editor.getShape(shape.parentId);
      if (!parent || parent.type !== "group" || sourceOf(parent)?.kind !== "record" || sourceOf(shape)) return;
      editor.reparentShapes([shape.id], parent.parentId);
    });
    window.addEventListener("paste", paste, { capture: true });
    window.addEventListener("dragover", dragOver, { capture: true });
    window.addEventListener("drop", drop, { capture: true });
    window.addEventListener("keydown", keydown, { capture: true });
    return () => {
      keepOut();
      openPicker = null;
      window.removeEventListener("paste", paste, { capture: true });
      window.removeEventListener("dragover", dragOver, { capture: true });
      window.removeEventListener("drop", drop, { capture: true });
      window.removeEventListener("keydown", keydown, { capture: true });
    };
  }, [editor]);

  // The summary steps aside after a while; the import stays.
  useEffect(() => {
    if (!last) return;
    const timer = setTimeout(() => setLast(null), 20_000);
    return () => clearTimeout(timer);
  }, [last]);

  function showAs(as: "cards" | "table") {
    if (!last?.source) return;
    // Rebuilding would throw away what the person did to the import since it came in.
    if (importFingerprint(editor, last.result.importId) !== last.fingerprint) {
      onNotice("This import has changed since it came in (edited, moved, judged or commented on), so it is not rebuilt. Import it again to see it the other way.");
      return;
    }
    // Swapping the view replaces the import in place of adding a second copy, as one undo step.
    const mark = editor.markHistoryStoppingPoint("show import another way");
    removeImport(editor, last.result.importId);
    run(last.source, as);
    editor.squashToMark(mark);
  }

  return (
    <>
      <input
        ref={picker}
        type="file"
        accept=".csv,.tsv,.tab,.md,.markdown,.txt,.json,.html,.htm,.xlsx,image/*"
        multiple
        hidden
        aria-label="Import a file"
        onChange={(e) => {
          void importFiles(Array.from(e.currentTarget.files ?? []));
          e.currentTarget.value = "";
        }}
      />
      {last && (
        <div className="import-summary" role="status">
          <span>{last.result.summary}.</span>
          {last.source && last.as && (
            <button onClick={() => showAs(last.as === "cards" ? "table" : "cards")}>{last.as === "cards" ? "Show as table instead" : "Show as cards instead"}</button>
          )}
          <button
            onClick={() => {
              removeImport(editor, last.result.importId);
              setLast(null);
              editor.focus();
            }}
          >
            Undo
          </button>
          <button className="import-dismiss" aria-label="Dismiss" onClick={() => setLast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {ids.length > 1 && (
        <div className="import-stepper" role="group" aria-label="Step through imported records">
          <button aria-label="Previous (K)" title="Previous (K or [)" disabled={current === 0} onClick={() => step(-1)}>
            <ChevronLeft size={16} />
          </button>
          <span className="import-count" aria-live="polite">
            {current === null ? `${ids.length} ${steps.records ? "records" : "sections"}` : `${current + 1} of ${ids.length}`}
          </span>
          <button aria-label="Next (J)" title="Next (J or ])" disabled={current === ids.length - 1} onClick={() => step(1)}>
            <ChevronRight size={16} />
          </button>
          <span className="import-keys">
            <kbd>K</kbd> <kbd>J</kbd>
          </span>
          {steps.records && steps.judged > 0 && <span className="import-judged">{steps.judged} judged</span>}
        </div>
      )}
    </>
  );
}
