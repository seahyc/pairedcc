import { check, find, mcpAgent, openCanvas, sleep, type Browser, type Check } from "../lib";

// Scripted races between a person and an agent on shared objects. Each race counts
// the human edits that did not survive; the target is zero.

export async function safety(browser: Browser, base: string) {
  const races: (Check & { humanEditsLost: number })[] = [];
  const { context, page, session } = await openCanvas(browser, base);
  const agent = await mcpAgent(base, session);
  const human = (fn: string, arg?: unknown) => page.evaluate(`(${fn})(window.paired, ${JSON.stringify(arg ?? null)})`);
  const get = (id: string) => agent.call("canvas_get", { id });
  const text = (o: any) => JSON.stringify(o?.props?.richText ?? o?.text ?? "");
  const race: Race = async (name, fn) => {
    let lost = 0;
    const list: Check[] = [];
    await check(list, name, () => fn((n) => (lost += n)));
    races.push({ ...list[0], humanEditsLost: lost });
  };
  try {
    await agent.call("canvas_page", { name: "Safety races" });

    await race("Stale agent write against a newer human edit", async (lost) => {
      const note = await agent.call("canvas_create", { kind: "note", x: 0, y: 0, text: "Agent draft" });
      const seen = await get(note.id);
      await human("(p, id) => { const o = p.read().objects.find(o => o.id === id); return p.update({ id, expectedRevision: o.revision, text: 'Human rewrite' }) }", note.id);
      const humanVersion = text(await get(note.id));
      let rejected = false;
      try {
        await agent.call("canvas_update", { id: note.id, expectedRevision: seen.revision, text: "Agent overwrite" });
      } catch {
        rejected = true;
      }
      const now = text(await get(note.id));
      if (now !== humanVersion) lost(1);
      if (!rejected) return "stale agent write was accepted";
      return now === humanVersion ? true : `human edit lost: ${now}`;
    });

    await race("Agent undo with interleaved human edits", async (lost) => {
      if (!(await agent.tools()).includes("canvas_undo_run")) return "no agent undo operation (canvas_undo_run) is available";
      const a = await agent.call("canvas_create", { kind: "rectangle", x: 400, y: 0, width: 200, height: 120, text: "Agent A" });
      const b = await agent.call("canvas_create", { kind: "rectangle", x: 800, y: 0, width: 200, height: 120, text: "Agent B" });
      const aSeen = await get(a.id);
      await agent.call("canvas_update", { id: a.id, expectedRevision: aSeen.revision, color: "green" });
      // Human edits interleave: move A (the run did not touch position) and retext B.
      await human("(p, id) => { const o = p.read().objects.find(o => o.id === id); return p.update({ id, expectedRevision: o.revision, x: o.x + 120 }) }", a.id);
      await human("(p, id) => { const o = p.read().objects.find(o => o.id === id); return p.update({ id, expectedRevision: o.revision, text: 'Human B' }) }", b.id);
      const humanA = (await get(a.id)).x, humanB = text(await get(b.id));
      const runs = await agent.call("canvas_runs", {});
      const run = (runs.runs ?? runs).find((r: any) => (r.updated ?? []).includes(a.id));
      if (!run) return "the colour change is not listed as a run";
      await agent.call("canvas_undo_run", { runId: run.runId });
      const aNow = await get(a.id), bNow = await get(b.id);
      if (aNow.x !== humanA) lost(1);
      if (text(bNow) !== humanB) lost(1);
      if (aNow.props?.color === "green") return "the undone run's change is still applied";
      return aNow.x === humanA && text(bNow) === humanB ? true : "a human edit was undone with the agent's run";
    });

    await race("Agent write to a locked object", async (lost) => {
      const note = await agent.call("canvas_create", { kind: "note", x: 1200, y: 0, text: "Locked by the person" });
      await human("(p, id) => p.select([id])", note.id);
      await page.keyboard.press("Shift+L");
      await sleep(200);
      const locked = await get(note.id);
      if (!locked.locked) return "Shift+L did not lock the object";
      const failures: string[] = [];
      for (const [tool, args] of [
        ["canvas_update", { id: note.id, expectedRevision: locked.revision, text: "Agent edit" }],
        ["canvas_remove", { id: note.id, expectedRevision: locked.revision }],
      ] as const)
        try {
          await agent.call(tool, args);
          failures.push(`${tool} was accepted`);
        } catch {
          /* rejected, as it should be */
        }
      const now = await get(note.id).catch(() => null);
      if (!now || text(now) !== text(locked)) lost(1);
      return failures.length ? failures.join("; ") : now && text(now) === text(locked) ? true : "locked object changed";
    });
  } finally {
    await agent.close();
    await context.close();
  }
  await dataRaces(browser, base, race);
  return { races, humanEditsLost: races.reduce((n, r) => n + r.humanEditsLost, 0) };
}

