import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

const base = "http://localhost:5183/api/canvas/command",
  sessionId = process.env.PAIRED_SESSION;
const file = new URL("../.local/agent-studio.json", import.meta.url);
const shape = z.object({ id: z.string(), revision: z.number() });
async function call(op: string, input: unknown = {}) {
  const response = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: randomUUID(),
      sessionId,
      actor: "Paired demo agent",
      command: { op, input },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const r = z
    .object({
      ok: z.boolean().optional(),
      result: z.unknown().optional(),
      error: z.string().optional(),
    })
    .parse(await response.json());
  if (!response.ok || !r.ok)
    throw new Error(r.error ?? `HTTP ${response.status}`);
  return r.result;
}
function character(kind: "lantern" | "hand" | "ribbon", revised = false) {
  const shadow =
    kind === "lantern"
      ? '<circle cx="105" cy="117" r="28" fill="#d8b968"/><path d="M87 108v27h36v-27z" fill="#ffe7a4"/><path d="M105 90V66" stroke="#d8b968" stroke-width="5"/>'
      : kind === "hand"
        ? `<path d="M176 180Q221 118 240 115L249 69Q253 60 259 67L264 105L271 51Q277 41 283 53L282 111L300 63Q307 56 310 67L296 122L320 94Q330 92 329 103L306 150Q289 181 247 192L196 213Z" fill="#7465bb" transform="${revised ? "translate(-16 -40) scale(1.12)" : "translate(-35 10) scale(.9)"}"/>`
        : '<path d="M97 183Q15 128 84 69Q155 25 225 81Q293 137 233 174Q181 201 127 148" fill="none" stroke="#8a74c5" stroke-width="16" stroke-linecap="round"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="300" viewBox="0 0 360 300"><rect width="360" height="300" rx="10" fill="#eeeaf4"/><ellipse cx="180" cy="249" rx="108" ry="21" fill="#d7cfdf"/>${revised ? '<path d="M150 244Q58 282 25 243Q71 268 125 220" fill="#9e8ccd"/>' : ""}${shadow}<path d="M140 151L122 233Q175 258 221 232L206 151Z" fill="#302b42"/><path d="M157 169L150 229M192 168L205 231" stroke="#625477" stroke-width="8"/><path d="M137 174L113 207M208 173L229 205" stroke="#403650" stroke-width="17" stroke-linecap="round"/><path d="M143 119Q145 79 178 76Q211 79 215 119L207 157H149Z" fill="#44384f"/><path d="M151 121Q178 105 206 121L202 147H155Z" fill="#e9d7b2"/><path d="M165 130h7m13 0h7" stroke="#43394a" stroke-width="4"/><path d="M154 104Q176 90 202 107" fill="none" stroke="#a99bc8" stroke-width="7"/><path d="M154 162L178 185L202 162" fill="none" stroke="#b4a0d7" stroke-width="9"/><path d="M135 235l-7 15h36l2-12m27 0l2 12h35l-9-16" fill="#262334"/><circle cx="180" cy="175" r="5" fill="#dcc69a"/></svg>`;
}
async function image(
  name: string,
  svg: string,
  x: number,
  y: number,
  width = 320,
  height = 267,
) {
  return shape.parse(
    await call("image", {
      name,
      src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      x,
      y,
      width,
      height,
    }),
  );
}
async function text(
  name: string,
  text: string,
  x: number,
  y: number,
  width = 380,
) {
  return shape.parse(
    await call("create", { kind: "text", name, text, x, y, width }),
  );
}
const mode = process.argv[2] ?? "build";
if (mode === "build") {
  await call("page", { name: "Agent studio" });
  const title = await text(
    "Studio title",
    "A character, made together.",
    0,
    -100,
    760,
  );
  const brief = shape.parse(
    await call("create", {
      kind: "rectangle",
      x: 0,
      y: 0,
      width: 400,
      height: 195,
      color: "light-blue",
      name: "Design brief",
      text: "A guardian who fights through its shadow.\n\nExplore three distinct silhouettes.\nKeep the character readable at game scale.",
    }),
  );
  const reference = await image(
    "Reference · silhouette and palette",
    character("lantern"),
    0,
    290,
    400,
    333,
  );
  await text(
    "Reference label",
    "Reference · silhouette & palette",
    0,
    250,
    400,
  );
  const a = await image("A · Lantern keeper", character("lantern"), 510, 0);
  const b = await image("B · Shadow hand", character("hand"), 900, 0);
  const c = await image("C · Ribbon dancer", character("ribbon"), 1290, 0);
  await text("A label", "A · Lantern keeper", 510, -42, 320);
  await text("B label", "B · Shadow hand", 900, -42, 320);
  await text("C label", "C · Ribbon dancer", 1290, -42, 320);
  for (const target of [a, b, c])
    await call("connect", {
      fromId: reference.id,
      toId: target.id,
      relation: "reference",
    });
  await text(
    "Feedback instruction",
    "Select a study → add feedback",
    900,
    350,
    450,
  );
  await text(
    "Provenance",
    "SVG studies created through the local agent API.\nNo image-generation service was called.",
    0,
    720,
    650,
  );
  await call("focus");
  await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
  await writeFile(
    file,
    JSON.stringify(
      {
        sessionId,
        title: title.id,
        brief: brief.id,
        reference: reference.id,
        a: a.id,
        b: b.id,
        c: c.id,
      },
      null,
      2,
    ),
  );
  console.log(
    "Created Agent studio via HTTP. Select B and attach feedback in the canvas, then run this script with revise.",
  );
} else if (mode === "revise") {
  const state = z
    .object({ b: z.string() })
    .parse(JSON.parse(await readFile(file, "utf8")));
  const canvas = z
    .object({
      annotations: z.array(
        z.object({
          id: z.string(),
          targetId: z.string(),
          text: z.string(),
          status: z.string(),
          revision: z.number(),
        }),
      ),
    })
    .parse(await call("read"));
  const feedback = canvas.annotations.find(
    (a) => a.targetId === state.b && a.status === "open",
  );
  if (!feedback) throw new Error("Add human feedback to B on the canvas first");
  console.log(`Read targeted human feedback: ${feedback.text}`);
  const revised = await image(
    "B2 · Larger shadow hand + motion trail",
    character("hand", true),
    900,
    740,
    440,
    367,
  );
  await text(
    "Revision label",
    "B2 · Larger shadow hand + motion trail",
    900,
    690,
    500,
  );
  await call("connect", {
    fromId: state.b,
    toId: revised.id,
    relation: "derived-from",
    label: "Revision",
  });
  await call("resolve", {
    id: feedback.id,
    expectedRevision: feedback.revision,
    status: "resolved",
  });
  await call("focus");
  await writeFile(
    file,
    JSON.stringify(
      {
        ...JSON.parse(await readFile(file, "utf8")),
        revised: revised.id,
        feedback: feedback.id,
      },
      null,
      2,
    ),
  );
  console.log(
    "Created B2 beside the original studies and resolved the targeted feedback. Original alternatives are preserved.",
  );
} else throw new Error("Use build or revise");
