import { mcpAgent, openCanvas, objects, ready, type Browser } from "../lib";

// Save a board, then reopen it in a clean browser profile and compare it through the
// object interface. Also reports a same-profile reload, which only proves local storage.

const fixture = (o: any) => ({ id: o.id, type: o.type, x: o.x, y: o.y, props: o.props, meta: o.meta });
const sorted = (list: any[]) => list.map(fixture).sort((a, b) => (a.id < b.id ? -1 : 1));

export async function persistence(browser: Browser, base: string) {
  const first = await openCanvas(browser, base, "?prototype=data");
  const agent = await mcpAgent(base, first.session);
  let saved: any[] = [];
  let sameProfile = false, cleanProfile = false, detail = "";
  try {
    await agent.call("canvas_page", { name: "Persistence check" });
    const ds = await agent.call("canvas_dataset", { x: 0, y: 0, synthetic: "orders" });
    await agent.call("canvas_chart", { x: 520, y: 0, datasetId: ds.id, state: { x: "region", y: "orders", filter: { product: ["Tea"] } } });
    await agent.call("canvas_create", { kind: "note", x: 0, y: 600, text: "Persistence fixture note" });
    await agent.call("canvas_create", { kind: "rectangle", x: 400, y: 600, width: 200, height: 120, text: "Box" });
    const pageId = (await agent.call("canvas_read")).page.id;
    saved = sorted(objects(await agent.call("canvas_read")));
    await first.page.reload();
    await ready(first.page);
    const reread = await first.page.evaluate(() => (window as any).paired.read());
    sameProfile = reread.page.id === pageId && JSON.stringify(sorted(reread.objects)) === JSON.stringify(saved);
    // A clean profile: new context, no IndexedDB, same signed-out person.
    const second = await openCanvas(browser, base, "?prototype=data");
    try {
      const pages = await second.page.evaluate(() => (window as any).__pairedEditor?.getPages().map((p: any) => p.id) ?? []);
      if (!pages.includes(pageId)) detail = "the saved page does not exist in a clean profile (boards are stored only in this browser)";
      else {
        await second.page.evaluate((id: string) => (window as any).__pairedEditor.setCurrentPage(id), pageId);
        const read = await second.page.evaluate(() => (window as any).paired.read());
        cleanProfile = JSON.stringify(sorted(read.objects)) === JSON.stringify(saved);
        if (!cleanProfile) detail = `the page reopened with ${read.objects.length} of ${saved.length} objects or different content`;
      }
    } finally {
      await second.context.close();
    }
  } finally {
    await agent.close();
    await first.context.close();
  }
  return { objects: saved.length, sameProfileReload: sameProfile, cleanProfile, detail: cleanProfile ? "identical" : detail };
}
