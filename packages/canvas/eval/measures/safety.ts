import { check, find, mcpAgent, openCanvas, ready, savedToAccount, sleep, startServer, type Browser, type Check } from "../lib";

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

    await race("Agent undo of a deletion after the person deleted its frame", async (lost) => {
      const scene = await agent.call("canvas_scene", {
        name: "Frame with a child",
        nodes: [
          { key: "frame", shape: { kind: "frame", x: 0, y: 400, width: 500, height: 300, name: "Frame" } },
          { key: "child", parentKey: "frame", shape: { kind: "note", x: 40, y: 80, text: "Child" } },
        ],
      });
      const ids = scene.keys ?? scene.objects ?? {};
      const frameId = ids.frame?.id ?? ids.frame, childId = ids.child?.id ?? ids.child;
      const child = await get(childId);
      await agent.call("canvas_remove", { id: childId, expectedRevision: child.revision });
      const runs = await agent.call("canvas_runs", {});
      const run = (runs.runs ?? runs).find((r: any) => (r.removed ?? []).includes(childId));
      if (!run) return "the removal is not listed as a run";
      // The person deletes the frame, then the agent tries to undo its removal of the child.
      await page.evaluate((id: string) => { (window as any).__pairedEditor.deleteShapes([id]) }, frameId);
      let rejected = false;
      try {
        await agent.call("canvas_undo_run", { runId: run.runId });
      } catch {
        rejected = true;
      }
      const orphans = await page.evaluate(() => {
        const e = (window as any).__pairedEditor;
        return [...e.getCurrentPageShapes()].filter((s: any) => !e.store.get(s.parentId)).map((s: any) => s.id);
      });
      const frameBack = await get(frameId).then(() => true, () => false);
      if (frameBack) lost(1);
      if (orphans.length) return `undo left ${orphans.length} object(s) whose parent is gone`;
      if (!rejected) return "undo was accepted although the child's frame was deleted";
      return frameBack ? "the person's deletion of the frame was reversed" : true;
    });

    await race("One agent cannot undo another agent's run", async () => {
      const other = await mcpAgent(base, session, "Other agent");
      try {
        const note = await other.call("canvas_create", { kind: "note", x: 700, y: 400, text: "Other agent's note" });
        const theirs = await other.call("canvas_runs", {});
        const run = (theirs.runs ?? theirs).find((r: any) => (r.created ?? []).includes(note.id));
        if (!run) return "the other agent's create is not listed as its run";
        const mine = await agent.call("canvas_runs", {});
        if ((mine.runs ?? mine).some((r: any) => r.runId === run.runId)) return "an agent can see another agent's runs";
        let rejected = false;
        try {
          await agent.call("canvas_undo_run", { runId: run.runId });
        } catch {
          rejected = true;
        }
        const still = await get(note.id).then(() => true, () => false);
        if (!rejected || !still) return "an agent undid another agent's run";
        return true;
      } finally {
        await other.close();
      }
    });

    await race("Agent cannot hide the person's work behind a learning prompt", async (lost) => {
      // Its own tab with the learning prototype on, so the race does not depend on flags.
      const tab = await openCanvas(browser, base, "?prototype=learning");
      const learner = await mcpAgent(base, tab.session);
      try {
        if (!(await learner.tools()).includes("canvas_learn")) return true; // prototype tools switched off
        await learner.call("canvas_page", { name: "Learning safety" });
        const humanId = await tab.page.evaluate(() => (window as any).paired.create({ kind: "note", x: 0, y: 0, text: "My own working" }));
        // Only a refusal on the person's behalf counts (not, say, a prototype flag being off).
        let rejected = false, reason = "";
        try {
          await learner.call("canvas_learn", { mode: "predict", question: "What will this show?", x: 0, y: 300, hideIds: [humanId] });
        } catch (error) {
          reason = String(error);
          rejected = /person made/.test(reason);
        }
        const hidden = await tab.page.evaluate((id: string) => {
          const e = (window as any).__pairedEditor;
          const s = e.getShape(id);
          return !s || e.isShapeHidden(s);
        }, humanId);
        if (hidden) lost(1);
        if (!rejected) return reason ? `canvas_learn refused for another reason: ${reason.slice(0, 160)}` : "canvas_learn accepted a person's object in hideIds";
        return hidden ? "the person's object is hidden" : true;
      } finally {
        await learner.close();
        await tab.context.close();
      }
    });
  } finally {
    await agent.close();
    await context.close();
  }
  await dataRaces(browser, base, race);
  // The restore race saves to the board store; on a reused EVAL_URL server that is someone's
  // real board, whose kept history it would prune. It always gets a throwaway server.
  const own = process.env.EVAL_URL ? await startServer(Number(process.env.EVAL_PORT ?? 5191) + 2, true) : null;
  try {
    await restoreRace(browser, own?.base ?? base, race);
  } finally {
    own?.stop();
  }
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

// Restoring an earlier version (Menu → Earlier versions) in a tab that has not seen another
// browser's newer save: the restore must be refused, and the newer edit must survive.
async function restoreRace(browser: Browser, base: string, race: Race) {
  const a = await openCanvas(browser, base);
  let b: Awaited<ReturnType<typeof openCanvas>> | undefined;
  const sync = (page: any, js: string) => page.evaluate(`(async (s) => ${js})(window.__pairedBoardSync)`);
  const server = async () => JSON.stringify((await (await fetch(`${base}/api/canvas/boards/main`)).json()).board?.snapshot ?? {});
  const shows = (page: any, text: string) => page.evaluate((t: string) => (window as any).__pairedEditor.getCurrentPageShapes().some((s: any) => JSON.stringify(s.props).includes(t)), text);
  try {
    await race("Restore an earlier version after another browser saved a newer edit", async (lost) => {
      if (!(await a.page.evaluate(() => Boolean((window as any).__pairedBoardSync)))) return "no board sync in this tab";
      if (!(await savedToAccount(a.page))) return "browser A never saved to the board store";
      await a.page.evaluate(() => (window as any).paired.create({ kind: "note", x: 4000, y: 0, text: "restore race: first version" }));
      await sleep(1500);
      await savedToAccount(a.page);
      const keep = await sync(a.page, "s.status().revision");
      await a.page.evaluate(() => (window as any).paired.create({ kind: "note", x: 4000, y: 300, text: "restore race: second version" }));
      await sleep(1500);
      await savedToAccount(a.page);
      // Browser B opens the board and saves a newer edit; A has not seen it.
      b = await openCanvas(browser, base);
      await savedToAccount(b.page);
      await b.page.evaluate(() => (window as any).paired.create({ kind: "note", x: 4000, y: 600, text: "restore race: newer edit in B" }));
      await sleep(1500);
      if (!(await savedToAccount(b.page))) return "browser B's edit was not saved";
      let refused = false;
      try {
        await sync(a.page, `s.restore(${keep})`);
      } catch {
        refused = true;
      }
      await sleep(500);
      const onServer = (await server()).includes("restore race: newer edit in B");
      await a.page.reload();
      await ready(a.page);
      await sleep(2500);
      const inA = await shows(a.page, "restore race: newer edit in B");
      if (!onServer || !inA) lost(1);
      if (!refused) return "the restore in the stale tab was accepted";
      if (!onServer) return "the newer edit is gone from the board store";
      return inA ? true : "the newer edit is missing from browser A after reload";
    });
  } finally {
    await b?.context.close();
    await a.context.close();
  }
}
