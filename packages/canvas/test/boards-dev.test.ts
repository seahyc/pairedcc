import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { devBoardStore } from "../server/boards-dev";

const doc = (n: number) => ({ store: { "shape:a": { n } }, schema: {} });

describe("development board store history", () => {
  it("lists kept revisions newest first and returns one with its snapshot, like the server", () => {
    const store = devBoardStore(mkdtempSync(join(tmpdir(), "paired-boards-test-")));
    expect(store.revisions("main")).toBeNull();
    store.save("main", 0, doc(1));
    store.save("main", 1, doc(2));
    expect(store.revisions("main")!.map((r) => r.revision)).toEqual([2, 1]);
    expect(store.revisions("main")![0]).toEqual({ revision: 2, sizeBytes: JSON.stringify(doc(2)).length, savedAt: expect.any(String) });
    expect(store.revision("main", 1)).toMatchObject({ revision: 1, snapshot: doc(1) });
    expect(store.revision("main", 3)).toBeNull();
  });

  it("keeps only the newest 50 revisions", () => {
    const store = devBoardStore(mkdtempSync(join(tmpdir(), "paired-boards-test-")));
    store.save("main", 0, doc(1));
    for (let r = 1; r < 55; r++) store.save("main", r, doc(r + 1));
    const list = store.revisions("main")!;
    expect(list).toHaveLength(50);
    expect(list[0].revision).toBe(55);
    expect(store.revision("main", 5)).toBeNull();
    expect(store.revision("main", 6)).toMatchObject({ snapshot: doc(6) });
  });
});

describe("development board store folder", () => {
  it("answers empty and recreates its folder on the next save when the folder is removed", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "paired-boards-test-")), "boards");
    const store = devBoardStore(dir);
    store.save("main", 0, doc(1));
    rmSync(dir, { recursive: true, force: true });
    expect(store.list()).toEqual([]);
    expect(store.get("main")).toBeNull();
    expect(store.save("main", 0, doc(2)).status).toBe(201);
    expect(store.list().map((b) => b.id)).toEqual(["main"]);
  });
});
