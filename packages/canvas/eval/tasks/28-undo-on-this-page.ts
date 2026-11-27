import { task } from "../task-kit";
// 105 (c) (#139): canvas_runs can list only the runs on the open page. The newest run overall is
// on another page, so undoing "the latest run" without looking at pages takes back the wrong one.
const NOTE = "Draft: closed on Mondays";
export default task({
  id: "28-undo-on-this-page",
  prompt: `Your last change on the page the person has open added the note "${NOTE}" there by mistake. Take back just that change. Leave other pages as they are, and leave the person on the page they have open.`,
  async setup({ call, person, refs }) {
    refs.page = await person("(p, e) => e.getCurrentPageId()");
    refs.keep = await call("canvas_create", { kind: "note", x: 0, y: 0, text: "Opening hours: 8am to 4pm" });
    refs.mistake = await call("canvas_create", { kind: "note", x: 0, y: 200, text: NOTE });
    await call("canvas_page", { name: "Task 28 rota" });
    refs.otherPage = await person("(p, e) => e.getCurrentPageId()");
    refs.other = await call("canvas_create", { kind: "note", x: 0, y: 0, text: NOTE });
    await person("(p, e, id) => { e.setCurrentPage(id); }", refs.page);
  },
  async check({ read, refs, person }) {
    if (read.page?.id !== refs.page) return `the open page is ${read.page?.name}, not the person's page`;
    if (read.objects.some((o: any) => o.id === refs.mistake.id)) return "the mistaken note is still on the open page";
    if (!read.objects.some((o: any) => o.id === refs.keep.id)) return "the opening hours note on the open page was removed";
    const other = await person<any>("(p, e, id) => { const s = e.getShape(id); return s ? { page: e.getAncestorPageId(s.id) } : null; }", refs.other.id);
    if (!other) return "the note on the other page was removed";
    return other.page === refs.otherPage ? true : "the note on the other page moved";
  },
  async solution({ call, refs }) {
    const { runs } = await call("canvas_runs", { page: "current" });
    const run = runs.find((r: any) => r.created.includes(refs.mistake.id));
    await call("canvas_undo_run", { runId: run.runId });
  },
});
