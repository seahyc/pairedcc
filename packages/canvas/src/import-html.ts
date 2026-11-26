import { decodeEntities } from "./import-parse";

// A web page (a saved .html file, or a copied stretch of one) as markdown, so it goes through the
// same section reader as a markdown file: headings stay headings, lists stay lists, and what is
// not the content (navigation, scripts, styles, asides, adverts, forms, the footer) is left out.

/** Removed with everything inside them, wherever they are. */
const ALWAYS_DROP = ["script", "style", "noscript", "template", "svg", "iframe", "object", "nav", "aside", "form", "button", "select", "textarea", "footer", "figure"];
/** Removed too when there is no <article> or <main> to say where the content is. */
const CHROME = ["header"];

function dropBlocks(html: string, tags: readonly string[]) {
  let out = html;
  for (const tag of tags) {
    // Innermost first, until none are left, so nested blocks of the same tag go too.
    const pattern = new RegExp(`<${tag}\\b[^>]*>(?:(?!<${tag}\\b)[\\s\\S])*?<\\/${tag}>`, "gi");
    for (let guard = 0; guard < 20 && pattern.test(out); guard++) out = out.replace(pattern, "\n");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/>`, "gi"), "");
  }
  return out;
}

const inline = (html: string) =>
  decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, ""))
    .replace(/[\s ]+/g, " ")
    .trim();

/** The content of a page or fragment as markdown. */
export function htmlToMarkdown(html: string): string {
  const pageTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  let body = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<head\b[\s\S]*?<\/head>/i, "");
  const region = /<article\b[^>]*>([\s\S]*)<\/article>/i.exec(body)?.[1] ?? /<main\b[^>]*>([\s\S]*)<\/main>/i.exec(body)?.[1];
  body = region ?? /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(body)?.[1] ?? body;
  body = dropBlocks(body, region ? ALWAYS_DROP : [...ALWAYS_DROP, ...CHROME]);
  // Elements hidden by an obvious advert or byline class are not the content.
  body = body.replace(/<(div|p|span)\b[^>]*class\s*=\s*["'][^"']*\b(ad|ads|advert|advertisement|byline|share|cookie)\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, "\n");

  const blocks: string[] = [];
  const code: string[] = [];
  // Preformatted text keeps its own lines; it is set aside and put back as a fenced block.
  body = body.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) => {
    code.push(decodeEntities(inner.replace(/<[^>]+>/g, "")).replace(/\n$/, ""));
    return `\n\u0000${code.length - 1}\u0000\n`;
  });
  body = body
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => `\n\n${"#".repeat(Number(level))} ${inline(inner)}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) => `\n- ${inline(inner)}\n`)
    .replace(/<\/?(p|div|section|blockquote|ul|ol|table|tr|dl|dt|dd|hr|br)\b[^>]*>/gi, "\n\n");
  // Items of one list stay one block.
  for (let guard = 0; guard < 500 && /(\n- [^\n]*)\n[ \t]*(\n[ \t]*)+(?=- )/.test(body); guard++) body = body.replace(/(\n- [^\n]*)\n[ \t]*(\n[ \t]*)+(?=- )/g, "$1\n");
  for (const raw of body.split(/\n{2,}/)) {
    const lines = raw
      .split("\n")
      .map((line) => {
        const placeholder = /^\u0000(\d+)\u0000$/.exec(line.trim());
        if (placeholder) return `\`\`\`\n${code[Number(placeholder[1])]}\n\`\`\``;
        if (/^#{1,6} /.test(line) || /^- /.test(line)) return line;
        return inline(line);
      })
      .filter((line) => line.trim());
    if (lines.length) blocks.push(lines.join("\n"));
  }
  let markdown = blocks.join("\n\n");
  if (!/^# /m.test(markdown) && pageTitle && inline(pageTitle)) markdown = `# ${inline(pageTitle).replace(/\s+[|·–—-]\s+[^|·–—-]+$/, "")}\n\n${markdown}`;
  return markdown.trim() + "\n";
}
