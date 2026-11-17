import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const base = process.env.PAIRED_URL ?? "http://localhost:5183";
const objectSchema = z.object({ id: z.string(), revision: z.number(), parentId: z.string(), x: z.number(), y: z.number(), props: z.record(z.string(), z.unknown()) });
const sceneSchema = z.object({ objects: z.record(z.string(), objectSchema), connections: z.array(objectSchema) });
const cleanup = new Set<string>();
async function command(op: string, input: Record<string, unknown> = {}, failure = false) {
  const response = await fetch(`${base}/api/canvas/command`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: randomUUID(), sessionId: process.env.PAIRED_SESSION, actor: "Composition verification", command: { op, input } }),
  });
  const raw: unknown = await response.json();
  const envelope = z.object({ ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() }).parse(raw);
  assert.equal(envelope.ok, !failure, JSON.stringify(raw));
  return envelope.result;
}
const read = () => command("read").then(value => z.object({ objects: z.array(objectSchema) }).parse(value).objects);
const guard = (object: z.infer<typeof objectSchema>) => ({ id: object.id, expectedRevision: object.revision });
try {
  const before = await read();
  const scene = sceneSchema.parse(await command("scene", {
    name: "Temporary composition check",
    nodes: [
      { key: "a", parentKey: "board", shape: { kind: "rectangle", x: 30, y: 60, width: 160, height: 100, text: "Evidence", color: "blue", fill: "none", dash: "dashed", font: "mono", size: "s", align: "start" } },
      { key: "board", shape: { kind: "frame", x: 6000, y: 6000, width: 700, height: 400, name: "Temporary board" } },
      { key: "b", parentKey: "board", shape: { kind: "ellipse", x: 300, y: 60, width: 160, height: 100, text: "Hypothesis", color: "violet" } },
    ],
    connections: [{ fromKey: "a", toKey: "b", label: "supports" }],
  }));
  for (const object of [...Object.values(scene.objects), ...scene.connections]) cleanup.add(object.id);
  assert.equal(scene.objects.a.parentId, scene.objects.board.id);
  assert.equal(scene.objects.a.x, 30);
  assert.equal(scene.objects.a.props.dash, "dashed");
  const copies = z.object({ objects: z.array(objectSchema) }).parse(await command("duplicate", {
    objects: [guard(scene.objects.board)], offsetX: 900, offsetY: 0,
  }));
  for (const object of copies.objects) cleanup.add(object.id);
  assert.ok(copies.objects.length >= 3);
  assert.equal(copies.objects.filter(object => object.props.richText).length >= 2, true);
  const currentA = objectSchema.parse(await command("get", { id: scene.objects.a.id }));
  const currentB = objectSchema.parse(await command("get", { id: scene.objects.b.id }));
  await command("arrange", { objects: [guard(currentA), { id: currentB.id, expectedRevision: currentB.revision + 100 }], layout: "row", x: 6030, y: 6200 }, true);
  assert.equal(objectSchema.parse(await command("get", { id: currentA.id })).x, currentA.x);
  const arranged = z.object({ objects: z.array(objectSchema) }).parse(await command("arrange", {
    objects: [guard(currentA), guard(currentB)], layout: "row", x: 6030, y: 6200, gap: 40,
  })).objects;
  assert.equal(arranged[0].x, 30);
  assert.equal(arranged[1].x, 230);
  const count = (await read()).length;
  await command("scene", { nodes: [{ key: "bad", parentKey: "missing", shape: { kind: "note", x: 0, y: 0 } }] }, true);
  assert.equal((await read()).length, count);
  assert.ok((await read()).length > before.length);
  console.log("PASS: live nested scene, style props, bound connections, frame duplication, page-space layout, all-or-nothing stale layout and invalid scene rejection");
} finally {
  for (const id of cleanup) {
    const object = (await read()).find(object => object.id === id);
    if (object) await command("remove", guard(object));
  }
}
