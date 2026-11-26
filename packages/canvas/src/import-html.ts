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

/**
 * Like `html.replace(/<(names)\b(attrs)>([\s\S]*?)<\/\1>/gi, fn)`, each element ending at the next
 * close of its own name, but in one pass: an opener with no close after it is left as it is
 * instead of rescanning the rest of the page (which made unclosed tags quadratic). Openers
 * `keep` rejects are passed over, as the regex would never have matched them.
 */
function replaceElements(html: string, names: string, fn: (name: string, inner: string) => string, keep: (attrs: string) => boolean = () => true) {
  const closes = new Map<string, number[]>();
  for (const m of html.matchAll(new RegExp(`<\\/(${names})\\s*>`, "gi"))) {
    const key = m[1].toLowerCase();
    if (!closes.has(key)) closes.set(key, []);
    closes.get(key)!.push(m.index);
  }
  const next = new Map<string, number>();
  let out = "", cursor = 0;
  for (const m of html.matchAll(new RegExp(`<(${names})\\b([^>]*)>`, "gi"))) {
    if (m.index < cursor || !keep(m[2])) continue;
    const key = m[1].toLowerCase(), list = closes.get(key) ?? [], start = m.index + m[0].length;
    let i = next.get(key) ?? 0;
    while (i < list.length && list[i] < start) i++;
    next.set(key, i);
    if (i === list.length) continue;
    const end = list[i], closeLength = html.indexOf(">", end) + 1 - end;
    out += html.slice(cursor, m.index) + fn(key, html.slice(start, end));
    cursor = end + closeLength;
  }
  return out + html.slice(cursor);
}

/** An <li> left open ends where the next item or its list does, as a browser reads it. */
function closeListItems(html: string) {
  const open: boolean[] = [false];
  return html.replace(/<(\/?)(li|ul|ol)\b[^>]*>/gi, (tag, slash: string, name: string) => {
    const kind = name.toLowerCase();
    if (kind === "li") {
      if (slash) {
        open[open.length - 1] = false;
        return tag;
      }
      const before = open[open.length - 1] ? "</li>" : "";
      open[open.length - 1] = true;
      return before + tag;
    }
    if (!slash) {
      open.push(false);
      return tag;
    }
    const before = open[open.length - 1] ? "</li>" : "";
    if (open.length > 1) open.pop();
    else open[0] = false;
    return before + tag;
  });
}

/** The inside of the first <tag>…last </tag>, without a search that rescans for every opener. */
function region(html: string, tag: string) {
  const close = html.toLowerCase().lastIndexOf(`</${tag}`);
  if (close < 0) return undefined;
  const open = new RegExp(`<${tag}\\b[^>]*>`, "i").exec(html);
  return open && open.index + open[0].length <= close ? html.slice(open.index + open[0].length, close) : undefined;
}

/**
 * A "<" with no ">" before the next "<" is text, not a tag; escaping it first means every tag
 * pattern below stops at the next "<", so none can rescan the rest of the page from each one.
 */
function escapeStrayAngles(html: string) {
  const fixes: [number, string][] = [];
  let pending = -1, quote = 0;
  for (let i = 0; i < html.length; i++) {
    const c = html.charCodeAt(i);
    if (quote) {
      // Inside a quoted attribute value "<" and ">" are text: escape them so no tag pattern stops there.
      if (c === quote) quote = 0;
      else if (c === 60) fixes.push([i, "&lt;"]);
      else if (c === 62) fixes.push([i, "&gt;"]);
      continue;
    }
    if (c === 60) {
      if (pending >= 0) fixes.push([pending, "&lt;"]);
      pending = i;
    } else if (c === 62) pending = -1;
    else if (pending >= 0 && (c === 34 || c === 39) && /=\s*$/.test(html.slice(Math.max(pending, i - 8), i))) quote = c;
  }
  if (pending >= 0) fixes.push([pending, "&lt;"]);
  if (!fixes.length) return html;
  fixes.sort((a, b) => a[0] - b[0]);
  let out = "", from = 0;
  for (const [i, text] of fixes) {
    out += html.slice(from, i) + text;
    from = i + 1;
  }
  return out + html.slice(from);
}

/** Elements whose contents are text to a browser, never tags or comments. */
const RAW_TEXT = /<!--|<(script|style|textarea|title|template|noscript|xmp)\b/gi;

/**
 * Comments out, in one pass; an unclosed one runs to the end, as a browser reads it. A "<!--"
 * inside a script or style (a legacy idiom) is not a comment, so those are stepped over.
 */
function dropComments(html: string) {
  const lower = html.toLowerCase();
  let out = "", from = 0;
  RAW_TEXT.lastIndex = 0;
  for (let m = RAW_TEXT.exec(html); m; m = RAW_TEXT.exec(html)) {
    if (m[1]) {
      const close = lower.indexOf(`</${m[1].toLowerCase()}`, m.index + m[0].length);
      if (close < 0) break;
      RAW_TEXT.lastIndex = close;
      continue;
    }
    const end = html.indexOf("-->", m.index + 4);
    out += html.slice(from, m.index);
    if (end < 0) return out;
    from = end + 3;
    RAW_TEXT.lastIndex = from;
  }
  return out + html.slice(from);
}

const AD_CLASS = /class\s*=\s*["'][^"']*\b(ad|ads|advert|advertisement|byline|share|cookie)\b[^"']*["']/i;

const inline = (html: string) =>
  decodeEntities(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, ""))
    .replace(/[\s ]+/g, " ")
    .trim();

/** The content of a page or fragment as markdown. */
export function htmlToMarkdown(html: string): string {
  const pageTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  let body = escapeStrayAngles(dropComments(html));
  const headEnd = body.search(/<\/head\s*>/i);
  if (headEnd >= 0) body = body.replace(/<head\b[\s\S]*?<\/head\s*>/i, "");
  const content = region(body, "article") ?? region(body, "main");
  body = content ?? region(body, "body") ?? body;
  body = dropBlocks(body, content ? ALWAYS_DROP : [...ALWAYS_DROP, ...CHROME]);
  // Elements hidden by an obvious advert or byline class are not the content.
  body = replaceElements(body, "div|p|span", () => "\n", (attrs) => AD_CLASS.test(attrs));

  const blocks: string[] = [];
  const code: string[] = [];
  // Preformatted text keeps its own lines; it is set aside and put back as a fenced block.
  body = replaceElements(body, "pre", (_, inner) => {
    code.push(decodeEntities(inner.replace(/<[^>]+>/g, "")).replace(/\n$/, ""));
    return `\n\u0000${code.length - 1}\u0000\n`;
  });
  // Decoded text (an escaped "&lt;li&gt;" in a heading) must not be read as markup by later passes.
  const shield = (text: string) => text.replace(/</g, "\u0002").replace(/>/g, "\u0003");
  body = replaceElements(body, "h[1-6]", (name, inner) => `\n\n${"#".repeat(Number(name[1]))} ${shield(inline(inner))}\n\n`);
  body = replaceElements(closeListItems(body), "li", (_, inner) => `\n- ${shield(inline(inner))}\n`)
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
  return markdown.replace(/\u0002/g, "<").replace(/\u0003/g, ">").trim() + "\n";
}
