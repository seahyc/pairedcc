import { describe, expect, it } from "vitest";
import { agentListeners, chatAgentActivity, setListeners } from "../src/agent-client";

describe("which agent an ask may point the person to", () => {
  it("offers an agent that acted here, but never one that was listening for asks and stopped", () => {
    const chat = { actor: "Claude Code", at: 1 }, resident = { actor: "Resident", at: 2 };
    expect(chatAgentActivity(chat)).toBe(chat);
    expect(chatAgentActivity(resident)).toBe(resident);
    setListeners(["Resident"]);
    setListeners([]); // the resident agent stopped
    expect(agentListeners.get()).toEqual([]);
    expect(chatAgentActivity(resident)).toBeNull();
    expect(chatAgentActivity(chat)).toBe(chat);
    expect(chatAgentActivity(null)).toBeNull();
  });
});
