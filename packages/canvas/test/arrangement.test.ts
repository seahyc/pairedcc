import { describe, expect, it } from "vitest";
import { CLUSTER_GIVE, clusterAround, relation } from "../src/arrangement";
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
  it("a left-out member past the cap frees its slot for the next one, and is not counted as more", () => {
    // Twelve in a row; the person left out the nearest. Eight shareable are given, three counted.
    const row = Array.from({ length: CLUSTER_GIVE + 4 }, (_, i) => box(`r${i}`, i * 240, 0));
    const got = clusterAround([...row, box("ask", 0, 160)], "ask", new Set(), CLUSTER_GIVE, (ids) => ids.filter((id) => id !== "r0"));
    expect(got.members.map((m) => m.id)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]);
    expect(got.more).toBe(3);
  });
  it("an ask written on empty space inside a pile is about that pile", () => {
    const pile = [box("p1", 0, 0), box("p2", 240, 0), box("p3", 0, 160), box("p4", 240, 160)];
    // The ask sits in the gap at the pile's middle-right.
    const got = clusterAround([...pile, box("ask", 480, 80)], "ask");
    expect(got.members.map((m) => m.id).sort()).toEqual(["p1", "p2", "p3", "p4"]);
  });
});

describe("an ask written on empty space inside a group (item 131)", () => {
  // A ring of cards chained 40 px apart around an empty middle, each more than 60 px from it.
  const ring = [
    box("t1", 0, 0), box("t2", 240, 0), box("t3", 480, 0),
    box("l1", 0, 160), box("l2", 0, 320), box("r1", 480, 160), box("r2", 480, 320),
    box("b1", 0, 480), box("b2", 240, 480), box("b3", 480, 480),
  ];
  const middle = box("ask", 280, 260, 120, 60);
  it("a question in the middle of a ring, beyond the group gap from every card, is given the ring", () => {
    const got = clusterAround([...ring, middle], "ask", new Set(), Infinity);
    expect(got.members.map((m) => m.id).sort()).toEqual(ring.map((r) => r.id).sort());
  });
  it("each member still says where it sits from the question", () => {
    const got = clusterAround([...ring, middle], "ask", new Set(), Infinity);
    expect(got.members.find((m) => m.id === "t2")?.relation).toBe("above");
    expect(got.members.find((m) => m.id === "b2")?.relation).toBe("under");
    expect(got.members.find((m) => m.id === "l1")?.relation).toBe("left of");
  });
  it("still leaves out what the ask already gives, and caps and counts the rest", () => {
    const got = clusterAround([...ring, middle], "ask", new Set(["t2"]));
    expect(got.members.map((m) => m.id)).not.toContain("t2");
    expect(got.members).toHaveLength(CLUSTER_GIVE);
    expect(got.more).toBe(ring.length - 1 - CLUSTER_GIVE);
  });
  it("a question outside every group's bounds is given none", () => {
    expect(clusterAround([...ring, box("ask", 900, 260, 120, 60)], "ask").members).toEqual([]);
  });
  it("inside two groups' bounds, the smaller one (the one it is most inside)", () => {
    // A wide ring around a small pile, with the question in the pile's gap but beyond 60 px of it.
    const big = [box("w1", -400, -400, 1400, 40), box("w2", -400, -340, 40, 1340), box("w3", 960, -340, 40, 1340), box("w4", -400, 1020, 1400, 40)];
    const pile = [box("p1", 100, 100), box("p2", 100, 500), box("p3", 340, 100, 200, 520)];
    const got = clusterAround([...big, ...pile, box("ask", 120, 330, 100, 40)], "ask", new Set(), Infinity);
    expect(got.members.map((m) => m.id).sort()).toEqual(["p1", "p2", "p3"]);
  });
  it("a question that is already in a group keeps that group", () => {
    const got = clusterAround([...ring, box("ask", 240, 160, 200, 120), box("near", 260, 300, 100, 40)], "ask", new Set(), Infinity);
    expect(got.members.map((m) => m.id)).toContain("near");
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
