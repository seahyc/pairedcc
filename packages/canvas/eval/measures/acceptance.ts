import { check, find, mcpAgent, objects, openCanvas, ready, sleep, until, type Browser, type Check } from "../lib";

// The working spec's first end-to-end acceptance scenario, step by step. The person
// acts through the real page (clicks, keys, drops); the agent acts over a real stdio
// MCP client. Expected values are computed here from the fixture, not by the canvas.

const columns = [
  { name: "site", type: "text" },
  { name: "month", type: "text" },
  { name: "kwh", type: "number" },
] as const;
// Synthetic meter readings, made up for this check.
const rows = ["North", "South", "East"].flatMap((site, s) =>
  ["Jan", "Feb", "Mar", "Apr"].map((month, m) => ({ site, month, kwh: 100 + s * 40 + m * 7 + ((s * 5 + m * 3) % 11) })),
);
const csv = ["site,month,kwh", ...rows.map((r) => `${r.site},${r.month},${r.kwh}`)].join("\n");

function sums(filter: (r: (typeof rows)[number]) => boolean) {
  const out: Record<string, number> = {};
  for (const r of rows.filter(filter)) out[r.site] = (out[r.site] ?? 0) + r.kwh;
  return out;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Objects as the agent sees them, minus fields that are per-tab view state. */
function board(read: any): any[] {
  return objects(read)
    .map(({ id, type, revision, x, y, props, text, stale, widget, dataset, author, meta, parentId }: any) => ({
      id, type, revision, x, y, props, text, stale, author, meta, parentId,
      widget: widget && { state: widget.state, bars: widget.bars },
      dataset: dataset && { rowCount: dataset.rowCount, version: dataset.version },
    }))
    .sort((a: any, b: any) => (a.id < b.id ? -1 : 1));
}

export async function acceptance(browser: Browser, base: string) {
  const steps: Check[] = [];
  const { context, page, errors, session } = await openCanvas(browser, base, "?prototype=data");
  const agent = await mcpAgent(base, session);
  const editor = (fn: string, arg?: unknown) => page.evaluate(`(${fn})(window.__pairedEditor, ${JSON.stringify(arg ?? null)})`);
  const toScreen = (x: number, y: number) => editor("(e, p) => e.pageToScreen(p)", { x, y }) as Promise<{ x: number; y: number }>;
  let datasetId = "", chartId = "", noteId = "", humanId = "";
  try {
    await agent.call("canvas_page", { name: "Acceptance scenario" });

    await check(steps, "Person imports a dataset by dropping a CSV file", async () => {
      const before = objects(await agent.call("canvas_read")).length;
      await page.evaluate(async (text: string) => {
        const target = document.querySelector(".tl-canvas") ?? document.body;
        const data = new DataTransfer();
        data.items.add(new File([text], "meter-readings.csv", { type: "text/csv" }));
        const at = { clientX: 700, clientY: 450, bubbles: true, cancelable: true, dataTransfer: data };
        target.dispatchEvent(new DragEvent("dragenter", at));
        target.dispatchEvent(new DragEvent("dragover", at));
        target.dispatchEvent(new DragEvent("drop", at));
      }, csv);
      await sleep(1500);
      const after = objects(await agent.call("canvas_read"));
      const ds = after.find((o) => o.type === "dataset");
      if (!ds) return `no dataset object after the drop (${after.length - before} other objects added)`;
      return ds.dataset?.rowCount === rows.length ? true : `dataset has ${ds.dataset?.rowCount} rows, expected ${rows.length}`;
    });
    // Clear whatever the drop produced so the rest of the scenario starts from one dataset.
    for (const o of objects(await agent.call("canvas_read"))) await agent.call("canvas_remove", { id: o.id, expectedRevision: o.revision }).catch(() => undefined);

    await check(steps, "Agent imports a dataset over MCP", async () => {
      const ds = await agent.call("canvas_dataset", { x: 0, y: 0, title: "Meter readings", source: "Synthetic, made up for the eval", columns, rows });
      datasetId = ds.id;
      return ds.dataset.rowCount === rows.length ? true : `rowCount ${ds.dataset.rowCount}`;
    });

    await check(steps, "Person selects a subset of the board and the agent sees it", async () => {
      await agent.call("canvas_focus", {});
      await sleep(400);
      const head = page.locator(".data-object .data-head").first();
      await head.click();
      const read = await agent.call("canvas_read");
      return same(read.selection, [datasetId]) ? true : `selection is ${JSON.stringify(read.selection)}`;
    });

    await check(steps, "Agent charts the selection", async () => {
      const ds = find(await agent.call("canvas_read"), datasetId);
      const x = ds.x + (ds.bounds?.w ?? 420) + 60;
      const chart = await agent.call("canvas_chart", { x, y: ds.y, datasetId, state: { x: "site", y: "kwh" } });
      chartId = chart.id;
      const got = Object.fromEntries(chart.widget.bars.map((b: any) => [b.key, b.value]));
      return same(got, sums(() => true)) ? true : `bars ${JSON.stringify(got)}, expected ${JSON.stringify(sums(() => true))}`;
    });

    await check(steps, "Person filters the chart directly", async () => {
      await page.evaluate(() => (window as any).paired.select([]));
      await agent.call("canvas_focus", {});
      await sleep(400);
      const chart = page.locator(".chart").first();
      await chart.getByRole("button", { name: "Feb", exact: true }).click();
      await chart.getByRole("button", { name: /^North:/ }).click();
      await sleep(300);
      const shown = await chart.locator(".bar").evaluateAll((bs: Element[]) => bs.map((b) => b.getAttribute("aria-label")));
      const on = await chart.locator(".bar.on").evaluateAll((bs: Element[]) => bs.map((b) => b.getAttribute("aria-label")));
      const want = Object.entries(sums((r) => r.month === "Feb")).map(([k, v]) => `${k}: ${v}`);
      if (!same(shown, want)) return `bars shown ${JSON.stringify(shown)}, expected ${JSON.stringify(want)}`;
      return on.length === 1 && on[0]?.startsWith("North:") ? true : `selected bars ${JSON.stringify(on)}`;
    });

    await check(steps, "Agent reads that exact chart state", async () => {
      const read = await agent.call("canvas_read");
      const chart = find(read, chartId);
      const w = chart?.widget;
      if (!w) return "chart has no widget state in canvas_read";
      // Overview, then detail: the summary read leaves rows out; canvas_get has them.
      const ds = find(read, datasetId);
      if (ds?.dataset?.rows || ds?.props?.data || chart.props?.data || chart.props?.bars) return "canvas_read includes dataset rows or chart bars in a summary";
      if ((await agent.call("canvas_get", { id: datasetId })).dataset?.rows?.length !== rows.length) return "canvas_get does not return the dataset's rows";
      if (!same(w.state.filter, { month: ["Feb"] })) return `filter ${JSON.stringify(w.state.filter)}`;
      if (!same(w.state.selected, ["North"])) return `selected ${JSON.stringify(w.state.selected)}`;
      const sel = w.selected?.[0];
      const want = rows.filter((r) => r.month === "Feb" && r.site === "North");
      return sel && sel.value === sums((r) => r.month === "Feb").North && sel.rows?.length === want.length
        ? true
        : `selected bar ${JSON.stringify(sel)}`;
    });

    await check(steps, "Agent adds a result next to the chart", async () => {
      const chart = find(await agent.call("canvas_read"), chartId);
      const b = chart.bounds;
      const note = await agent.call("canvas_create", {
        kind: "note", x: b.x + b.w + 40, y: b.y, inputs: [chartId],
        text: `North used ${sums((r) => r.month === "Feb").North} kWh in February.`,
      });
      noteId = note.id;
      const got = await agent.call("canvas_get", { id: noteId });
      const nb = got.bounds;
      const gap = Math.max(nb.x - (b.x + b.w), b.x - (nb.x + nb.w), nb.y - (b.y + b.h), b.y - (nb.y + nb.h));
      if (!(got.meta?.inputs ?? []).some((i: any) => i.id === chartId)) return "result does not record the chart as its input";
      return gap >= 0 && gap <= 200 ? true : `result is ${Math.round(gap)} px from the chart (overlapping if negative)`;
    });

    await check(steps, "A manual annotation survives an agent revision", async () => {
      const chart = find(await agent.call("canvas_read"), chartId);
      const at = await toScreen(chart.bounds.x, chart.bounds.y + chart.bounds.h + 80);
      const text = "Check the February meter swap";
      const before = new Set(objects(await agent.call("canvas_read")).map((o) => o.id));
      await page.keyboard.press("Escape");
      await page.keyboard.press("n");
      await page.mouse.click(at.x, at.y);
      await sleep(300);
      // If placing the card did not start typing, the person double-clicks it.
      if (!(await editor("(e) => e.getEditingShapeId()"))) {
        await page.mouse.dblclick(at.x, at.y);
        await sleep(300);
      }
      await page.keyboard.type(text);
      await page.keyboard.press("Escape");
      await sleep(300);
      const human = objects(await agent.call("canvas_read")).find((o) => !before.has(o.id));
      if (!human) return `the Note tool did not create an object (clicked at ${Math.round(at.x)},${Math.round(at.y)})`;
      humanId = human.id;
      if (!(human.text ?? "").includes(text)) return `annotation text is ${JSON.stringify(human.text)}`;
      const revised = await agent.call("canvas_chart_state", { id: chartId, expectedRevision: chart.revision, state: { aggregate: "mean" } });
      const mine = find(await agent.call("canvas_read"), noteId);
      await agent.call("canvas_update", { id: noteId, expectedRevision: mine.revision, text: "Revised: mean kWh per month, North in February." });
      if (revised.widget?.state?.aggregate !== "mean") return "agent revision did not apply";
      // A partial state change keeps the person's filter and selection.
      if (!same(revised.widget.state.filter, { month: ["Feb"] }) || !same(revised.widget.state.selected, ["North"]))
        return `agent revision dropped the person's filter or selection: ${JSON.stringify(revised.widget.state)}`;
      const after = find(await agent.call("canvas_read"), humanId);
      if (!after) return "annotation is gone";
      return after.revision === human.revision && after.text === human.text ? true : `annotation changed: ${JSON.stringify(after.text)} r${after.revision}`;
    });

    await check(steps, "Changing an input marks its dependents stale", async () => {
      // A fresh result derived from the chart, current before the input changes.
      const chartNow = find(await agent.call("canvas_read"), chartId);
      const result = await agent.call("canvas_create", {
        kind: "note", x: chartNow.bounds.x + chartNow.bounds.w + 40, y: chartNow.bounds.y + 260, inputs: [chartId], text: "Mean kWh by site, February.",
      });
      if (find(await agent.call("canvas_read"), result.id)?.stale) return "a just-created result is already stale";
      await page.evaluate(() => (window as any).paired.select([]));
      await agent.call("canvas_focus", { ids: [datasetId] });
      await sleep(400);
      const cell = page.getByLabel("kwh, row 2");
      await cell.click();
      await cell.fill("999");
      await cell.press("Enter");
      await sleep(400);
      const read = await agent.call("canvas_read");
      const chart = find(read, chartId), note = find(read, result.id);
      if (!JSON.stringify(chart?.stale ?? []).includes(datasetId)) return `chart is not stale on its dataset (stale: ${JSON.stringify(chart?.stale)})`;
      if (!note?.stale) return "a result derived from the chart is not marked stale when the chart's dataset changes";
      return (await page.locator(".data-stale").count()) > 0 ? true : "no stale banner on the page";
    });

    await check(steps, "Reload restores everything", async () => {
      const before = await agent.call("canvas_read");
      await page.reload();
      await ready(page);
      await until(async () => (await fetch(`${base}/api/canvas/sessions`).then((r) => r.json())).sessions.some((s: any) => s.id === session), "reconnect");
      const after = await agent.call("canvas_read");
      if (after.page?.id !== before.page?.id) return `reopened on page ${after.page?.name}, not ${before.page?.name}`;
      const a = board(before), b = board(after);
      if (same(a, b)) return true;
      const diff = a
        .map((o: any) => {
          const n = b.find((x: any) => x.id === o.id);
          if (!n) return `${o.type} missing`;
          const fields = Object.keys(o).filter((k) => !same(o[k], n[k]));
          const props = fields.includes("props") ? Object.keys(o.props ?? {}).filter((k) => !same(o.props[k], n.props?.[k])) : [];
          return fields.length ? `${o.type} ${fields.join("/")}${props.length ? ` (props ${props.join(", ")})` : ""}` : "";
        })
        .filter(Boolean);
      return `${diff.length} of ${a.length} objects differ after reload: ${diff.slice(0, 3).join("; ")}; ${b.length} objects now`;
    });
  } finally {
    await agent.close();
    await context.close();
  }
  return { steps, pageErrors: errors, toolCalls: agent.calls };
}
