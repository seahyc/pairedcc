// Live check for item 105 (e): tool results stay small. canvas_read gives each object's words
// once, as plain text, and canvas_runs lists at most 10 ids per list with the full count, while
// canvas_get and runs with a runId still give everything. Starts its own dev server (port 5198)
// unless PAIRED_URL is set:
//   node --import tsx tools/verify-small-results.ts
import { launch, mcpAgent, openCanvas, startServer } from "../eval/lib";

const server = process.env.PAIRED_URL ? undefined : await startServer(5198, true);
const base = process.env.PAIRED_URL ?? server!.base;
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail: unknown = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : "  — " + JSON.stringify(detail)}`); };
const browser = await launch();
try {
  const { context, session } = await openCanvas(browser, base);
  const agent = await mcpAgent(base, session);
  await agent.call("canvas_page", { name: "Small results" });
  const line = "Synthetic note: weekly feedback mostly concerns onboarding emails and the pricing page.";
  const nodes = Array.from({ length: 40 }, (_, i) => ({ key: `n${i}`, shape: { kind: "note", x: (i % 8) * 280, y: Math.floor(i / 8) * 200, text: `${i + 1}. ${line}\n${line}` } }));
  await agent.call("canvas_scene", { name: "Forty notes", nodes });
  const read = await agent.call("canvas_read", {});
  const notes = read.objects.filter((o: any) => o.text?.includes("Synthetic note"));
  const readBytes = JSON.stringify(read).length;
  check("read gives the words as text", notes.length === 40 && notes.every((o: any) => o.text.includes("pricing page")), { notes: notes.length });
  check("read's props leave rich text out", notes.every((o: any) => !("richText" in (o.props ?? {}))), { bytes: readBytes });
  const one = await agent.call("canvas_get", { id: notes[0].id });
  check("get still has the rich text", JSON.stringify(one.props?.richText ?? "").includes("Synthetic note"));
  const runs = (await agent.call("canvas_runs", {})).runs;
  const scene = runs.find((r: any) => r.op === "scene");
  const runsBytes = JSON.stringify(runs).length;
  check("runs lists at most 10 created ids, with the full count", scene?.created.length === 10 && scene?.createdCount === 40, { created: scene?.created.length, createdCount: scene?.createdCount, bytes: runsBytes });
  const full = (await agent.call("canvas_runs", { runId: scene.runId })).runs;
  check("runs with runId gives that run in full", full.length === 1 && full[0].created.length === 40 && notes.every((o: any) => full[0].created.includes(o.id)));
  const undone = await agent.call("canvas_undo_run", { runId: scene.runId });
  const after = await agent.call("canvas_read", {});
  check("the run still undoes as a whole", !after.objects.some((o: any) => o.text?.includes("Synthetic note")), { restored: undone.restored?.length, removedNow: undone.removedNow?.length });
  console.log(`sizes: read ${readBytes} bytes for 40 notes; runs listing ${runsBytes} bytes`);
  await agent.close();
  await context.close();
} finally {
  await browser.close();
  server?.stop();
}
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
