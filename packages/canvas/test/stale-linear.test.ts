import { describe, expect, it } from "vitest";
import { staleChain, staleReason, type Derivation, type StaleInput } from "../src/data/model";

// Item 50: notes built on notes in rounds, each round using both notes of the round before, so
// every object reaches the changed dataset by 2^k paths.
function rounds(n: number) {
  const nodes = new Map<string, Derivation>();
  nodes.set("data", { version: 2, inputs: [] }); // changed: was version 1 when used
  let previous = [{ id: "data", version: 1 }];
  for (let k = 1; k <= n; k++) {
    const made = ["a", "b"].map((side) => `r${k}${side}`);
    for (const id of made) nodes.set(id, { version: 0, inputs: previous });
    previous = made.map((id) => ({ id, version: 0 }));
  }
  return { lookup: (id: string) => nodes.get(id), top: previous, nodes };
}
const visits = (list: readonly StaleInput[]): number => list.reduce((n, s) => n + 1 + visits(s.upstream ?? []), 0);

describe("staleness on shared inputs", () => {
  it("20 rounds of shared inputs is fast and reports each object's causes once", () => {
    const { lookup, top } = rounds(20);
    let calls = 0;
    const counted = (id: string) => (calls++, lookup(id));
    const started = performance.now();
    const stale = staleChain(top, counted, new Set(["result"]));
    const ms = performance.now() - started;
    expect(ms).toBeLessThan(200);
    // Each object is looked up a bounded number of times, not once per path.
    expect(calls).toBeLessThanOrEqual(3 * 41);
    // The report lists every object at most a few times, not 2^20 times.
    expect(visits(stale)).toBeLessThanOrEqual(2 * 41 + 2);
    expect(JSON.stringify(stale).length).toBeLessThan(10_000);
  });

  it("a repeated input is reported by reference after its first full listing", () => {
    const { lookup } = rounds(2);
    const stale = staleChain([{ id: "r2a", version: 0 }, { id: "r2b", version: 0 }], lookup);
    expect(stale[0]).toMatchObject({ id: "r2a", upstream: [{ id: "r1a", upstream: [{ id: "data", recorded: 1, current: 2 }] }, { id: "r1b", upstream: [{ id: "data" }] }] });
    expect(stale[1]).toEqual({ id: "r2b", recorded: 0, current: 0, upstream: [{ id: "r1a", recorded: 0, current: 0, repeated: true }, { id: "r1b", recorded: 0, current: 0, repeated: true }] });
  });

  it("names one root cause once, however many paths lead to it", () => {
    const { lookup, top } = rounds(20);
    const reason = staleReason(staleChain(top, lookup), (id) => (id === "data" ? "Orders" : id));
    expect(reason).toBe("“Orders” changed (via “r20a”, “r19a”, “r18a”, “r17a”, “r16a”, “r15a”, “r14a”, “r13a”, “r12a”, “r11a”, “r10a”, “r9a”, “r8a”, “r7a”, “r6a”, “r5a”, “r4a”, “r3a”, “r2a”, “r1a”)");
  });

  it("still counts genuinely different root causes", () => {
    const nodes = new Map<string, Derivation>([
      ["d1", { version: 2, inputs: [] }],
      ["d2", { version: 5, inputs: [] }],
      ["n", { version: 0, inputs: [{ id: "d1", version: 1 }, { id: "d2", version: 4 }] }],
    ]);
    const reason = staleReason(staleChain([{ id: "n", version: 0 }], (id) => nodes.get(id)), (id) => id);
    expect(reason).toBe("“d1” changed (via “n”), and 1 more input");
  });

  it("a cycle is not stale by itself and does not loop", () => {
    const nodes = new Map<string, Derivation>([
      ["x", { version: 0, inputs: [{ id: "y", version: 0 }] }],
      ["y", { version: 0, inputs: [{ id: "x", version: 0 }] }],
    ]);
    expect(staleChain([{ id: "x", version: 0 }], (id) => nodes.get(id))).toEqual([]);
  });
});
