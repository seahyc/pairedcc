// Browser check for item 129: a note the person makes by script is the card they would write.
// Scripts and eval tasks stand in for the person with `window.paired.create({ kind: 'note', … })`.
// That used to make a 200 px sticky note whatever `width` said, so two ideas set up 40 px apart
// sat 80 px apart, beyond the group gap, and the ask in #170's attempt gave the agent only one of
// them. The person's own Write tool makes a handwritten card at the width they drag; the bridge now
// does the same, keeping the opacity and rotation asked for and a name that follows its text.
// Starts its own dev server (port 5231) unless PAIRED_URL is set:
//   node --import tsx tools/verify-person-note.ts [screenshot dir]
import { launch, mcpAgent, openCanvas, startServer, until } from "../eval/lib";

const out = process.argv[2] ?? ".";
const server = process.env.PAIRED_URL ? undefined : await startServer(5231, true);
const base = process.env.PAIRED_URL ?? server!.base;
const results: boolean[] = [];
const check = (name: string, ok: boolean, detail: unknown = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail === "" ? "" : "  — " + JSON.stringify(detail)}`); };
const browser = await launch();
try {
  const { context, page, session, errors } = await openCanvas(browser, base);
  const agent = await mcpAgent(base, session, "Verifier");
  const ev = (fn: string, arg?: unknown) => page.evaluate(`(${fn})(window.paired, window.__pairedEditor, ${JSON.stringify(arg ?? null)})`);
  const idOf = (r: any) => (typeof r === "string" ? r : r.id);
  const shape = (id: string) => ev("(p, e, id) => { const s = e.getShape(id), b = e.getShapePageBounds(id); return { type: s.type, tone: s.props.tone, w: b.w, h: b.h, x: b.x, y: b.y, maxX: b.maxX, maxY: b.maxY }; }", id) as Promise<any>;
  await ev("(p, e) => void e.setCamera({ x: 0, y: -1200, z: 1 })");
  await ev("(p, e) => void e.selectNone()");

  // Task 29's board: two ideas side by side, 40 px apart, each asked for at 240 px.
  const make = (x: number, y: number, text: string) => ev("(p, e, a) => p.create({ kind: 'note', x: a.x, y: a.y, width: 240, text: a.text })", { x, y, text }).then(idOf);
  const idea1 = await make(0, 1400, "Charge per seat: £8 a month for each recruiter on the account");
  const idea2 = await make(280, 1400, "Charge per job post: £30 a post, capped at £300 a month");
  const [s1, s2] = [await shape(idea1), await shape(idea2)];
  check("a note the person makes is their handwritten card", s1.type === "card" && s1.tone === "human", s1);
  check("at the width asked for", Math.round(s1.w) === 240 && Math.round(s2.w) === 240, [s1.w, s2.w]);
  check("so ideas set up 40 px apart are 40 px apart", Math.round(s2.x - s1.maxX) === 40, Math.round(s2.x - s1.maxX));
  check("the card fits its words (no text outside it)", await ev("(p, e, id) => { const el = document.querySelector('[data-shape-id=\"' + id + '\"]'), r = el.getBoundingClientRect(); return [...el.querySelectorAll('p')].every((q) => q.getBoundingClientRect().bottom <= r.bottom + 1); }", idea1));
  const plain = idOf(await ev("(p) => p.create({ kind: 'note', x: 1400, y: 1400, text: 'Office move in March' })"));
  check("without a width it is as wide as the Write tool's card", Math.round((await shape(plain)).w) === 300, (await shape(plain)).w);
  check("it is not selected (the person did not pick it)", !(await ev("(p, e) => e.getSelectedShapeIds()")).includes(plain));

  // The question 40 px under the taller idea; sent with ⌘↵ as the task does.
  const top = Math.max(s1.maxY, s2.maxY);
  const ask = await make(0, top + 40, "Seat or job post: which should we test first?");
  await ev("(p, e, id) => void p.select([id])", ask);
  await page.keyboard.press("ControlOrMeta+Enter");
  const view: any = await until(async () => (await agent.call("canvas_asks", { state: "all" })).asks.find((a: any) => a.id === ask), "the ask");
  const given = [...(view.targets ?? []), ...(view.cluster ?? [])].map((m: any) => m.id);
  check("the ask gives both ideas, the one beside the question and the one it names", given.includes(idea1) && given.includes(idea2), { targets: view.targets?.map((t: any) => t.id), cluster: view.cluster?.map((m: any) => m.id), idea1, idea2 });
  check("and not the card far away", !given.includes(plain));

  // A scripted note keeps the opacity and rotation it was made with, as other primitives do.
  const faded = idOf(await ev("(p) => p.create({ kind: 'note', x: 2000, y: 1400, text: 'Faded and tilted', opacity: 0.5, rotation: 0.2 })"));
  const fs: any = await ev("(p, e, id) => { const s = e.getShape(id); return { type: s.type, opacity: s.opacity, rotation: s.rotation }; }", faded);
  check("a scripted note keeps its opacity and rotation", fs.type === "card" && fs.opacity === 0.5 && Math.abs(fs.rotation - 0.2) < 1e-9, fs);
  const refused = await ev("(p) => { try { p.create({ kind: 'note', x: 2000, y: 1800, text: 'Too opaque', opacity: 2 }); return false; } catch { return true; } }");
  check("an opacity outside 0 to 1 is refused, as for other primitives", refused === true);

  // An unnamed note with a long first line takes a name that follows its text.
  const long = idOf(await ev("(p) => p.create({ kind: 'note', x: 2400, y: 1400, text: 'Pricing proposal for the spring recruiting team: try £8 per seat' })"));
  await ev("(p, e, id) => void p.update({ id, expectedRevision: 0, text: 'Hiring plan moved to July' })", long);
  const named = await ev("(p, e, id) => e.getShape(id).meta.name", long);
  const found: any = await agent.call("canvas_read", { text: "Pricing proposal" });
  check("after its text is replaced, its name follows the text", named === "Hiring plan moved to July", named);
  check("and search no longer finds the removed words", !found.objects.some((o: any) => o.id === long), found.objects.map((o: any) => o.id));

  // An agent's note is unchanged: its typed card, selected.
  const mine: any = await agent.call("canvas_create", { kind: "note", x: 0, y: top + 400, text: "An agent's note" });
  const sm = await shape(mine.id);
  check("an agent's note is still its typed card", sm.type === "card" && sm.tone === "agent", sm);
  await ev("(p, e, ids) => { e.selectNone(); e.zoomToBounds(e.getShapesPageBounds(ids), { inset: 80, immediate: true }); }", [idea1, idea2, ask]);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/person-note.png` });
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
