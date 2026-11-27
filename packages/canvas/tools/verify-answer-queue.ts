// Browser check for item 136 (a), friction from #181's focused attempt on task 23: an answer to an
// Ask that came through the feedback queue says whether the queue item is now closed, so the agent
// need not call canvas_feedback again to find out. The person comments on three options with C (the
// comment is an Ask); the agent answers: the result gives `queue: "resolved"`, and the queue agrees.
// A clarifying question hands the turn back: the result gives `queue: "open"`.
// Starts its own dev server (port 5199) unless PAIRED_URL is set:
//   node --import tsx tools/verify-answer-queue.ts
import { launch, mcpAgent, openCanvas, startServer } from "../eval/lib";

const server = process.env.PAIRED_URL ? undefined : await startServer(5199, true);
const base = process.env.PAIRED_URL ?? server!.base;
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail: unknown = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : "  — " + JSON.stringify(detail)}`); };
const browser = await launch();
try {
  const { context, page, session, errors } = await openCanvas(browser, base);
  const agent = await mcpAgent(base, session, "Verifier");
  const ev = (fn: string, arg?: unknown) => page.evaluate(`(${fn})(window.paired, window.__pairedEditor, ${JSON.stringify(arg ?? null)})`);
  /** The person selects the options, presses C and writes a comment; returns its id. */
  const comment = async (page_: string, text: string) => {
    await agent.call("canvas_page", { name: page_ });
    const a = await agent.call("canvas_create", { kind: "rectangle", x: 0, y: 0, text: "Option A: $120 a month" });
    const b = await agent.call("canvas_create", { kind: "rectangle", x: 320, y: 0, text: "Option B: $90 a month" });
    await ev("(p, e, ids) => { p.select(ids); }", [a.id, b.id]);
    await page.keyboard.press("c");
    await page.waitForTimeout(300);
    await page.keyboard.type(text);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const queue = await agent.call("canvas_feedback", { status: "open", allPages: false });
    return queue.items.find((i: any) => i.kind === "comment")?.id as string | undefined;
  };
  const statusOf = async (id: string) => (await agent.call("canvas_feedback", { status: "all" })).items.find((i: any) => i.id === id)?.status;

  const first = await comment("Answer queue", "Which one is cheapest?");
  check("the person's comment is in the queue", Boolean(first));
  const answered: any = await agent.call("canvas_answer", { id: first, text: "Option B, at $90 a month." });
  check("the answer says the queue item is now closed", answered.queue === "resolved", { queue: answered.queue });
  check("and the queue agrees", (await statusOf(first!)) === "resolved");

  const second = await comment("Answer queue, clarifying", "Which one should we pick?");
  const asked: any = await agent.call("canvas_answer", { id: second, text: "Do you mean cheapest, or best value for a team of five?", question: true });
  check("a clarifying question says the item stays open", asked.queue === "open", { queue: asked.queue });
  check("and the queue agrees", (await statusOf(second!)) === "open");
  check("no page errors", errors.length === 0, errors.slice(0, 3));
  await agent.close();
  await context.close();
} finally {
  await browser.close();
  server?.stop();
}
const passed = results.filter(Boolean).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
