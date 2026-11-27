import { describe, expect, it } from "vitest";
import { startersFor, starters as defaults, textCue } from "../src/ask-rules";
import { suggestionsFor } from "../src/suggest";

const card = (text: string) => ({ type: "card", text });
const mine = (text: string) => ({ type: "card", text, byPerson: true });

describe("120: suggestions follow what the thought says", () => {
  it("a reason invites the strongest objection", () => {
    expect(textCue("Per-seat pricing, because cost should follow team size")).toBe("What's the strongest objection?");
    expect(textCue("Ship weekly so feedback comes sooner")).toBe("What's the strongest objection?");
  });
  it("a number asks where it comes from", () => {
    expect(textCue("Churn is 4% a month")).toBe("Where does this number come from?");
    expect(textCue("About 1,200 teams use it")).toBe("Where does this number come from?");
  });
  it("a proposal asks what would make it wrong", () => {
    expect(textCue("We should drop the free plan")).toBe("What would make this wrong?");
    expect(textCue("Let's move onboarding to email")).toBe("What would make this wrong?");
  });
  it("a list asks which matters most", () => {
    expect(textCue("Price\nSupport\nSpeed")).toBe("Which of these matters most?");
    expect(textCue("- price\n- support")).toBe("Which of these matters most?");
  });
  it("a short abstract claim asks for a concrete example", () => {
    expect(textCue("Simplicity matters")).toBe("Give me a concrete example");
    expect(textCue("Trust is the real product")).toBe(undefined);
    expect(textCue("Quality over quantity")).toBe("Give me a concrete example");
  });
  it("a list beats a number, a number beats a reason, a reason beats a proposal", () => {
    expect(textCue("Revenue 2m\nCost 1m")).toBe("Which of these matters most?");
    expect(textCue("We should raise prices by 10% because costs rose")).toBe("Where does this number come from?");
    expect(textCue("We should raise prices because costs rose")).toBe("What's the strongest objection?");
  });
  it("no cue: a plain thought keeps today's pair", () => {
    expect(textCue("Charge per seat")).toBe(undefined);
    expect(startersFor([card("Charge per seat")])).toEqual(defaults);
  });
  it("words inside other words are not cues", () => {
    expect(textCue("Soap opera ratings")).toBe(undefined);
    expect(textCue("Shoulder season trips")).toBe(undefined);
  });
  it("for one card the cue comes first and the kind's default second", () => {
    expect(startersFor([card("We should drop the free plan")]).slice(0, 2)).toEqual(["What would make this wrong?", defaults[0]]);
    expect(suggestionsFor([mine("Churn is 4% a month")])).toEqual(["Where does this number come from?", "What's missing?"]);
  });
  it("questions, records, frames, charts and several objects keep their own starters", () => {
    expect(startersFor([card("Should we charge 10% more?")])[0]).toBe("Answer this");
    expect(startersFor([card("Churn is 4%")], true)[0]).toBe("Is this point valid?");
    expect(startersFor([card("Churn is 4%"), card("We should act")])[0]).toBe("Compare these");
    expect(startersFor([{ type: "frame", text: "" }])[0]).toBe("What do these have in common?");
  });
  it("never more than three", () => {
    for (const t of ["Churn is 4%", "a\nb", "We should", "because", "Simplicity matters", "plain"]) expect(startersFor([card(t)]).length).toBeLessThanOrEqual(3);
  });
});

import { textLines } from "../src/suggest-ui";
describe("120: a card's lines reach the cue", () => {
  const p = (...content: unknown[]) => ({ type: "paragraph", content });
  const t = (text: string) => ({ type: "text", text });
  it("keeps paragraphs, Shift+Enter breaks and list items as lines", () => {
    expect(textLines({ type: "doc", content: [p(t("Price")), p(t("Support"))] })).toBe("Price\nSupport");
    expect(textLines({ type: "doc", content: [p(t("Price"), { type: "hardBreak" }, t("Speed"))] })).toBe("Price\nSpeed");
    expect(textLines({ type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [p(t("a"))] }, { type: "listItem", content: [p(t("b"))] }] }] })).toBe("a\nb");
    expect(textCue(textLines({ type: "doc", content: [p(t("Price"), { type: "hardBreak" }, t("Speed"))] }))).toBe("Which of these matters most?");
  });
  it("joins a bold word to its sentence without a stray space", () => {
    expect(textLines({ type: "doc", content: [p(t("Cost "), { type: "text", text: "per", marks: [{ type: "bold" }] }, t(" seat"))] })).toBe("Cost per seat");
  });
});
