// Writes the synthetic import fixtures. Everything here is invented: Larkspur Ferries is
// not a real company and the review is not a real review. Run: node build-fixtures.mjs
import { writeFileSync } from "node:fs";
import { deflateRawSync, deflateSync } from "node:zlib";

const here = new URL("./", import.meta.url);
const title = "Adversarial review: Larkspur Ferries funding pack (draft 3)";
const note = "Read as a sceptical assessor would. Mark each row in the last column once checked.";
const header = ["No.", "Q", "Topic", "How a sceptical reader would attack this", "What the pack already says in defence", "Gap / exposure", "Suggested fix", "Severity", "Check"];
const rows = [
  [1, "Q12", "Passenger forecast basis", "“You forecast 410,000 passengers in year two, yet the only evidence is one summer survey of 300 people at a single pier. Why should anyone believe the winter numbers?”", "Q12 cites the 2023 pier survey and a regional tourism growth figure of 4%.", "No winter data, no sensitivity range and no comparison with a similar route elsewhere.", "Add a low, central and high case, state the winter assumption plainly and cite one comparable route with its actual figures.", "High"],
  [2, "Q56 vs Q16/Q49", "Fleet cost inconsistency", "“Q56 says two vessels cost 9.2m in total, Q16 budgets 8.1m and Q49 mentions a third hull. Which is it, and does the board know the figures disagree?”", "Q56 gives the supplier quote; Q16 was written before the quote arrived.", "Three answers give three different totals, which reads as a pack nobody checked end to end.", "Pick the supplier quote as the single source, correct Q16 and Q49 to match it, and add one table reconciling all fleet costs.", "Critical"],
  [3, "Q7", "Safety certification", "“You say certification is in hand, but name no certifying body, no date and no fallback if the inspection fails. In hand could mean anything.”", "Q7 states that the operator holds a current licence for its existing route.", "The new vessels need their own certification and the pack is silent on timing.", "Name the certifying body, give the booked inspection window and say what happens to the launch date if it slips.", "Critical"],
  [4, "Q23", "Fare affordability claim", "“A 6.50 single fare is called affordable for commuters, with no reference to local wages or to what the bus costs for the same journey.”", "Q23 compares the fare with the tourist cruise price of 14.00.", "The comparison is with a leisure product, not with the commuter alternative.", "Compare the fare with the bus and rail price for the same journey and with median local hourly pay.", "Medium"],
  [5, "Q31", "Staffing plan", "“Forty-two crew are needed by launch and you currently employ nine. Where do thirty-three qualified crew come from in a region with a known shortage?”", "Q31 describes a training partnership with the harbour college.", "The college course takes eighteen months and launch is in eleven.", "Show the recruitment pipeline by month, including agency cover for the gap, and its cost.", "High"],
  [6, "Q40/Q41", "Environmental benefit", "“The carbon saving assumes every passenger would otherwise drive alone. That is the most flattering assumption available and you have not defended it.”", "Q40 uses the national average car emissions figure.", "No evidence on what passengers actually do today; the saving could be half the stated figure.", "Use the survey's own travel-mode split, and present the saving as a range with the method in an annex.", "Medium"],
  [7, "Q18", "Match funding status", "“Is the 2.4m match funding committed or merely hoped for? The wording moves between secured, expected and in discussion across three pages.”", "Q18 lists the funders and amounts in a table.", "Only one of the three funders has signed; the table does not say so.", "Add a status column to the funders table with the date of each signed letter, and use one word consistently.", "Critical"],
  [8, "Q9", "Governance and oversight", "“The project board meets quarterly. On a build this size that means a problem can run for three months before anyone senior hears of it.”", "Q9 names the board members and their experience.", "No description of what is reported between meetings or who can stop spending.", "Describe the monthly report, the escalation route and the spending limit above which the board must approve.", "Medium"],
  [9, "Q62", "Terminal lease", "“Your whole timetable depends on a terminal you do not own, on a lease that ends two years before the loan does.”", "Q62 notes a good relationship with the port authority.", "A good relationship is not an option to renew; the lease end date is absent from the risk register.", "Seek a written option to renew, add the lease to the risk register and state the fallback pier.", "High"],
  [10, "Q3", "Benefit to residents", "“The summary promises jobs for local people but the pack never defines local or commits to a number.”", "Q3 estimates 60 jobs in total across the operation.", "No definition, no target and no way to check afterwards.", "Define local by postcode area, commit to a share of roles and say how it will be reported each year.", "Medium"],
].map((r) => [...r.map(String), ""]);

// A spreadsheet quotes a cell only when it holds a tab, a line break or a quote.
const cell = (v, d) => (new RegExp(`["\\n${d}]`).test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const text = (d) => [[title], [note], header, ...rows].map((r) => r.map((v) => cell(v, d)).join(d)).join("\r\n") + "\r\n";
writeFileSync(new URL("review.tsv", here), text("\t"));
writeFileSync(new URL("review.csv", here), text(","));

// The shape Google Sheets puts on the clipboard as text/html.
const esc = (v) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "<br>");
const td = (v, extra = "") => `<td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:top;${extra}">${esc(v)}</td>`;
const html =
  `<meta charset='utf-8'><google-sheets-html-origin><style type="text/css"><!--td {border: 1px solid #cccccc;}br {mso-data-placement:same-cell;}--></style>` +
  `<table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1" style="table-layout:fixed;font-size:10pt;font-family:Arial;width:0px;border-collapse:collapse;border:none" data-sheets-root="1"><colgroup>${header.map(() => `<col width="160"/>`).join("")}</colgroup><tbody>` +
  `<tr style="height:21px;"><td style="font-weight:bold;" colspan="9">${esc(title)}</td></tr>` +
  `<tr style="height:21px;"><td style="font-style:italic;" colspan="9">${esc(note)}</td></tr>` +
  `<tr style="height:21px;">${header.map((h) => td(h, "font-weight:bold;")).join("")}</tr>` +
  rows.map((r) => `<tr style="height:21px;">${r.map((v) => td(v)).join("")}</tr>`).join("") +
  `</tbody></table>`;
