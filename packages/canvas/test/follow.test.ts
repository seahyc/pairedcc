import { describe, expect, it } from "vitest";
import { followers } from "../src/follow";

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
  it("never moves something that is being moved anyway, but still brings what hangs off it", () => {
    // The person drags the card and its comment together: the comment is not moved twice,
    // and the reply to the comment still comes along.
    expect(followers(["shape:card"], board, new Set(["shape:card", "shape:comment"])).sort()).toEqual(["shape:note", "shape:reply"]);
  });
  it("survives a cycle", () => {
    const loop = [s("shape:a", { targetId: "shape:b" }), s("shape:b", { targetId: "shape:a" })];
    expect(followers(["shape:a"], loop, new Set(["shape:a"]))).toEqual(["shape:b"]);
  });
});
