import { describe, expect, it } from "vitest";
import { agentListeners, chatAgentActivity, setListeners } from "../src/agent-client";

describe("which agent an ask may point the person to", () => {
  it("offers an agent that acted here, but never one that was listening for asks and stopped", () => {
    const chat = { actor: "Claude Code", at: 1, via: "mcp" as const }, resident = { actor: "Resident", at: 2, via: "mcp" as const };
    expect(chatAgentActivity(chat)).toBe(chat);
    expect(chatAgentActivity(resident)).toBe(resident);
    setListeners(["Resident"]);
    setListeners([]); // the resident agent stopped
    expect(agentListeners.get()).toEqual([]);
    expect(chatAgentActivity(resident)).toBeNull();
    expect(chatAgentActivity(chat)).toBe(chat);
    expect(chatAgentActivity(null)).toBeNull();
  });
  it("never offers a script that called the canvas, such as the feedback export", () => {
    expect(chatAgentActivity({ actor: "Feedback export", at: 1 })).toBeNull();
    expect(chatAgentActivity({ actor: "MCP agent", at: 1, via: "mcp" })).toMatchObject({ actor: "MCP agent" });
  });
});
