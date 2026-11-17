import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { z } from "zod";

const base = "http://localhost:5183/api/canvas";
const envelopeResult = z.object({
  ok: z.boolean().optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
const object = z.object({
  id: z.string(),
  revision: z.number(),
  x: z.number().optional(),
  name: z.string().optional(),
});
async function call(op: string, input: unknown = {}, requestId = randomUUID()) {
  const response = await fetch(`${base}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId,
      sessionId: process.env.PAIRED_SESSION,
      actor: "API verification",
      command: { op, input },
    }),
    signal: AbortSignal.timeout(20000),
  });
  return {
    status: response.status,
    ...envelopeResult.parse(await response.json()),
  };
}
const read = await call("read");
assert.equal(read.ok, true, "connected read");
const id = randomUUID(),
  input = {
    kind: "rectangle",
    x: 3000,
    y: 3000,
    width: 200,
    height: 100,
    name: "Temporary API verification",
  };
let shape: ReturnType<typeof object.parse> | undefined;
try {
  const first = await call("create", input, id);
  assert.equal(first.ok, true);
  shape = object.parse(first.result);
  const repeat = await call("create", input, id);
  assert.equal(
    object.parse(repeat.result).id,
    shape.id,
    "retry returns original object",
  );
  const conflict = await call("create", { ...input, x: 3100 }, id);
  assert.equal(conflict.status, 409, "reused requestId cannot change input");
  const updated = await call("update", {
    id: shape.id,
    expectedRevision: shape.revision,
    x: 3200,
  });
  assert.equal(updated.ok, true);
  const next = object.parse(updated.result);
  assert.equal(next.x, 3200);
  assert.ok(next.revision > shape.revision);
  const stale = await call("update", {
    id: shape.id,
    expectedRevision: shape.revision,
    x: 9999,
  });
  assert.equal(stale.ok, false, "stale update rejected");
  const unchanged = await call("get", { id: shape.id });
  assert.equal(
    object.parse(unchanged.result).x,
    3200,
    "rejection preserved newer state",
  );
  shape = object.parse(unchanged.result);
  const denied = await fetch(`${base}/sessions`, {
    headers: { origin: "https://untrusted.example" },
  });
  assert.equal(denied.status, 403, "cross-origin rejected");
  console.log(
    "PASS: live browser read, create, retry deduplication, conflicting retry, update, stale-write protection and cross-origin rejection",
  );
} finally {
  if (shape) {
    const current = await call("get", { id: shape.id });
    if (current.ok) {
      const obj = object.parse(current.result);
      const removed = await call("remove", {
        id: obj.id,
        expectedRevision: obj.revision,
      });
      assert.equal(removed.ok, true, "verification object removed");
    }
  }
}
