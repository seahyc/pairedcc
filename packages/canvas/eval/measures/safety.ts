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
  const race = async (name: string, fn: (lost: (n: number) => void) => Promise<true | string>) => {
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
      if (!(await agent.tools()).includes("canvas_learn")) return true; // prototype tools switched off
      const humanId = await human("(p) => p.create({ kind: 'note', x: 1200, y: 400, text: 'My own working' })");
      let rejected = false;
      try {
        await agent.call("canvas_learn", { mode: "predict", question: "What will this show?", x: 1200, y: 700, hideIds: [humanId] });
      } catch {
        rejected = true;
      }
      const hidden = await page.evaluate((id: string) => {
        const e = (window as any).__pairedEditor;
        const s = e.getShape(id);
        return !s || e.isShapeHidden(s);
      }, humanId);
      if (hidden) lost(1);
      if (!rejected) return "canvas_learn accepted a person's object in hideIds";
      return hidden ? "the person's object is hidden" : true;
    });
  } finally {
    await agent.close();
    await context.close();
  }
  return { races, humanEditsLost: races.reduce((n, r) => n + r.humanEditsLost, 0) };
}
