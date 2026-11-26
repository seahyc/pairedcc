import { describe, it, expect } from "vitest";
import { isLocalRequest, isRelayPath } from "../server/relay";
import { envelopeSchema, imageInput } from "../src/protocol";
const local = {
  socket: { remoteAddress: "127.0.0.1" },
  headers: { host: "localhost:5183" },
};
describe("local agent transport boundary", () => {
  it("allows local CLI and same-origin browser calls", () => {
    expect(isLocalRequest(local)).toBe(true);
    expect(
      isLocalRequest({
        ...local,
        headers: { ...local.headers, origin: "http://localhost:5183" },
      }),
    ).toBe(true);
  });
  it("rejects cross-origin, remote and hostile host requests", () => {
    expect(
      isLocalRequest({
        ...local,
        headers: { ...local.headers, origin: "https://evil.example" },
      }),
    ).toBe(false);
    expect(
      isLocalRequest({ ...local, socket: { remoteAddress: "192.168.1.2" } }),
    ).toBe(false);
    expect(
      isLocalRequest({ ...local, headers: { host: "evil.example" } }),
    ).toBe(false);
  });
  it("requires a request ID and a known operation", () => {
    expect(envelopeSchema.safeParse({ command: { op: "read" } }).success).toBe(
      false,
    );
    expect(
      envelopeSchema.safeParse({
        requestId: "one",
        command: { op: "run-shell" },
      }).success,
    ).toBe(false);
  });
  it("accepts image data and rejects scripts or remote fetch instructions", () => {
    expect(
      imageInput.safeParse({
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        src: "data:image/png;base64,YQ==",
      }).success,
    ).toBe(true);
    expect(
      imageInput.safeParse({
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        src: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      imageInput.safeParse({
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        src: "https://example.com/image.png",
      }).success,
    ).toBe(false);
  });

  it("leaves the boards API to the board store or the proxied server", () => {
    expect(isRelayPath("/api/canvas/sessions")).toBe(true);
    expect(isRelayPath("/api/canvas/command")).toBe(true);
    expect(isRelayPath("/api/canvas/boards")).toBe(false);
    expect(isRelayPath("/api/canvas/boards/main")).toBe(false);
    expect(isRelayPath("/api/canvas/boardsx")).toBe(true);
    expect(isRelayPath("/canvas/")).toBe(false);
  });
});
