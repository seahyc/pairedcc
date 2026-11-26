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
  const stray: number[] = [];
  let pending = -1;
  for (let i = 0; i < html.length; i++) {
    const c = html.charCodeAt(i);
    if (c === 60) {
      if (pending >= 0) stray.push(pending);
      pending = i;
    } else if (c === 62) pending = -1;
  }
  if (pending >= 0) stray.push(pending);
  if (!stray.length) return html;
  let out = "", from = 0;
  for (const i of stray) {
    out += html.slice(from, i) + "&lt;";
    from = i + 1;
  }
  return out + html.slice(from);
}

/** Comments out, in one pass; an unclosed one runs to the end, as a browser reads it. */
function dropComments(html: string) {
  let out = "", from = 0;
  for (let start = html.indexOf("<!--"); start >= 0; start = html.indexOf("<!--", from)) {
    const end = html.indexOf("-->", start + 4);
    out += html.slice(from, start);
    if (end < 0) return out;
    from = end + 3;
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
  body = replaceElements(body, "h[1-6]", (name, inner) => `\n\n${"#".repeat(Number(name[1]))} ${inline(inner)}\n\n`);
  body = replaceElements(closeListItems(body), "li", (_, inner) => `\n- ${inline(inner)}\n`)
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
