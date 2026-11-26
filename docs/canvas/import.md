# Import and paste

Structured material should arrive on the board as something a person can think with, not as a blob. The case behind this: a spreadsheet tab holding an adversarial review, ten rows, each row one argument (the attack, the defence already made, the gap, the suggested fix, a severity, an empty column for the reader's verdict). In a grid you cannot see one argument whole, compare two, mark a verdict where your eyes are or keep your own notes beside a row.

The numbers in brackets are the nine findings in [`principles.md`](principles.md).

## How to bring something in

- **Paste** (⌘V) on the board. A copied spreadsheet range is read from the clipboard's HTML table, or from its tab-separated text when there is no table. Several paragraphs of text become a document.
- **Drop** a file on the board, or use **Menu → Import a file**.
- An agent calls `canvas_import` (operation `import`).

All of these run the same importer. No dialog is shown. A short summary appears afterwards ("10 records from paste, as cards, most severe first") with **Show as table instead** and **Undo**.

## The rules

| Rule | What happens | Serves |
|---|---|---|
| Rows of prose become cards; grids of numbers stay tables | A table is read column by column. If any column holds sentence-length text (about 50 characters on average, or a cell of 90 or more with six or more words), the rows are records and each becomes one cluster. Otherwise it stays one compact read-only table. Prose becomes one card per heading section, or per paragraph when there are no headings, in reading order. A picture becomes an image. | 4 (seen, not read), 5 (the concrete case first) |
| One record, seen whole | Short identifying columns (No., Q, Topic) form the title line. A column with a few repeated short values (Severity) becomes a chip. Each long column becomes its own card, labelled with the column name, left to right in column order, four to a row at most. | 1 (about four things), 6 (the attack beside the defence beside the gap) |
| The verdict is yours, on the board | A column that is empty under its header (such as "Check") is not drawn. The import says so, and pick (P), cross out (X) and comment (C) are the verdict. A comment on a card inside a record sits beside the record. | 7 (the next actions are offered), 9 (the judging is the person's work) |
| Not ten things at once | Records are laid out in one column with clear space between them, most severe first when a column says how severe each is (critical, high, medium, low and similar words; ties keep the source order). The view goes to the heading and the first one or two records. J / K (or ] / [, or the stepper at the bottom) select and zoom to the next and previous record, so a verdict key lands on the record being read. The stepper shows "3 of 10" and how many are judged. | 1, 4 |
| Moving things is thinking | Everything imported is an ordinary object: it drags, edits, deletes, and can be picked, crossed out, commented on and asked about. A record's cards are grouped, so the cluster moves together; double-click to work on one card. The whole import is one undo step. | 2, 3 |
| Compare two side by side | Select two records of one import (shift-click the second) and press **Side by side** on the selection bar, which offers it only for two records of one import. The lower record moves up to sit directly under the upper one, lined up, so each column's card sits over the same column's card. The records that were between them slide down, nothing else moves, and it is one undo step. The two stay selected, so an ask is about the pair. | 6 (comparing beats describing), 2 (moving things is thinking) |
| The source beside the claim | A record's short columns can cite question codes ("Q56 vs Q16/Q49"). When a document whose sections are headed by those codes ("## Q56. Supplier quote") is imported on the same page, selecting the record offers **Show Q56, Q16, Q49** on the selection bar. It moves those sections into one column just right of the record, top-aligned, in the order cited, clear of anything already there, each linked from the record by a reference arrow. One undo step; pressing it again re-gathers them without new arrows. A cited code with no section is named in a notice. | 6 (the claim beside its source), 5 (the concrete text, not a reference to it), 2 |
| Imported material has its own look | Plain print on off-white paper with a grey edge: not pink handwriting (you) and not lavender (an agent). Severity is the chip on the title line and the weight and colour of the cards' left edge, with a legend under the heading. | 4, 8 (print is finished material; yours stays rough) |
| Where it came from is recorded | Every imported object carries `meta.source`: `from` (file name, or `pasted`), `at` (time), `kind`, and for records `row`, `column` and the row's `values`. The heading states the source and time. | 4 |
| Ordinary paste is unchanged | One line or one paragraph of text pastes as it always did (one object). Pasting while typing in a card or a field goes into that text. | 2 |
| It works with Ask | Asking about a record gives the agent its title line and each field as `Column name: text`, marked as imported source with its row. The first starter for a record is "Is this point valid?". A table is given as tab-separated text. | 5, 9 (one record, one question, one short answer) |

Solveit's "the person sees exactly what the AI sees" holds: what the agent is given is the selected record's own text, with nothing hidden. Its small-steps rule holds because the stepper and the ask both work on one record at a time.

## Formats

| Format | Status |
|---|---|
| Clipboard: HTML table | Works for the shape Google Sheets puts on the clipboard (checked with a synthetic copy of it). Tables copied from Excel, Numbers or a web page go through the same reader but were not tried. |
| Clipboard: tab-separated or strictly rectangular comma-separated text, markdown table | Works |
| Clipboard: text of three or more paragraphs or two or more headings (400 characters or more) | Works, as section cards |
| Clipboard: a stretch copied from a web page | Works, as section cards with the page's headings, when the copied HTML has two or more headings (400 characters or more); the plain text alone would lose them. One copied paragraph still pastes as one object. |
| `.csv`, `.tsv` (quoted fields, doubled quotes, line breaks in cells; `;` is detected) | Works |
| `.md`, `.txt` | Works: headings, paragraphs, lists and code blocks; a file that is mostly one pipe table is read as a table |
| `.json` | Works for an array of objects, or an object holding exactly one such array |
| `.html` | The first table in the file, if it has one. Otherwise a web page: the content of its `<article>` or `<main>` (else its body) becomes section cards under its top heading or page title, with headings, paragraphs, lists and preformatted text kept, and navigation, scripts, styles, asides, figures, forms, adverts and the footer left out (`src/import-html.ts`). |
| Images | Works by drop, the file chooser or the existing image paste |
| `.xlsx` | Works, by drop or the file chooser: the first sheet's cell values become the same records or table as pasting that range (`src/xlsx.ts`, no dependency: the zip is read with the browser's own decompression). Formulas give their last computed value; dates stay Excel's serial numbers; merged cells are read as their first cell. A workbook with more sheets says only the first was read. A damaged file says it cannot be read. |
| `.xls`, `.numbers`, `.ods` | Not read. The canvas says only `.xlsx` is, and suggests saving as `.xlsx` or CSV or copying the cells. |
| PDF, Word, slides | Not read |

## Not handled yet

- A web page with a data table is read as that table, not as its prose. Pages that build their content with scripts, or mark it up without headings, come out as paragraphs or not at all.
- Older spreadsheet files (above), and sheets after the first in an `.xlsx` workbook. Only the first table of an HTML fragment is read; merged cells are read as their first cell.
- A table inside a longer markdown document is not drawn as a table; inline formatting (bold, links) is reduced to plain text.
- The import is placed below everything already on the board, not at the drop point. Images are placed at the drop point.
- Clusters are laid out from estimated card heights. Text never leaves its card, but spacing between clusters can be slightly uneven.
- A comment on a card in the middle of a record is joined to it by an arrow that crosses the cards to its right.
- "Show as table instead" replaces the import as a second undo step.
- The table object is read-only: no sorting, no editing cells, at most 200 rows drawn (2,000 kept).
- Detection is by column statistics and a fixed list of severity words. A table whose long text is under about 50 characters stays a table until "Show as cards instead" is used.
- Side by side moves the second record for good (undo takes it back); there is no "put back" once other edits follow, and the stepper still walks the original order.
- Citations are found only as letter-and-number codes (Q12, A3) in a record's short columns, matched to the code a section heading starts with. Page numbers, clause numbers such as 3.2 and citations inside the long text are not read. Sections move for good (undo takes them back), leaving a gap in the document's reading order.
- Records cannot yet be regrouped or re-sorted by another column, and a verdict cannot be exported back to the spreadsheet (the feedback queue export lists picks, crosses and comments).
- Pasted images are not marked with a source. Files over 2 MB are refused.
