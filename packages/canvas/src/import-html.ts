import { decodeEntities } from "./import-parse";

// A web page (a saved .html file, or a copied stretch of one) as markdown, so it goes through the
// same section reader as a markdown file: headings stay headings, lists stay lists, and what is
// not the content (navigation, scripts, styles, asides, adverts, forms, the footer) is left out.
//
// One pass over the tags, in order, so the time grows with the page's length however badly its
// tags are closed (a page of 50,000 unclosed <li> or advert <div> reads in a moment).

/** Left out with everything inside them. */
const DROP = new Set(["script", "style", "noscript", "template", "svg", "iframe", "object", "nav", "aside", "form", "button", "select", "textarea", "footer", "figure"]);
/** Their text is never page text, so they end at their own closing tag even when nested tags are not closed. */
const RAW = new Set(["script", "style", "textarea", "template"]);
/** Left out too when there is no <article> or <main> to say where the content is. */
const CHROME = "header";
const BLOCK = new Set(["p", "div", "section", "blockquote", "ul", "ol", "table", "tr", "dl", "dt", "dd", "hr", "br", "header", "main", "article", "li", "pre"]);
const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr"]);
const AD_CLASS = /\bclass\s*=\s*["'][^"']*\b(ad|ads|advert|advertisement|byline|share|cookie)\b/i;

/** Comments removed in one pass; an unclosed comment runs to the end, as in a browser. */
function stripComments(text: string) {
  let out = "", at = 0;
  for (;;) {
    const open = text.indexOf("<!--", at);
    if (open < 0) return out + text.slice(at);
    out += text.slice(at, open);
    const close = text.indexOf("-->", open + 4);
    if (close < 0) return out;
    at = close + 3;
  }
}

/** Lowercase A to Z only, so every index matches the original text (Unicode lowercasing can change length, as İ does). */
const asciiLower = (text: string) => text.replace(/[A-Z]+/g, (m) => m.toLowerCase());

const clean = (text: string) => decodeEntities(text).replace(/[\s ]+/g, " ").trim();

/** The content of a page or fragment as markdown. */
export function htmlToMarkdown(html: string): string {
  const titleAt = html.search(/<title\b/i);
  const pageTitle = titleAt >= 0 ? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html.slice(titleAt, titleAt + 2000))?.[1] : undefined;
  // Comments and the head never hold the content, so they go before the content region is looked
  // for (an "<article>" written in a comment is not one).
  const source = stripComments(html).replace(/<head\b[\s\S]*?<\/head\s*>/i, "");
  const lowerSource = asciiLower(source);
  // The region that holds the content: the first <article> to the last </article>, else <main>.
  // A whole tag name only (not <article-card>), and only when it is closed.
  const region = (tag: string) => {
    const open = lowerSource.search(new RegExp(`<${tag}(?=[\\s>/])`));
    const end = lowerSource.lastIndexOf(`</${tag}>`);
    if (open < 0 || end < 0) return undefined;
    const start = lowerSource.indexOf(">", open) + 1;
    return start > 0 && end > start ? source.slice(start, end) : undefined;
  };
  const scoped = region("article") ?? region("main");
  let body = scoped;
  if (body === undefined) {
    const b = lowerSource.search(/<body(?=[\s>])/);
    body = b >= 0 ? source.slice(lowerSource.indexOf(">", b) + 1) : source;
  }
  const dropChrome = scoped === undefined;

  const blocks: string[] = [];
  let line = "", kind: "text" | "heading" | "item" = "text", level = 0;
  let para: string[] = [];
  const endLine = () => {
    const text = clean(line);
    if (text) para.push(kind === "item" ? `- ${text}` : text);
    line = "";
    kind = "text";
  };
  const endBlock = () => {
    endLine();
    if (para.length) blocks.push(para.join("\n"));
    para = [];
  };

  const lower = asciiLower(body);
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>|<!--[\s\S]*?-->/g;
  let at = 0, skip = 0, skipTag = "", adDivs = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(body))) {
    if (!skip && !adDivs) line += body.slice(at, match.index);
    at = tag.lastIndex;
    if (!match[2]) continue; // a comment
    const closing = match[1] === "/", name = match[2].toLowerCase(), attrs = match[3] ?? "";
    const selfClosing = attrs.trimEnd().endsWith("/") || VOID.has(name);
    // Raw-text elements end at their own closing tag; nothing inside them is a tag.
    if (!closing && RAW.has(name) && !selfClosing) {
      const end = lower.indexOf(`</${name}`, at);
      at = end < 0 ? body.length : body.indexOf(">", end) + 1 || body.length;
      tag.lastIndex = at;
      continue;
    }
    // Inside a left-out element: only its own nesting matters.
    if (skip) {
      if (name === skipTag && !selfClosing) skip += closing ? -1 : 1;
      continue;
    }
    if (adDivs) {
      if (name === "div" && !selfClosing) adDivs += closing ? -1 : 1;
      continue;
    }
    if (!closing && !selfClosing && (DROP.has(name) || (dropChrome && name === CHROME))) {
      skip = 1;
      skipTag = name;
      continue;
    }
    if (!closing && name === "div" && AD_CLASS.test(attrs)) {
      adDivs = 1;
      continue;
    }
    if (!closing && /^(p|span)$/.test(name) && AD_CLASS.test(attrs)) {
      // A byline or share line: left out up to its end, when it has one close by.
      // Searched only within a short window, so many unclosed bylines cannot each scan to the end.
      const near = lower.slice(at, at + 5000).indexOf(`</${name}>`);
      const end = near < 0 ? -1 : at + near;
      if (end >= 0) {
        at = end + name.length + 3;
        tag.lastIndex = at;
      }
      continue;
    }
    if (name === "pre" && !closing) {
      endBlock();
      const end = lower.indexOf("</pre>", at);
      const code = decodeEntities(body.slice(at, end < 0 ? body.length : end).replace(/<[^>]*>/g, "")).replace(/\n$/, "");
      if (code.trim()) blocks.push(`\`\`\`\n${code}\n\`\`\``);
      at = end < 0 ? body.length : end + 6;
      tag.lastIndex = at;
      continue;
    }
    const heading = /^h([1-6])$/.exec(name);
    if (heading) {
      if (!closing) {
        endBlock();
        kind = "heading";
        level = Number(heading[1]);
      } else if (kind === "heading") {
        const text = clean(line);
        if (text) blocks.push(`${"#".repeat(level)} ${text}`);
        line = "";
        kind = "text";
      }
      continue;
    }
    if (name === "li") {
      if (!closing) {
        // A new item ends the one before it, closed or not; items of one list stay one block.
        endLine();
        kind = "item";
      } else endLine();
      continue;
    }
    if (name === "ul" || name === "ol") {
      endBlock();
      continue;
    }
    if (name === "br") {
      line += " ";
      continue;
    }
    if (BLOCK.has(name)) endBlock();
  }
  if (!skip && !adDivs) line += body.slice(at);
  if (kind === "heading") {
    const text = clean(line);
    if (text) blocks.push(`${"#".repeat(level)} ${text}`);
    line = "";
    kind = "text";
  }
  endBlock();

  let markdown = blocks.join("\n\n");
  if (!/^# /m.test(markdown) && pageTitle && clean(pageTitle)) markdown = `# ${clean(pageTitle).replace(/\s+[|·–—-]\s+[^|·–—-]+$/, "")}\n\n${markdown}`;
  return markdown.trim() + "\n";
}