type Race = (name: string, fn: (lost: (n: number) => void) => Promise<true | string>) => Promise<void>;

// The same races on the data prototype's own writes (chart state and dataset cells),
// in a tab with the prototype turned on. The person acts through the page.
async function dataRaces(browser: Browser, base: string, race: Race) {
  const { context, page, session } = await openCanvas(browser, base, "?prototype=data");
  const agent = await mcpAgent(base, session);
  const get = (id: string) => agent.call("canvas_get", { id });
  const refused = async (tool: string, args: Record<string, unknown>) => {
    try {
      await agent.call(tool, args);
      return false;
    } catch {
      return true;
    }
  };
  // Synthetic readings, made up for this check.
  const rows = ["North", "South"].flatMap((site) => ["Jan", "Feb"].map((month, m) => ({ site, month, kwh: 100 + m * 10 + (site === "South" ? 5 : 0) })));
  const columns = [{ name: "site", type: "text" }, { name: "month", type: "text" }, { name: "kwh", type: "number" }];
  try {
    await agent.call("canvas_page", { name: "Data safety races" });
    const ds = await agent.call("canvas_dataset", { x: 0, y: 0, title: "Readings", source: "Synthetic, made up for the eval", columns, rows });
    const ch = await agent.call("canvas_chart", { x: 520, y: 0, datasetId: ds.id, state: { x: "site", y: "kwh" } });
    await page.evaluate(() => (window as any).paired.select([]));
    await agent.call("canvas_focus", {});
    await sleep(400);

    await race("Stale agent chart state against a newer human filter", async (lost) => {
      const seen = await get(ch.id);
      await page.locator(".chart").first().getByRole("button", { name: "Feb", exact: true }).click();
      await sleep(300);
      const human = (await get(ch.id)).widget?.state?.filter;
      if (JSON.stringify(human) !== JSON.stringify({ month: ["Feb"] })) return `the person's filter did not apply: ${JSON.stringify(human)}`;
      const rejected = await refused("canvas_chart_state", { id: ch.id, expectedRevision: seen.revision, state: { filter: {} } });
      const now = (await get(ch.id)).widget?.state?.filter;
      if (JSON.stringify(now) !== JSON.stringify(human)) lost(1);
      if (!rejected) return "stale chart state write was accepted";
      return JSON.stringify(now) === JSON.stringify(human) ? true : `human filter lost: ${JSON.stringify(now)}`;
    });

    await race("Stale agent cell edit against a newer human cell edit", async (lost) => {
      const seen = await get(ds.id);
      const cell = page.getByLabel("kwh, row 2"); // labels count rows from 1
      await cell.click();
      await cell.fill("777");
      await cell.press("Enter");
      await sleep(300);
      const human = (await get(ds.id)).dataset?.rows?.[1]?.kwh;
      if (human !== 777) return `the person's cell edit did not apply (row 1 kwh is ${human})`;
      const rejected = await refused("canvas_cell", { id: ds.id, expectedRevision: seen.revision, row: 1, column: "kwh", value: 1 });
      const now = (await get(ds.id)).dataset?.rows?.[1]?.kwh;
      if (now !== human) lost(1);
      if (!rejected) return "stale cell write was accepted";
      return now === human ? true : `human cell edit lost: ${now}`;
    });

    await race("Agent data write to a locked dataset or chart", async (lost) => {
      const failures: string[] = [];
      for (const id of [ds.id, ch.id]) {
        await page.evaluate((x: string) => (window as any).paired.select([x]), id);
        await page.keyboard.press("Shift+L");
        await sleep(200);
        const locked = await get(id);
        if (!locked.locked) return `Shift+L did not lock ${locked.type}`;
        const [tool, args] = locked.type === "dataset"
          ? ["canvas_cell", { id, expectedRevision: locked.revision, row: 0, column: "kwh", value: 1 }]
          : ["canvas_chart_state", { id, expectedRevision: locked.revision, state: { aggregate: "mean" } }];
        if (!(await refused(tool, args))) failures.push(`${tool} on a locked ${locked.type} was accepted`);
        const now = await get(id);
        const before = locked.type === "dataset" ? locked.dataset?.rows : locked.widget?.state;
        const after = now.type === "dataset" ? now.dataset?.rows : now.widget?.state;
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          lost(1);
          failures.push(`locked ${locked.type} changed`);
        }
      }
      return failures.length ? failures.join("; ") : true;
    });
  } finally {
    await agent.close();
    await context.close();
  }
}
