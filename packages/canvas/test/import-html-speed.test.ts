import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/import-html";

// Item 71: awkward markup must not make the reader quadratic. Import accepts files
// up to 2 MB, so every case here is about that size or the size the review measured.
const MB2 = 2 * 1024 * 1024;
const fill = (unit: string, bytes = MB2) => unit.repeat(Math.floor(bytes / unit.length));
const timed = (html: string) => {
  const start = performance.now();
  const markdown = htmlToMarkdown(html);
  return { ms: performance.now() - start, markdown };
};

describe("web page reader on awkward markup", () => {
  it("reads 50,000 unclosed list items quickly, each still a list item", () => {
    const { ms, markdown } = timed(`<ul>${"<li>Point".repeat(50000)}</ul>`);
    expect(ms).toBeLessThan(1000);
    expect(markdown.split("\n").filter((l) => l === "- Point")).toHaveLength(50000);
  });
  it("reads 20,000 unclosed advert divs quickly", () => {
    const { ms } = timed(`<p>Body text</p>${'<div class="ad">Buy now'.repeat(20000)}`);
    expect(ms).toBeLessThan(1000);
  });
  for (const [name, unit] of [
    ["unclosed list items", "<li>x "],
    ["unclosed advert divs", '<div class="ad">x '],
    ["unclosed headings", "<h2>x "],
    ["unclosed pre blocks", "<pre>x "],
    ["unclosed articles", "<article>x "],
    ["unclosed nav blocks", "<nav>x "],
    ["unclosed comments", "<!-- x "],
    ["tags that never close their bracket", "<p x "],
    ["stray angle brackets", "a < b "],
    ["unclosed heads", "<head>x "],
  ] as const)
    it(`reads a 2 MB page of ${name} in under a second`, () => {
      expect(timed(fill(unit)).ms).toBeLessThan(1000);
    });

  it("keeps stray angle brackets as text", () => {
    expect(htmlToMarkdown("<p>a < b and c <d</p>")).toBe("a < b and c <d\n");
  });

  it("reads past a legacy <!-- inside a script (review of #98)", () => {
    const md = htmlToMarkdown("<html><head><script><!--\nwindow.ready = true;\n</script></head><body><h1>Build guide</h1><p>Steps.</p></body></html>");
    expect(md).toBe("# Build guide\n\nSteps.\n");
  });
  it("still drops a real comment, closed or not, and commented-out markup", () => {
    expect(htmlToMarkdown("<p>Kept</p><!-- <p>old <b>draft</b></p> --><p>Also kept</p>")).toBe("Kept\n\nAlso kept\n");
    expect(htmlToMarkdown("<p>Kept</p><!-- never closed <p>gone</p>")).toBe("Kept\n");
  });
  it("keeps escaped tags in headings as text (review of #98)", () => {
    expect(htmlToMarkdown("<h2>Writing &lt;li&gt; elements</h2><p>Prose one.</p><h2>Omitting &lt;li&gt; end tags</h2><p>Prose two.</p>")).toBe(
      "## Writing <li> elements\n\nProse one.\n\n## Omitting <li> end tags\n\nProse two.\n",
    );
  });
  it("reads a tag whose quoted attribute holds < (review of #98)", () => {
    expect(htmlToMarkdown('<h2 title="5 < 10">Results</h2><p>Keep this</p>')).toBe("## Results\n\nKeep this\n");
  });
  it("stays quick on 2 MB of scripts that never close", () => {
    const start = performance.now();
    htmlToMarkdown("<script>x ".repeat(200000));
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("keeps what well-formed markup meant", () => {
    const html = `<h2>Plan</h2><ul><li>One<li>Two</ul><div class="ad">Buy</div><p>Kept</p><pre>a\n  b</pre><h3>Next</h3>`;
    expect(htmlToMarkdown(html)).toBe("## Plan\n\n- One\n- Two\n\nKept\n\n```\na\n  b\n```\n\n### Next\n");
  });
});
