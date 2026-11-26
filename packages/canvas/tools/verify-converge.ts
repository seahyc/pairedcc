// Headless check of the converge prototype. Start the dev server (pnpm dev:canvas), then:
//   node --import tsx tools/verify-converge.ts
// Writes converge-agent.png and converge-person.png to the current directory. Prints PASS or
// FAIL for each step and exits non-zero if any fails.
import { launch, mcpAgent, openCanvas, sleep } from "../eval/lib";

const base = process.env.PAIRED_URL ?? "http://localhost:5183";
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail: unknown = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : "  — " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`); };
const browser = await launch();
try {
  // A tab without the flag refuses the operation and changes nothing.
  const off = await openCanvas(browser, base);
  const offAgent = await mcpAgent(base, off.session);
  const before = (await offAgent.call("canvas_read")).objects.length;
  const refusal = await offAgent.call("canvas_converge", { sourceIds: ["shape:a", "shape:b"], text: "x" }).then(() => "accepted", (e: Error) => e.message);
  const unchanged = (await offAgent.call("canvas_read")).objects.length === before;
  check("a tab without the flag refuses converge and changes nothing", refusal.includes("off in this tab") && unchanged, refusal);
  await offAgent.close();
  await off.context.close();

  const { page, session, context, errors } = await openCanvas(browser, base, "?prototype=converge");
  const agent = await mcpAgent(base, session);
  await agent.call("canvas_page", { name: "Converge check" });
  const defs: any[] = [];
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
  check("converge makes one card, sources lettered A to C, an arrow from each", syn.synthesis.type === "card" && JSON.stringify(Object.values(syn.labels)) === '["A","B","C"]' && syn.connections.length === 3, { type: syn.synthesis.type, labels: Object.values(syn.labels), arrows: syn.connections.length });
  let read = await agent.call("canvas_read");
  const card = read.objects.find((o: any) => o.id === syn.synthesis.id);
  const arrows = read.objects.filter((o: any) => o.type === "arrow" && o.meta?.toId === syn.synthesis.id);
  check("the card records its role, three sources and two points", card.meta.role === "synthesis" && card.meta.convergedFrom.length === 3 && card.meta.points.length === 2, { role: card.meta.role, sources: card.meta.convergedFrom.length, points: card.meta.points.length });
  check("an arrow comes from each source, labelled A to C", defs.every((d) => arrows.some((a: any) => a.meta.fromId === d.id)) && arrows.map((a: any) => a.text).sort().join("") === "ABC");
  check("the card sits right of the column of sources", card.bounds.x > Math.max(...defs.map((d: any) => d.bounds.x + d.bounds.w)));
  check("each point cites its sources by letter", /\(A, C\)/.test(card.text) && /\(B\)/.test(card.text), card.text.split("\n").join(" / "));
  check("the card is not stale before any change", !card.stale);
  await agent.call("canvas_focus", {});
  await sleep(600);
  await page.screenshot({ path: "converge-agent.png" });
  // The person edits a source; the synthesis shows as stale.
  await page.evaluate((id: string) => { const p = (window as any).paired; const o = p.read().objects.find((o: any) => o.id === id); p.update({ id, expectedRevision: o.revision, text: "Paying hirer = has an active subscription today: 470 (recounted)" }); }, defs[2].id);
  read = await agent.call("canvas_read");
  const stale = read.objects.find((o: any) => o.id === syn.synthesis.id).stale;
  check("the card is stale once the person edits source C, naming it", Array.isArray(stale) && stale.some((s: any) => s.id === defs[2].id), stale);
  // The person pulls two notes into their own synthesis from Properties.
  const h1 = await agent.call("canvas_create", { kind: "note", x: 0, y: 700, text: "Option: weekly digest" });
  const h2 = await agent.call("canvas_create", { kind: "note", x: 300, y: 700, text: "Option: daily alert" });
  await page.evaluate((ids: string[]) => (window as any).paired.select(ids), [h1.id, h2.id]);
  await sleep(300);
  // On the calm canvas Properties is behind the menu.
  await page.locator(".menu-button").click();
  await page.locator(".menu button", { hasText: "Properties" }).click();
  await page.getByRole("button", { name: "Pull into a synthesis" }).click();
  await sleep(300);
  await page.keyboard.type("Digest by default, alerts only for spikes");
  await page.keyboard.press("Escape");
  await sleep(300);
  read = await agent.call("canvas_read");
  const mine = read.objects.find((o: any) => o.meta?.role === "synthesis" && o.id !== syn.synthesis.id);
  check("the person's own synthesis is their card, from both notes, below them, with their words", Boolean(mine) && mine.author === "Human" && mine.meta.convergedFrom.length === 2 && mine.bounds.y > 700 && mine.text.startsWith("Digest by default"), mine ? { author: mine.author, sources: mine.meta.convergedFrom.length, y: mine.bounds.y, text: mine.text.split("\n")[0] } : "missing");
  await agent.call("canvas_focus", { ids: [h1.id, h2.id, mine?.id].filter(Boolean) });
  await sleep(600);
  await page.screenshot({ path: "converge-person.png" });
  check("no page errors", errors.length === 0, errors.join(" | "));
  await agent.close();
  await context.close();
} finally {
  await browser.close();
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks pass`);
process.exit(failed ? 1 : 0);
