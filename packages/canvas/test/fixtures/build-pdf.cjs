// Writes notes.pdf: the synthetic notes.md, printed to PDF by headless Chromium, so the PDF
// reader is tested against a real producer's output (embedded subset fonts, ToUnicode maps,
// compressed content streams), not a hand-made file. Everything in it is invented.
// Run from a directory where playwright is installed: node <repo>/packages/canvas/test/fixtures/build-pdf.cjs
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd()] }));
const { join } = require("node:path");
const html = `<!doctype html><meta charset="utf-8"><title>Route review notes</title>
<body style="font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.4">
<h1>Larkspur Ferries: route review notes</h1>
<h2>What the route is for</h2>
<p>The harbour crossing saves a <b>forty minute</b> drive around the estuary. Most weekday passengers are commuters to the Eastpoint yards; at weekends the boats carry visitors to the lighthouse.</p>
<p>The operator wants a second vessel so that a breakdown no longer stops the service.</p>
<h2>What worries the assessors</h2>
<ul><li>The winter passenger numbers rest on one summer survey.</li><li>Three answers in the pack give three different fleet costs.</li><li>The terminal lease ends before the loan does.</li></ul>
<h2>What to do next</h2>
<p>Reconcile the fleet costs first, because every other figure depends on them. Then ask the port authority for a written option to renew.</p>
${"<p>Filler paragraph so the document runs onto a second page. ".repeat(1)}${"The assessors will read every page, so the reader must keep the order across pages. ".repeat(12)}</p>
<h2>Second page heading</h2>
<p>This section starts after the page break and must come last.</p>
</body>`;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html.replace("<h2>Second page heading</h2>", '<h2 style="break-before: page">Second page heading</h2>'));
  await page.pdf({ path: join(__dirname, "notes.pdf"), format: "A4", margin: { top: "20mm", bottom: "20mm", left: "20mm", right: "20mm" } });
  await browser.close();
  console.log("notes.pdf written");
})();
