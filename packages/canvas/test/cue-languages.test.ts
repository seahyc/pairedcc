import { describe, expect, it } from "vitest";
import { textCue } from "../src/ask-rules";

// Item 149 (principles row 7, recognising beats recalling): a reason or a proposal written in
// another language invites the same suggestion as in English.
const REASON = "What's the strongest objection?";
const PROPOSAL = "What would make this wrong?";

describe("cue words beyond English", () => {
  it.each([
    ["es", "Cobrar por puesto, porque el coste crece con el equipo"],
    ["es", "Lanzamos cada semana, así que llegan antes las opiniones"],
    ["fr", "Facturer par siège, parce que le coût suit l'équipe"],
    ["fr", "Les équipes paient déjà, donc le prix tient"],
    ["de", "Pro Platz abrechnen, weil die Kosten mit dem Team wachsen"],
    ["de", "Die Teams zahlen schon, deshalb hält der Preis"],
    ["pt", "Cobrar por lugar, porque o custo cresce com a equipa"],
    ["it", "Prezzo per posto, perché il costo cresce col team"],
    ["it", "I team pagano già, quindi il prezzo regge"],
    ["nl", "Per plek rekenen, omdat de kosten met het team groeien"],
    ["zh", "按席位收费，因为成本随团队增长"],
    ["zh", "团队已经在付费，所以价格站得住"],
    ["ja", "席ごとに課金する。チームと一緒にコストが増えるので"],
    ["ja", "チームはもう払っている。だから価格は保てる"],
  ])("a reason in %s: %s", (_lang, text) => expect(textCue(text)).toBe(REASON));

  it.each([
    ["es", "Deberíamos quitar el plan gratis"],
    ["es", "Hay que mover la bienvenida al correo"],
    ["es", "Debería cambiar"],
    ["fr", "Il faut supprimer l'offre gratuite"],
    ["fr", "Nous devrions écrire aux équipes inactives"],
    ["de", "Wir sollten den Gratisplan streichen"],
    ["de", "Wir müssen die Begrüßung per Mail schicken"],
    ["pt", "Devemos acabar com o plano grátis"],
    ["it", "Dovremmo togliere il piano gratuito"],
    ["nl", "We moeten het gratis plan schrappen"],
    ["zh", "我们应该取消免费版"],
    ["ja", "無料プランはやめるべき"],
  ])("a proposal in %s: %s", (_lang, text) => expect(textCue(text)).toBe(PROPOSAL));

  it("a reason still comes before a proposal, as in English", () => {
    expect(textCue("我们应该取消免费版，因为没人升级")).toBe(REASON);
    expect(textCue("Deberíamos quitar el plan gratis porque nadie paga")).toBe(REASON);
  });

  it("no added cue word gives a cue on ordinary English text", () => {
    for (const text of [
      "Buy a car for the team offsite",
      "Also the onboarding email",
      "Da Vinci sketches as a mood board",
      "Pois and kale for the lunch order",
      "The data says nothing yet",
      "Moet on the shelf, for the launch party",
      "Portugal and Italy first",
      "We want a calmer board",
      "Hold the door for the muster",
    ])
      expect(textCue(text), text).toBeUndefined();
  });

  it("a cue word inside a longer word is not a cue in spaced scripts", () => {
    expect(textCue("Porquerías en la oficina")).toBeUndefined();
    expect(textCue("Weilheim office opening")).toBeUndefined();
  });
});
