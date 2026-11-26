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
  console.error("step: undo check");
  // Agent undo of the connect still works after the connector followed a moved end.
  const a1 = await agent.call("canvas_create", { kind: "note", x: 0, y: 400, text: "Left" });
  const b1 = await agent.call("canvas_create", { kind: "note", x: 500, y: 400, text: "Right" });
  const link = await agent.call("canvas_connect", { fromId: a1.id, toId: b1.id, label: "leads to" });
  const a1now = await agent.call("canvas_get", { id: a1.id });
  await page.evaluate(([id, rev]: [string, number]) => (window as any).paired.update({ id, expectedRevision: rev, x: 900, y: 400 }), [a1.id, a1now.revision]);
  const runs = await agent.call("canvas_runs", {});
  const run = (runs.runs ?? runs).find((r: any) => (r.created ?? []).includes(link.id));
  const undone = await agent.call("canvas_undo_run", { runId: run.runId }).then(() => "undone", (e: Error) => e.message);
  const after = await agent.call("canvas_read");
  console.log("undo the connect after the person moved an end:", undone, "| connector gone:", !after.objects.some((o: any) => o.id === link.id), "| move kept:", after.objects.find((o: any) => o.id === a1.id)?.x === 900);
  console.error("step: frame check");
  // Moving a frame re-routes connectors from the cards inside it.
  const scene = await agent.call("canvas_scene", {
    nodes: [
      { key: "f", shape: { kind: "frame", x: 0, y: 900, width: 360, height: 220, name: "Group" } },
      { key: "in", parentKey: "f", shape: { kind: "note", x: 40, y: 80, text: "Inside" } },
      { key: "out", shape: { kind: "note", x: 40, y: 1400, text: "Outside" } },
    ],
    connections: [{ fromKey: "in", toKey: "out", label: "" }],
  });
  void scene;
  const read1 = await agent.call("canvas_read");
  const frameId = read1.objects.find((o: any) => o.type === "frame" && o.name === "Group").id as string;
  const outId = read1.objects.find((o: any) => o.text === "Outside").id as string;
  const frame = await agent.call("canvas_get", { id: frameId });
  await page.evaluate(([id, rev]: [string, number]) => (window as any).paired.update({ id, expectedRevision: rev, x: 700, y: 1350 }), [frameId, frame.revision]);
  const read2 = await agent.call("canvas_read");
  const conn = read2.objects.find((o: any) => o.type === "arrow" && o.meta?.toId === outId);
  const ends = (read2.bindings ?? []).filter((x: any) => x.fromId === conn?.id || x.arrowId === conn?.id).map((x: any) => `${x.terminal ?? x.props?.terminal}:${JSON.stringify(x.normalizedAnchor ?? x.props?.normalizedAnchor)}`).sort().join(" ");
  console.log("after dragging the frame beside the outside note:", ends);
  console.log("page errors:", errors);
  await agent.close();
  await context.close();
} finally {
  await browser.close();
  server.stop();
}
process.exit(0);
