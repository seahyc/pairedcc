// Headless check of the converge prototype. Start the dev server (pnpm dev:canvas), then:
//   node --import tsx tools/verify-converge.ts
// Writes converge-agent.png and converge-person.png to the current directory.
import { launch, mcpAgent, openCanvas, sleep } from "../eval/lib";

const base = process.env.PAIRED_URL ?? "http://localhost:5183";
const browser = await launch();
try {
  // A tab without the flag refuses the operation and changes nothing.
  const off = await openCanvas(browser, base);
  const offAgent = await mcpAgent(base, off.session);
  const before = (await offAgent.call("canvas_read")).objects.length;
  const refusal = await offAgent.call("canvas_converge", { sourceIds: ["shape:a", "shape:b"], text: "x" }).then(() => "accepted", (e: Error) => e.message);
  console.log("without the flag:", refusal.includes("off in this tab") ? "refused" : refusal, "| objects unchanged:", (await offAgent.call("canvas_read")).objects.length === before);
  await offAgent.close();
  await off.context.close();

  const { page, session, context, errors } = await openCanvas(browser, base, "?prototype=converge");
  const agent = await mcpAgent(base, session);
  await agent.call("canvas_page", { name: "Converge check" });
  const defs = [];
  for (const [i, text] of ["Paying hirer = paid at least once in 12 months: 1,240", "Paying hirer = paid in 2 of the last 4 quarters: 610", "Paying hirer = has an active subscription today: 455"].entries())
    defs.push(await agent.call("canvas_create", { kind: "note", x: 0, y: i * 180, text }));
  const syn = await agent.call("canvas_converge", {
    sourceIds: defs.map((d) => d.id),
    name: "Where the three definitions agree",
    text: "They agree on who pays; they split on how recently. The 12-month count is 2.7× the subscription count.",
    points: [
      { text: "Recency is the real choice, not payment", sourceIds: [defs[0].id, defs[2].id] },
      { text: "Quarterly activity sits between the two", sourceIds: [defs[1].id] },
    ],
  });
  console.log("synthesis:", syn.synthesis.type, "| labels:", JSON.stringify(Object.values(syn.labels)), "| arrows:", syn.connections.length);
  let read = await agent.call("canvas_read");
  const card = read.objects.find((o: any) => o.id === syn.synthesis.id);
  const arrows = read.objects.filter((o: any) => o.type === "arrow" && o.meta?.toId === syn.synthesis.id);
  console.log("card meta:", card.meta.role, card.meta.convergedFrom.length, "sources,", card.meta.points.length, "points | arrows from each source:", defs.every((d) => arrows.some((a: any) => a.meta.fromId === d.id)), "| placed right of the column of sources:", card.bounds.x > Math.max(...defs.map((d: any) => d.bounds.x + d.bounds.w)), "| arrow labels:", arrows.map((a: any) => a.text).sort().join(""));
  console.log("card text:\n  " + card.text.split("\n").join("\n  "));
  console.log("stale before any change:", Boolean(card.stale));
  await agent.call("canvas_focus", {});
  await sleep(600);
  await page.screenshot({ path: "converge-agent.png" });
  // The person edits a source; the synthesis shows as stale.
  await page.evaluate((id: string) => { const p = (window as any).paired; const o = p.read().objects.find((o: any) => o.id === id); p.update({ id, expectedRevision: o.revision, text: "Paying hirer = has an active subscription today: 470 (recounted)" }); }, defs[2].id);
  read = await agent.call("canvas_read");
  console.log("stale after the person edits source C:", JSON.stringify(read.objects.find((o: any) => o.id === syn.synthesis.id).stale));
  // The person pulls two notes into their own synthesis from Properties.
  const h1 = await agent.call("canvas_create", { kind: "note", x: 0, y: 700, text: "Option: weekly digest" });
  const h2 = await agent.call("canvas_create", { kind: "note", x: 300, y: 700, text: "Option: daily alert" });
  await page.evaluate((ids: string[]) => (window as any).paired.select(ids), [h1.id, h2.id]);
  await sleep(300);
  await page.getByRole("button", { name: "Pull into a synthesis" }).click();
  await sleep(300);
  await page.keyboard.type("Digest by default, alerts only for spikes");
  await page.keyboard.press("Escape");
  await sleep(300);
  read = await agent.call("canvas_read");
  const mine = read.objects.find((o: any) => o.meta?.role === "synthesis" && o.id !== syn.synthesis.id);
  console.log("person's synthesis:", mine ? `${mine.author} card, sources ${mine.meta.convergedFrom.length}, below the row: ${mine.bounds.y > 700}, text starts ${JSON.stringify(mine.text.split("\n")[0])}` : "missing");
  await agent.call("canvas_focus", { ids: [h1.id, h2.id, mine?.id].filter(Boolean) });
  await sleep(600);
  await page.screenshot({ path: "converge-person.png" });
  console.log("page errors:", errors);
  await agent.close();
  await context.close();
} finally {
  await browser.close();
}
