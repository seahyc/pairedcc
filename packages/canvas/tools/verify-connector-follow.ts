// Headless check that a connector re-picks facing sides when its note moves.
//   npx tsx tools/verify-connector-follow.ts [out-prefix]
// Starts its own dev server; writes <prefix>-before-move.png and <prefix>-after-move.png.
import { launch, mcpAgent, openCanvas, sleep, startServer } from "../eval/lib";

const prefix = process.argv[2] ?? "connector";
const server = await startServer(5196);
const browser = await launch();
try {
  const { page, session, context, errors } = await openCanvas(browser, server.base);
  const agent = await mcpAgent(server.base, session);
  await agent.call("canvas_page", { name: "Connector check" });
  const target = await agent.call("canvas_create", { kind: "note", x: 500, y: 0, text: "Usage fell 12% in March" });
  const note = await agent.call("canvas_annotate", { targetId: target.id, text: "Where does the 12% come from?" });
  const anchors = async () => {
    const read = await agent.call("canvas_read");
    const arrow = read.objects.find((o: any) => o.type === "arrow" && o.meta?.fromId === note.id);
    const b = (read.bindings ?? []).filter((x: any) => x.fromId === arrow.id || x.arrowId === arrow.id);
    return b.map((x: any) => `${x.terminal ?? x.props?.terminal}:${JSON.stringify(x.normalizedAnchor ?? x.props?.normalizedAnchor)}`).sort().join(" ") || JSON.stringify(read.bindings?.[0] ?? "no bindings in read");
  };
  await agent.call("canvas_focus", {});
  await sleep(500);
  console.log("comment below its target:", await anchors());
  await page.screenshot({ path: `${prefix}-before-move.png` });
  const current = await agent.call("canvas_get", { id: note.id });
  await agent.call("canvas_update", { id: note.id, expectedRevision: current.revision, x: 0, y: 0 });
  await agent.call("canvas_focus", {});
  await sleep(500);
  console.log("after moving it to the left:", await anchors());
  await page.screenshot({ path: `${prefix}-after-move.png` });
  console.log("page errors:", errors);
  await agent.close();
  await context.close();
} finally {
  await browser.close();
  server.stop();
}
process.exit(0);