writeFileSync(new URL("review.html", here), html + "\n");

// A grid of numbers: this should stay a table.
const routes = ["Harbour to Eastpoint", "Harbour to Saltmarsh", "Eastpoint to Lighthouse", "Saltmarsh loop", "Night shuttle", "Island summer service"];
const metrics = [["Route", "Sailings per day", "Passengers 2024", "Passengers 2025", "Load factor", "Fare", "Cost per sailing"]];
routes.forEach((route, i) => metrics.push([route, 8 + i * 3, 41200 + i * 7350, 44800 + i * 8120, `${52 + i * 5}%`, (4.5 + i * 0.5).toFixed(2), 310 + i * 45].map(String)));
writeFileSync(new URL("metrics.csv", here), metrics.map((r) => r.join(",")).join("\n") + "\n");

// Quoted fields, embedded commas, doubled quotes and a line break inside a cell.
writeFileSync(
  new URL("quoted.csv", here),
  `id,comment,owner\n1,"Said ""not yet"", then agreed, reluctantly",Mina\n2,"First line\nsecond line",Tomas\n3,plain,"Okafor, R."\n`,
);

writeFileSync(
  new URL("findings.json", here),
  JSON.stringify(
    rows.slice(0, 4).map((r) => ({ id: Number(r[0]), section: r[1], topic: r[2], objection: r[3], severity: r[7], checked: null })),
    null,
    2,
  ) + "\n",
);

writeFileSync(
  new URL("notes.md", here),
  `# Larkspur Ferries: route review notes

## What the route is for

The harbour crossing saves a **forty minute** drive around the estuary. Most weekday passengers are commuters to the Eastpoint yards; at weekends the boats carry visitors to the lighthouse.

The operator wants a second vessel so that a breakdown no longer stops the service.

## What worries the assessors

- The winter passenger numbers rest on one summer survey.
- Three answers in the pack give three different fleet costs.
- The terminal lease ends before the loan does.

## What to do next

Reconcile the fleet costs first, because every other figure depends on them. Then ask the [port authority](https://example.com/port) for a written option to renew.

\`\`\`
total = vessels + fit-out + contingency
\`\`\`
`,
);

// A small striped PNG for the image drop.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => (buf.reduce((c, b) => crcTable[(c ^ b) & 0xff] ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc(body), body.length + 4);
  return out;
};
const W = 96, H = 64, raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const on = Math.floor((x + y) / 12) % 2, at = y * (W * 3 + 1) + 1 + x * 3;
    raw[at] = on ? 0x2f : 0xe8;
    raw[at + 1] = on ? 0x6f : 0xe4;
    raw[at + 2] = on ? 0x8f : 0xd8;
  }
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr.set([8, 2, 0, 0, 0], 8);
writeFileSync(new URL("swatch.png", here), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
// The same review as an Excel workbook (.xlsx): a zip of XML parts, written by hand so the
// fixture needs no spreadsheet program. Sheet 1 is the review: text cells use the shared
// string table (one with two formatted runs), the No. column is numeric, one cell is an inline
// string, and the empty Check column has no cells at all, as Excel writes it. Sheet 2 is
// ignored by the importer. Fixed timestamps keep the bytes the same on every run.
const xml = (v) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i) => (i >= 26 ? colName(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));
const shared = [];
const sharedIndex = (v) => (shared.includes(v) ? shared.indexOf(v) : shared.push(v) - 1);
const sheetRows = [[title], [note], header, ...rows];
const sheetXml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
  sheetRows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          const ref = `${colName(ci)}${ri + 1}`;
          if (v === "") return "";
          if (ri >= 3 && ci === 0) return `<c r="${ref}"><v>${v}</v></c>`;
          if (ri === 4 && ci === 2) return `<c r="${ref}" t="inlineStr"><is><t>${xml(v)}</t></is></c>`;
          return `<c r="${ref}" t="s"><v>${sharedIndex(v)}</v></c>`;
        })
        .join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("") +
  `</sheetData></worksheet>`;
const richTitle = shared.indexOf(title);
const sharedXml =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">` +
  shared
    .map((v, i) =>
      i === richTitle
        ? `<si><r><rPr><b/></rPr><t xml:space="preserve">${xml(v.slice(0, 20))}</t></r><r><t xml:space="preserve">${xml(v.slice(20))}</t></r></si>`
        : `<si><t xml:space="preserve">${xml(v)}</t></si>`,
    )
    .join("") +
  `</sst>`;
const parts = {
  "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
  "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Review" sheetId="1" r:id="rId1"/><sheet name="Scratch" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  "xl/sharedStrings.xml": sharedXml,
  "xl/worksheets/sheet1.xml": sheetXml,
  "xl/worksheets/sheet2.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>not this sheet</t></is></c></row></sheetData></worksheet>`,
};
const zip = (files) => {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), packed = deflateRawSync(data), nameBuf = Buffer.from(name), sum = crc(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x5b21, 12); local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0x5b21, 14); central.writeUInt32LE(sum, 16); central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
};
writeFileSync(new URL("review.xlsx", here), zip(parts));
console.log("fixtures written");
