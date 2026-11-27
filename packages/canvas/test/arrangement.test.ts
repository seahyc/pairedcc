import { describe, expect, it } from "vitest";
import { BESIDE_NEAR, CLUSTER_GAP, CLUSTER_GIVE, besideGap, clusterAround, relation } from "../src/arrangement";
import { buildPrompt, systemPrompt } from "../tools/resident-prompt";

const box = (id: string, x: number, y: number, w = 200, h = 120) => ({ id, x, y, w, h });

describe("where something sits, in words", () => {
  const ask = box("ask", 400, 400);
  it("names the side it is on", () => {
    expect(relation(box("a", 100, 400), ask)).toBe("left of");
    expect(relation(box("a", 700, 410), ask)).toBe("right of");
    expect(relation(box("a", 400, 200), ask)).toBe("above");
    expect(relation(box("a", 420, 560), ask)).toBe("under");
  });
  it("picks the side with the larger gap when it is off a corner", () => {
    expect(relation(box("a", 0, 200), ask)).toBe("left of");
    expect(relation(box("a", 450, 900), ask)).toBe("under");
  });
  it("says overlapping when the boxes overlap", () => {
    expect(relation(box("a", 450, 450), ask)).toBe("overlapping");
  });
});

describe("the cluster an ask sits in", () => {
  // A row of three cards with the ask under the middle one, and a far-away pile of two.
  const layout = [box("a", 0, 0), box("b", 240, 0), box("c", 480, 0), box("ask", 240, 160), box("far1", 2000, 0), box("far2", 2240, 0)];
  it("gives the other members of the ask's cluster, nearest first, with their relation", () => {
    const got = clusterAround(layout, "ask");
    expect(got.members.map((m) => m.id)).toEqual(["b", "a", "c"]);
    expect(got.members.map((m) => m.relation)).toEqual(["above", "above", "above"]);
    expect(got.more).toBe(0);
  });
  it("is empty for an ask on its own", () => {
    expect(clusterAround([box("ask", 0, 0), box("x", 1000, 1000)], "ask").members).toEqual([]);
  });
  it("leaves out what the ask already gives", () => {
    expect(clusterAround(layout, "ask", new Set(["b"])).members.map((m) => m.id)).toEqual(["a", "c"]);
  });
  it("caps the members and counts the rest", () => {
    const row = Array.from({ length: CLUSTER_GIVE + 3 }, (_, i) => box(`r${i}`, i * 240, 0));
    const got = clusterAround([...row, box("ask", 0, 160)], "ask");
    expect(got.members).toHaveLength(CLUSTER_GIVE);
    expect(got.more).toBe(3);
    expect(got.members[0].id).toBe("r0");
  });
  it("an ask written on empty space inside a pile is about that pile", () => {
    const pile = [box("p1", 0, 0), box("p2", 240, 0), box("p3", 0, 160), box("p4", 240, 160)];
    // The ask sits in the gap at the pile's middle-right.
    const got = clusterAround([...pile, box("ask", 480, 80)], "ask");
    expect(got.members.map((m) => m.id).sort()).toEqual(["p1", "p2", "p3", "p4"]);
  });
});

describe("the group an ask gives already starts from what is beside its card (item 129)", () => {
  it("beside is never wider than the group gap on either axis", () => {
    expect(BESIDE_NEAR).toBeLessThanOrEqual(CLUSTER_GAP);
  });
  it("every object beside the card is in the card's own group, on any layout", () => {
    // Deterministic pseudo-random layouts: a card and 12 boxes scattered around it.
    let seed = 129;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    let besideSeen = 0;
    for (let round = 0; round < 500; round++) {
      const host = box("ask", 400, 400, 200 + rand() * 200, 60 + rand() * 200);
      const others = Array.from({ length: 12 }, (_, i) => box(`o${i}`, rand() * 1000, rand() * 1000, 80 + rand() * 240, 40 + rand() * 200));
      const group = new Set(clusterAround([host, ...others], "ask", new Set(), Infinity).members.map((m) => m.id));
      for (const o of others.filter((o) => besideGap(o, host) <= BESIDE_NEAR)) {
        besideSeen++;
        expect(group.has(o.id)).toBe(true);
      }
    }
    expect(besideSeen).toBeGreaterThan(100);
  });
  it("on the layout reported in #170, the second idea is in the group when the cards are 40 px apart", () => {
    // Two 240 px idea cards side by side 40 px apart; the question 40 px under the first.
    const layout = [box("idea1", 0, 0, 240, 130), box("idea2", 280, 0, 240, 130), box("ask", 0, 170, 240, 130)];
    expect(besideGap(layout[0], layout[2])).toBeLessThanOrEqual(BESIDE_NEAR);
    // idea1 is given as a target (beside the card), so the ask leaves it out of the group.
    expect(clusterAround(layout, "ask", new Set(["idea1"])).members).toEqual([{ id: "idea2", relation: "above" }]);
  });
  it("as that task's board really was (200 px sticky notes, 80 px apart), the second idea is in no group with the first", () => {
    // `create` for a note made by the person ignores width: tldraw sticky notes are 200 by 200.
    const layout = [box("idea1", 0, 0, 200, 200), box("idea2", 280, 0, 200, 200), box("ask", 0, 170, 200, 272)];
    expect(clusterAround(layout, "ask").members.map((m) => m.id)).toEqual(["idea1"]);
    // Starting from idea1 would not help either: idea2 is beyond the group gap from it.
    expect(clusterAround(layout, "idea1").members.map((m) => m.id)).toEqual(["ask"]);
  });
});

describe("the resident agent is told where things sit", () => {
  it("lists the ask's group with relations, and its rules say to use them", () => {
    const prompt = buildPrompt({
      question: "Which first?",
      targets: [],
      cluster: [
        { id: "a", type: "card", author: "Human", text: "Charge per seat", relation: "left of" },
        { id: "b", type: "card", author: "Claude", text: "Usage based", relation: "under" },
      ],
      clusterMore: 2,
    });
    expect(prompt).toContain("In the same group as what the person wrote (they put these together):");
    expect(prompt).toContain('- card by the person, left of it: """Charge per seat"""');
    expect(prompt).toContain('- card by Claude (an agent), under it: """Usage based"""');
    expect(prompt).toContain("- and 2 more in the group, not shown");
    expect(systemPrompt).toMatch(/where things sit/i);
  });
  it("says nothing about a group when there is none", () => {
    expect(buildPrompt({ question: "Why?", targets: [] })).not.toContain("same group");
  });
});

describe("what the question is about says where it sits", () => {
  it("each target with a relation is said with it", () => {
    const prompt = buildPrompt({
      question: "Which first?",
      targets: [
        { id: "a", type: "card", author: "Human", text: "Charge per seat", relation: "above" },
        { id: "b", type: "card", author: "Human", text: "No relation known" },
      ],
    });
    expect(prompt).toContain('- card written by the person, above it: """Charge per seat"""');
    expect(prompt).toContain('- card written by the person: """No relation known"""');
  });
});
