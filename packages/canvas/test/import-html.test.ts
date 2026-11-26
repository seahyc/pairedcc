import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ImportError, detectPaste, parseImport, planImport } from "../src/import-parse";
import { htmlToMarkdown } from "../src/import-html";

const article = readFileSync(new URL("./fixtures/article.html", import.meta.url), "utf8");

describe("a saved web page", () => {
  it("becomes its article's sections, in reading order, under the article's title", () => {
    const plan = planImport(parseImport(article, "html"));
    if (plan.kind !== "prose") throw new Error(plan.kind);
    expect(plan.title).toBe("Second ferry for the estuary?");
    expect(plan.sections.map((s) => s.heading ?? null)).toEqual([null, "What the operator says", "What the assessors will ask", "What happens next"]);
    expect(plan.sections[0].text).toContain("only crossing between the harbour and Eastpoint");
    expect(plan.sections[1].text).toContain("• Two vessels would allow a winter timetable.\n• A third hull");
    expect(plan.sections[1].text).toContain("forty minute drive");
    expect(plan.sections[1].text).toContain("“for later”");
  });

  it("leaves out what is not the article: navigation, scripts, styles, asides, adverts, forms and the footer", () => {
    const all = JSON.stringify(planImport(parseImport(article, "html")));
    for (const junk of ["Subscribe now", "TRACKING CODE", "font-family", "Pier repairs delayed", "Related", "Sign up", "All rights reserved", "Enable JavaScript", "Harbour Gazette"])
      expect(all, junk).not.toContain(junk);
  });

  it("uses the page title when the content has no top heading", () => {
    const md = htmlToMarkdown("<html><head><title>Fleet notes</title></head><body><h2>Costs</h2><p>Nine point two.</p><h2>Hulls</h2><p>Two, then three.</p></body></html>");
    expect(md.startsWith("# Fleet notes\n")).toBe(true);
    expect(md).toContain("## Costs");
  });

  it("keeps preformatted text as a code block", () => {
    expect(htmlToMarkdown("<h2>Sum</h2><pre>total = vessels\n  + fit-out</pre>")).toContain("```\ntotal = vessels\n  + fit-out\n```");
  });
});

describe("pasting from a web page", () => {
  const fragment = `<meta charset="utf-8"><h2>What the operator says</h2><p>${"The operator says the crossing saves commuters a long drive around the estuary. ".repeat(3)}</p><h2>What the assessors will ask</h2><p>${"Assessors will question the forecast and the lease. ".repeat(3)}</p>`;
  const text = "What the operator says\nThe operator says the crossing saves commuters a long drive around the estuary.\nWhat the assessors will ask\nAssessors will question the forecast and the lease.";
  it("brings its headings along as sections, which the plain text alone would lose", () => {
    const found = detectPaste({ html: fragment, text });
    expect(found?.format).toBe("html");
    const plan = planImport(parseImport(found!.content, "html"));
    expect(plan.kind === "prose" && plan.sections.map((s) => s.heading)).toEqual(["What the operator says", "What the assessors will ask"]);
  });
  it("still leaves one paragraph of copied text as ordinary text", () => {
    expect(detectPaste({ html: "<p>Charge per seat, not per company.</p>", text: "Charge per seat, not per company." })).toBeNull();
  });
});

describe("awkward markup stays quick (item 71)", () => {
  const timed = (html: string) => {
    const started = performance.now();
    let error: unknown;
    try {
      parseImport(html, "html");
    } catch (e) {
      error = e;
    }
    return { ms: performance.now() - started, error };
  };
  it("2 MB of unclosed <li> is read in under a second", () => {
    const html = `<h1>List</h1><ul>${"<li>item text ".repeat(Math.floor(2_000_000 / 14))}</ul>`;
    const { ms, error } = timed(html);
    expect(ms).toBeLessThan(1000);
    expect(error === undefined || error instanceof ImportError).toBe(true);
  });
  it("2 MB of unclosed advert <div>s is read in under a second", () => {
    const html = `<h1>Ads</h1>${'<div class="ad">x '.repeat(Math.floor(2_000_000 / 18))}<p>real text</p>`;
    const { ms, error } = timed(html);
    expect(ms).toBeLessThan(1000);
    expect(error === undefined || error instanceof ImportError).toBe(true);
  });
  it("2 MB of unclosed <nav> and <script> is read in under a second", () => {
    const html = `<h1>Mess</h1>${"<nav><script>x ".repeat(Math.floor(2_000_000 / 16))}`;
    const { ms } = timed(html);
    expect(ms).toBeLessThan(1000);
  });
});

describe("review of #93", () => {
  it("repeated byline paragraphs with one distant close stay quick", () => {
    const html = `<h1>News</h1>${'<p class="byline">x '.repeat(30000)}</p><p>The real story.</p>`;
    const started = performance.now();
    const md = htmlToMarkdown(html);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(md).toContain("The real story.");
  });
  it("an <article> in a head comment, or an <article-card>, is not the content region", () => {
    const html = '<html><head><!-- Example: <article> --></head><body><article-card>Card</article-card><main><h1>Report</h1><p>Results</p></main><p>Unrelated links</p></body></html>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("# Report");
    expect(md).toContain("Results");
    expect(md).not.toContain("Unrelated links");
    expect(md).not.toContain("-->");
  });
  it("text that changes length when lowercased does not shift what is read", () => {
    const md = htmlToMarkdown("<article><h1>İstanbul</h1><p>See here</p><pre>a\nb</pre><script>x</script><p>After</p></article>");
    expect(md).toBe("# İstanbul\n\nSee here\n\n```\na\nb\n```\n\nAfter\n");
  });
});

describe("unclosed comments stay quick", () => {
  it("2 MB of unclosed <!-- is read in under a second", () => {
    const started = performance.now();
    htmlToMarkdown(`<h1>Notes</h1><p>Kept.</p>${"<!--x ".repeat(330000)}`);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
