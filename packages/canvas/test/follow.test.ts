import { describe, expect, it } from "vitest";
import { followers, moveWithAttached } from "../src/follow";

type S = { id: string; meta: Record<string, unknown> };
const s = (id: string, meta: Record<string, unknown> = {}): S => ({ id, meta });

describe("what follows a moved object", () => {
  const board = [
    s("shape:card"),
    s("shape:comment", { targetId: "shape:card", targetIds: ["shape:card"] }),
    s("shape:note", { role: "annotation", targetId: "shape:card" }),
    s("shape:reply", { targetId: "shape:comment", replyTo: "shape:comment" }),
    s("shape:about-two", { targetId: "shape:card", targetIds: ["shape:card", "shape:other"] }),
    s("shape:other"),
  ];
  it("takes its comments, notes and their replies along", () => {
    expect(followers(["shape:card"], board, new Set(["shape:card"])).sort()).toEqual(["shape:comment", "shape:note", "shape:reply"]);
  });
  it("leaves comments about several objects where they are", () => {
    expect(followers(["shape:card"], board, new Set())).not.toContain("shape:about-two");
  });
  it("stops at anything being moved anyway: its own move brings its replies, exactly once", () => {
    // The person drags the card and its comment together. From the card: only the note.
    // From the comment (moved too, so it gets its own call): the reply. Never the reply twice.
    const moving = new Set(["shape:card", "shape:comment"]);
    const fromCard = followers(["shape:card"], board, moving), fromComment = followers(["shape:comment"], board, moving);
    expect(fromCard).toEqual(["shape:note"]);
    expect(fromComment).toEqual(["shape:reply"]);
    expect([...fromCard, ...fromComment].filter((id) => id === "shape:reply")).toHaveLength(1);
  });
  it("survives a cycle", () => {
    const loop = [s("shape:a", { targetId: "shape:b" }), s("shape:b", { targetId: "shape:a" })];
    expect(followers(["shape:a"], loop, new Set(["shape:a"]))).toEqual(["shape:b"]);
  });
});

describe("moving a frame or group", () => {
  const board = [
    { id: "shape:frame", meta: {} },
    { id: "shape:child", meta: {} },
    { id: "shape:inside-about-frame", meta: { targetId: "shape:frame" } },
    { id: "shape:outside-about-child", meta: { targetId: "shape:child" } },
  ];
  it("brings comments on its children and never moves what it already carries", () => {
    // The frame moves; its subtree (child and the comment inside it) moves with it anyway.
    const subtree = ["shape:frame", "shape:child", "shape:inside-about-frame"];
    expect(followers(subtree, board, new Set(subtree))).toEqual(["shape:outside-about-child"]);
  });
  it("brings a comment about several of its children, and that comment's replies", () => {
    const subtree = ["shape:frame", "shape:a", "shape:b"];
    const shapes = [
      ...subtree.map((id) => ({ id, meta: {} })),
      { id: "shape:about-both", meta: { targetId: "shape:a", targetIds: ["shape:a", "shape:b"] } },
      { id: "shape:answer", meta: { targetId: "shape:about-both", replyTo: "shape:about-both" } },
      { id: "shape:about-one-outside", meta: { targetId: "shape:a", targetIds: ["shape:a", "shape:elsewhere"] } },
    ];
    expect(followers(subtree, shapes, new Set(subtree)).sort()).toEqual(["shape:about-both", "shape:answer"]);
  });
});

describe("moving by a program brings what is attached", () => {
  type S = { id: string; type: string; x: number; y: number; parentId?: string; isLocked?: boolean; meta: Record<string, unknown> };
  const board = (shapes: S[]) => {
    const byId = new Map(shapes.map((s) => [s.id, { ...s }]));
    const calls: unknown[][] = [];
    const editor = {
      getShape: (id: string) => byId.get(id),
      getShapeAndDescendantIds: (ids: string[]) => {
        const out = new Set<string>();
        const walk = (id: string) => {
          out.add(id);
          for (const s of byId.values()) if (s.parentId === id) walk(s.id);
        };
        ids.forEach(walk);
        return out;
      },
      getCurrentPageShapes: () => [...byId.values()],
      updateShapes: (partials: { id: string; x: number; y: number }[]) => {
        calls.push(partials);
        for (const p of partials) Object.assign(byId.get(p.id)!, { x: p.x, y: p.y });
      },
    };
    return { editor, at: (id: string) => [byId.get(id)!.x, byId.get(id)!.y], calls };
  };
  const shape = (id: string, x: number, meta: Record<string, unknown> = {}, extra: Partial<S> = {}): S => ({ id, type: "card", x, y: 0, meta, ...extra });

  it("moves a section's comment and the reply to it by the section's amount, in one update", () => {
    const b = board([shape("sec", 0), shape("note", 300, { targetId: "sec" }), shape("reply", 300, { targetId: "note" }), shape("other", 900)]);
    moveWithAttached(b.editor, [{ id: "sec", dx: 500, dy: 40 }]);
    expect(b.at("sec")).toEqual([500, 40]);
    expect(b.at("note")).toEqual([800, 40]);
    expect(b.at("reply")).toEqual([800, 40]);
    expect(b.at("other")).toEqual([900, 0]);
    expect(b.calls).toHaveLength(1);
  });

  it("brings comments on a record's parts, and leaves comments about several objects", () => {
    const b = board([
      shape("rec", 0, {}, { type: "group" }),
      shape("field", 0, {}, { parentId: "rec" }),
      shape("onField", 200, { targetId: "field" }),
      shape("both", 200, { targetId: "field", targetIds: ["field", "other"] }),
      shape("other", 900),
    ]);
    moveWithAttached(b.editor, [{ id: "rec", dx: 0, dy: 100 }]);
    expect(b.at("onField")).toEqual([200, 100]);
    expect(b.at("both")).toEqual([200, 0]);
    // The part moves with its group (its own coordinates are relative), so it is not moved again.
    expect(b.at("field")).toEqual([0, 0]);
  });

  it("moves each shape once when two moved shapes are linked, and skips locked comments", () => {
    const b = board([shape("a", 0), shape("b", 100, { targetId: "a" }), shape("pin", 50, { targetId: "a" }, { isLocked: true })]);
    moveWithAttached(b.editor, [{ id: "a", dx: 10, dy: 0 }, { id: "b", dx: 20, dy: 0 }]);
    expect(b.at("a")).toEqual([10, 0]);
    expect(b.at("b")).toEqual([120, 0]);
    expect(b.at("pin")).toEqual([50, 0]);
  });
});
