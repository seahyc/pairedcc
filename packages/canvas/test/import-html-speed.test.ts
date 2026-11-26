import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/import-html";
import { ImportError, parseImport } from "../src/import-parse";

// Item 71: awkward markup must not make the reader quadratic. Import accepts files
// up to 2 MB, so every case here is about that size or the size the review measured.
const MB2 = 2 * 1024 * 1024;
const fill = (unit: string, bytes = MB2) => unit.repeat(Math.floor(bytes / unit.length));
// Processor time this process spent, not time on the clock: the question is how much work the
// reader does, and a clock also counts whatever else the machine is running beside the test.
const spent = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};
const timed = (html: string) => {
  const start = spent();
  const markdown = htmlToMarkdown(html);
  return { ms: spent() - start, markdown };
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
    ["unclosed titles", "<title>x "],
    ["titles that never close their bracket", "<title x "],
    ["closing tags that never close their bracket", "</li "],
    ["unclosed byline paragraphs", '<p class="byline">x '],
    ["headings that spell a tag with entities", "<h2>&lt;p x</h2>"],
    ["list items that spell a tag with entities", "<li>&lt;li x</li>"],
    ["unclosed styles, scripts, titles and text areas", "<style>a<script>b<title>c<textarea>d"],
  ] as const)
    it(`reads a 2 MB page of ${name} in under a second`, () => {
      expect(timed(fill(unit)).ms).toBeLessThan(1000);
    });
  for (const [name, html] of [
    ["unclosed heads after a stray </head>", `</head>${fill("<head>x ")}`],
    ["unclosed byline paragraphs with one distant close", `<h1>News</h1>${fill('<p class="byline">x ')}</p><p>The real story.</p>`],
    ["one list item holding headings that spell a tag", `<li>${fill("<h2>&lt;p x</h2>")}</li>`],
    ["a pre block of stray brackets", `<pre>${fill("<x ")}</pre>`],
    ["tags inside a quote that never closes", `<p title="${fill("<b>x</b> ")}`],
  ] as const)
    it(`reads a 2 MB page of ${name} in under a second`, () => {
      expect(timed(html).ms).toBeLessThan(1000);
    });
  it("imports a 2 MB page of unclosed list items, or refuses it plainly, in under a second", () => {
    const html = `<h1>List</h1><ul>${fill("<li>item text ")}</ul>`;
    const start = spent();
    let error: unknown;
    try {
      parseImport(html, "html");
    } catch (e) {
      error = e;
    }
    expect(spent() - start).toBeLessThan(1000);
    expect(error === undefined || error instanceof ImportError).toBe(true);
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
    expect(timed("<script>x ".repeat(200000)).ms).toBeLessThan(1000);
  });

  it("keeps the real story after bylines that are never closed", () => {
    const markdown = htmlToMarkdown(`<h1>News</h1>${'<p class="byline">x '.repeat(30000)}</p><p>The real story.</p>`);
    expect(markdown).toContain("The real story.");
  });
  it("does not take an <article> in a comment, or an <article-card>, for the content region", () => {
    const html = "<html><head><!-- Example: <article> --></head><body><article-card>Card</article-card><main><h1>Report</h1><p>Results</p></main><p>Unrelated links</p></body></html>";
    expect(htmlToMarkdown(html)).toBe("# Report\n\nResults\n");
  });
  it("reads the same content whatever letters come before it (İ is longer in lowercase)", () => {
    expect(htmlToMarkdown("<main>İİİİ<p>text</p></main><footer>foot</footer>")).toBe("İİİİ\n\ntext\n");
    expect(htmlToMarkdown("<p>İİİİİİİİİİİİ</p><article><h1>İstanbul</h1><p>See here</p><pre>a\nb</pre><script>x</script><p>After</p></article><p>outside</p>")).toBe(
      "# İstanbul\n\nSee here\n\n```\na\nb\n```\n\nAfter\n",
    );
    expect(htmlToMarkdown(`<p>${"İ".repeat(20)}</p><script>x</script><!-- <p>draft</p> --><p>Kept</p>`)).toBe(`${"İ".repeat(20)}\n\nKept\n`);
  });
  it("takes the title from the first <title> that is closed, not from a comment", () => {
    expect(htmlToMarkdown("<head><!-- <title>Old</title> --><title>Plan | Site</title></head><body><p>Body</p><svg><title>icon</title></svg></body>")).toBe("# Plan\n\nBody\n");
    expect(htmlToMarkdown("<head><TITLE>Notes</TITLE ></head><p>Body</p>")).toBe("# Notes\n\nBody\n");
  });
  it("leaves the head out, but not a <header>", () => {
    expect(htmlToMarkdown("<head><style>p{}</style><meta name=x>Stray</head><article><header><h1>T</h1></header><p>Body</p></article>")).toBe("# T\n\nBody\n");
  });

  it("keeps what well-formed markup meant", () => {
    const html = `<h2>Plan</h2><ul><li>One<li>Two</ul><div class="ad">Buy</div><p>Kept</p><pre>a\n  b</pre><h3>Next</h3>`;
    expect(htmlToMarkdown(html)).toBe("## Plan\n\n- One\n- Two\n\nKept\n\n```\na\n  b\n```\n\n### Next\n");
  });
});
