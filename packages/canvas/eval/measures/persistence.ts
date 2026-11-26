import { mcpAgent, openCanvas, objects, ready, savedToAccount, sessionOf, type Browser } from "../lib";

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
    const savedThere = await savedToAccount(first.page);
    await first.page.reload();
    await ready(first.page);
    await sessionOf(first.page, base);
    const reread = await agent.call("canvas_read");
    sameProfile = reread.page.id === pageId && JSON.stringify(sorted(objects(reread))) === JSON.stringify(saved);
    await savedToAccount(first.page);
    // A clean profile: new context, no IndexedDB, same person.
    const second = await openCanvas(browser, base, "?prototype=data");
    try {
      // Opening the board in a new browser loads it from the account first.
      await savedToAccount(second.page);
      const pages = await second.page.evaluate(() => (window as any).__pairedEditor?.getPages().map((p: any) => p.id) ?? []);
      if (!pages.includes(pageId))
        detail = savedThere
          ? "the saved page does not exist in a clean profile, although the board reported it was saved"
          : "the saved page does not exist in a clean profile (the board never reported being saved beyond this browser)";
      else {
        await second.page.evaluate((id: string) => void (window as any).__pairedEditor.setCurrentPage(id), pageId);
        // Compare through the same object interface the board was saved with.
        const other = await mcpAgent(base, second.session);
        const read = await other.call("canvas_read").finally(() => other.close());
        cleanProfile = JSON.stringify(sorted(read.objects)) === JSON.stringify(saved);
        if (!cleanProfile) {
          const now = sorted(read.objects);
          const diffs = saved.flatMap((o: any) => {
            const n = now.find((x: any) => x.id === o.id);
            if (!n) return [`${o.type} missing`];
            const fields: string[] = [];
            for (const k of ["x", "y", "props", "meta"] as const)
              for (const f of k === "props" || k === "meta" ? Object.keys({ ...o[k], ...n[k] }) : [""])
                if (JSON.stringify(f ? o[k]?.[f] : o[k]) !== JSON.stringify(f ? n[k]?.[f] : n[k])) fields.push(f ? `${k}.${f}` : k);
            return fields.length ? [`${o.type} ${fields.join(", ")}`] : [];
          });
          detail = `${now.length} of ${saved.length} objects; differences: ${diffs.join("; ") || "order"}`;
        }
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
