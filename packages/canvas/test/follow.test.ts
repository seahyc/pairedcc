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
