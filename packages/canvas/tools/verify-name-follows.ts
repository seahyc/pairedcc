// Live check for item 105 (a): a layer name made from an object's text follows the text when an
// agent changes it over MCP, so read and overview no longer show the old words; a name someone
// chose is kept. Starts its own dev server (port 5197) unless PAIRED_URL is set:
//   node --import tsx tools/verify-name-follows.ts
import { launch, mcpAgent, openCanvas, startServer } from "../eval/lib";

const server = process.env.PAIRED_URL ? undefined : await startServer(5197, true);
const base = process.env.PAIRED_URL ?? server!.base;
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail: unknown = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : "  — " + JSON.stringify(detail)}`); };
const browser = await launch();
try {
  const { context, session } = await openCanvas(browser, base);
  const agent = await mcpAgent(base, session);
  await agent.call("canvas_page", { name: "Name follows text" });
  const box = await agent.call("canvas_create", { kind: "rectangle", x: 0, y: 0, width: 200, height: 120, text: "Draft" });
  const got = await agent.call("canvas_get", { id: box.id });
  await agent.call("canvas_update", { id: box.id, expectedRevision: got.revision, text: "Final" });
  const read = (await agent.call("canvas_read")).objects.find((o: any) => o.id === box.id);
  check("read shows the new name after the text changes", read?.name === "Final" && read?.text === "Final", { name: read?.name, text: read?.text });
  const overview = await agent.call("canvas_overview");
  const listed = JSON.stringify(overview);
  check("overview no longer shows the old name", listed.includes("Final") && !/"Draft"/.test(listed));
  const named = await agent.call("canvas_create", { kind: "rectangle", x: 300, y: 0, width: 200, height: 120, text: "Draft", name: "Budget box" });
  const got2 = await agent.call("canvas_get", { id: named.id });
  await agent.call("canvas_update", { id: named.id, expectedRevision: got2.revision, text: "Final" });
  const read2 = (await agent.call("canvas_read")).objects.find((o: any) => o.id === named.id);
  check("a name someone chose is kept", read2?.name === "Budget box", read2?.name);
  await agent.close();
  await context.close();
} finally {
  await browser.close();
  server?.stop();
}
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
