// Live check for item 105 (c): canvas_runs says which pages each run touched and can list only
// the open page's runs. Starts its own dev server (port 5197) unless PAIRED_URL is set:
//   node --import tsx tools/verify-runs-page.ts
import { launch, mcpAgent, openCanvas, startServer } from "../eval/lib";

const server = process.env.PAIRED_URL ? undefined : await startServer(5197, true);
const base = process.env.PAIRED_URL ?? server!.base;
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail: unknown = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : "  — " + JSON.stringify(detail)}`); };
const browser = await launch();
try {
  const { context, session } = await openCanvas(browser, base);
  const agent = await mcpAgent(base, session);
  const first = await agent.call("canvas_page", { name: "Runs A" });
  const onA = await agent.call("canvas_create", { kind: "note", x: 0, y: 0, text: "On page A" });
  const second = await agent.call("canvas_page", { name: "Runs B" });
  const onB = await agent.call("canvas_create", { kind: "note", x: 0, y: 0, text: "On page B" });
  const pageA = first?.page?.id ?? first?.id, pageB = second?.page?.id ?? second?.id;
  const all = (await agent.call("canvas_runs", {})).runs;
  const runA = all.find((r: any) => r.created.includes(onA.id)), runB = all.find((r: any) => r.created.includes(onB.id));
  check("each run says which page it touched", runA?.pages?.length === 1 && runB?.pages?.length === 1 && runA.pages[0] !== runB.pages[0], { a: runA?.pages, b: runB?.pages, pageA, pageB });
  const current = (await agent.call("canvas_runs", { page: "current" })).runs;
  check("page: current lists only the open page's runs", current.some((r: any) => r.runId === runB?.runId) && !current.some((r: any) => r.runId === runA?.runId), current.map((r: any) => [r.op, r.pages]));
  check("the default still lists every page", all.some((r: any) => r.runId === runA?.runId) && all.some((r: any) => r.runId === runB?.runId));
  await agent.close();
  await context.close();
} finally {
  await browser.close();
  server?.stop();
}
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
