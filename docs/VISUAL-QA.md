# Visual QA record

Inspection date: 2026-09-06. Reviewer: Codex document subagent. These are synthetic ordinary-case artifacts. This review covers actual rendered page images, not only text extraction. It does not establish professional or legal approval or benchmark reliability.

## Board packet

Source run: `932cbe33-8526-47e7-af02-d7a7afa9cafa`.

Artifact: `output/932cbe33-8526-47e7-af02-d7a7afa9cafa/generation-ebd75ac8-ce49-4d36-bddb-df1294c022c8/output/board_packet.pdf`.

SHA-256: `32acde02ba670471d16735e0a30a8337c97c5c493d10320a57b9aaf57c2ae979`.

Rendered with local Poppler at 130 DPI. Inspected the entire single-page image at `output/visual-qa/board/page-1.png` using the image viewer.

Result: readable title and body, no clipped text, missing glyphs, overlap, or off-page table content. Financial values, participant/session metrics, and both retained risk rows are visible. The risk table follows the variance table closely but remains readable. Source IDs are fully visible; resolving them requires the accompanying run manifest/evidence. This is a utility report, not a branded board-packet design.

## Grant narrative

Model evidence source run: `f33da122-c07a-4335-b61c-197e95515eff`.

Original artifact: `output/f33da122-c07a-4335-b61c-197e95515eff/generation-2141b381-9f97-4d98-8418-0091d513623f/application/narrative.docx`.

Rendered through the document skill's `render_docx.py`, using bundled Python and LibreOffice. Inspected every page (one) at `output/visual-qa/grant/page-1.png`.

Initial findings: no clipping, but duplicated requirement prefixes (`R1 R1:`) and inherited blue title text/border. Corrected the domain formatter to emit one requirement ID, and the reusable DOCX renderer to use a black title without a border.

Final deterministic regeneration: `output/visual-qa/final-grant/application/narrative.docx`. This regeneration reuses the accepted model evidence from the source run; it makes no inference calls and is not counted as another model benchmark. Its nine domain gates pass, recorded in `output/visual-qa/final-grant/result.json`.

Inspected the entire final page at `output/visual-qa/final-grant/render-docx/page-1.png`. Result: black title, no decorative rule, single R1/R2/R3 prefixes, legible source references, no clipping or overlap. The short application fits on one page with ample whitespace. The content remains a synthetic three-requirement demonstration, not a real completed funder submission.

## Grant budget workbook

Original artifact: `output/f33da122-c07a-4335-b61c-197e95515eff/generation-2141b381-9f97-4d98-8418-0091d513623f/application/budget.xlsx`.

Opened with bundled LibreOffice Calc through its PDF export, then rendered with Poppler. Inspected `output/visual-qa/budget/page-1.png`. Original default column widths visibly clipped category and fund labels.

Corrected reusable XLSX rendering with content-based column widths, wrapped rows, differentiated headers, frozen header row, and print-to-page-width settings. Native cell types and amounts remain unchanged.

Final workbook: `output/visual-qa/final-grant/application/budget.xlsx`. Inspected its entire single-page print rendering at `output/visual-qa/final-grant/render-xlsx/page-1.png`. Result: `direct_service`, `administration`, `restricted`, and `unrestricted` display fully; amounts 18000 and 2000 and the 20000 total are readable and aligned. No overflow or clipping remains. Native-file round-trip and OCR integration tests also pass (four document tests).

## Boundaries

- Historical run artifacts remain immutable and retain their initial formatting. The deterministic rerender demonstrates corrected rendering; subsequent workflow runs use the corrected renderer.
- QA intermediates reside under ignored `output/visual-qa/` and are not packaged as user deliverables.
- Only these representative ordinary-case native documents were visually inspected. This is not a claim that every held-out artifact, large workbook, or long report has been visually reviewed.
- No cloud inference, paid API calls, model downloads, or external publication were used for this review.
