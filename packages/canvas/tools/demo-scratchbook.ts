// Builds a scratchbook demo page: an agent proposes three definitions of
// "paying hirer" (synthetic numbers), reads back the human's note, asks
// numbered questions, and later closes the loop. Picks and rejects are made
// by the human in the browser (select, then P or X).
//
//   PAIRED_SESSION=... node --import tsx tools/demo-scratchbook.ts build
//   PAIRED_SESSION=... node --import tsx tools/demo-scratchbook.ts close
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

const base = "http://localhost:5183/api/canvas/command",
  sessionId = process.env.PAIRED_SESSION,
  file = new URL("../.local/scratchbook-demo.json", import.meta.url),
  shape = z.object({ id: z.string(), revision: z.number() });

async function call(op: string, input: unknown = {}, actor = "Paired demo agent") {
  const response = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: randomUUID(), sessionId, actor, command: { op, input } }),
    signal: AbortSignal.timeout(20000),
  });
  const r = z
    .object({ ok: z.boolean().optional(), result: z.unknown().optional(), error: z.string().optional() })
    .parse(await response.json());
  if (!response.ok || !r.ok) throw new Error(r.error ?? `HTTP ${response.status}`);
  return r.result;
}

// Synthetic monthly series; not real company data.
function chart(title: string, values: number[], color: string) {
  const max = Math.max(...values),
    bars = values
      .map((v, i) => {
        const h = (v / max) * 150;
        return `<rect x="${24 + i * 26}" y="${200 - h}" width="18" height="${h}" rx="3" fill="${color}"/>`;
      })
      .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="250" viewBox="0 0 360 250"><rect width="360" height="250" rx="8" fill="#fbfaf7" stroke="#d9d5cc"/><text x="20" y="30" font-family="Helvetica" font-size="15" fill="#33312c">${title}</text><text x="340" y="30" text-anchor="end" font-family="Helvetica" font-size="22" font-weight="700" fill="#33312c">${values.at(-1)}</text>${bars}<line x1="18" y1="201" x2="342" y2="201" stroke="#bdb8ad"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

async function build() {
  await call("page", { name: "Scratchbook demo" });
  const brief = shape.parse(
    await call("create", {
      kind: "note", x: 0, y: 0, width: 520, height: 180,
      text: "How I read your question: 'how many hirers are paying?' depends on what counts as paying. Three definitions below, each with its own number and trend (synthetic data). Circle or press P on the one that matches how you think about it; X the ones that don't. Correct me on the board if I've got the question wrong.",
    }),
  );
  const defs = [
    ["A · Any paid order in the month", [410, 432, 455, 470, 468, 492, 510, 531, 520, 548, 560, 577], "#7a62d6"],
    ["B · Active subscription at month end", [220, 228, 231, 240, 251, 249, 262, 270, 268, 281, 290, 296], "#7a62d6"],
    ["C · Paid in 2 of last 3 months", [150, 158, 166, 171, 180, 184, 190, 199, 205, 209, 214, 223], "#7a62d6"],
  ] as const;
  const options = [];
  for (const [i, [title, values, color]] of defs.entries()) {
    const img = shape.parse(
      await call("image", {
        src: chart(title, [...values], color), x: i * 400, y: 260, width: 360, height: 250,
        name: title, caption: `${title.split(" · ")[0]} · ${title.split(" · ")[1].toLowerCase()} (rough)`,
      }),
    );
    options.push(img);
    await call("connect", { fromId: brief.id, toId: img.id, relation: "alternative" });
  }
  const view = shape.parse(
    await call("create", {
      kind: "note", x: 0, y: 600, width: 760, height: 200,
      text: "My read: A counts one-off purchases, so it rises fastest but mixes in hirers who tried once. B is closest to recurring revenue. C is the most stable signal of a habit. I lean to C for 'are hirers coming back', B for revenue.\n\nQuestions:\n1. Is this question about revenue or about habit?\n2. Should free-trial conversions count in month one?",
    }),
  );
  await call("connect", { fromId: view.id, toId: options[2].id, relation: "feedback" });
  // Simulated human handwriting reply, attached to option C.
  const human = shape.parse(
    await call("annotate", { targetId: options[2].id, text: "habit. C, but show me who drops out of it", x: 860, y: 600 }, "Human"),
  );
  await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
  await writeFile(file, JSON.stringify({ options: options.map((o) => o.id), human: human.id }, null, 2));
  await call("focus", {});
  console.log(JSON.stringify({ options: options.map((o) => o.id), human: human.id }));
}

async function close() {
  const saved = z.object({ options: z.array(z.string()), human: z.string() }).parse(JSON.parse(await readFile(file, "utf8")));
  const read = z
    .object({ marks: z.array(z.object({ id: z.string(), revision: z.number(), kind: z.string(), status: z.string() })) })
    .parse(await call("read"));
  const open = read.marks.filter((m) => m.status === "open");
  const done = shape.parse(
    await call("annotate", {
      targetId: saved.options[2],
      text: `Done: C is the working definition (${open.map((m) => m.kind).join(", ")} addressed). Next I'll add a drop-out view of C beside it.`,
      x: 860, y: 860,
    }),
  );
  for (const m of open) await call("resolve", { id: m.id, expectedRevision: m.revision, status: "resolved" });
  console.log(JSON.stringify({ resolved: open.map((m) => `${m.kind}:${m.id}`), done: done.id }));
}

const mode = process.argv[2];
if (mode === "build") await build();
else if (mode === "close") await close();
else throw new Error("Use build or close");
