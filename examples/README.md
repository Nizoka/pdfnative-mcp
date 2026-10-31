# Examples

43 executable `tools/call` sequences, one JSON file each: `{ "description", "tool", "arguments" }` for a single call, or `{ "description", "steps": [ { "tool", "arguments" }, … ] }` for a chain whose later steps take the earlier output. `npm run examples:check` (tests/examples.test.ts) runs every file live against the server; `npm run test:generate` renders them into the sample byte baseline (tests/_fixtures/samples.sha256.json). A new engine option gets an example here before it ships (tests/engine-surface.test.ts holds the matrix to the tree).

| File | Tools | What it shows |
|---|---|---|
| [african-languages.json](./african-languages.json) | `add_international_text` | Hausa, Yoruba, Igbo and Swahili (add_international_text v1.7.0 on pdfnative 1.8): these languages are written in Latin with combining marks — Yoruba ẹ́ ọ̀, Igbo |
| [annotate-pdf.json](./annotate-pdf.json) | `generate_basic_pdf`, `annotate_pdf` | Add markup annotations to an existing PDF (pdfnative v1.5 annotation writer via annotate_pdf). |
| [basic-watermark-normalize.json](./basic-watermark-normalize.json) | `generate_basic_pdf` | Plain document with a DRAFT watermark and explicit Unicode normalization (v1.2.0). |
| [bookmarked-report.json](./bookmarked-report.json) | `generate_basic_pdf` | Bookmarked, page-labelled report (pdfnative v1.4 features via generate_basic_pdf). |
| [bordered-table.json](./bordered-table.json) | `add_table` | Table with per-cell vector borders and vertical alignment (pdfnative v1.4 via add_table). |
| [chart-report.json](./chart-report.json) | `add_chart` | Render a native vector chart (pdfnative v1.6 via add_chart). |
| [cmyk-colours.json](./cmyk-colours.json) | `generate_basic_pdf` | DeviceCMYK colours (pdfnative 1.8 via generate_basic_pdf v1.7.0): every colour input takes a CMYK operand string 'C M Y K' (each 0.0–1.0) or a [c, m, y, k] ink- |
| [draft-governance-issue.json](./draft-governance-issue.json) | `draft_governance_issue` | Draft a governance-compliant GitHub issue for HUMAN review — never submitted (pdfnative-mcp v1.4 AI-governance / Human-In-The-Loop). |
| [dual-axis-time-chart.json](./dual-axis-time-chart.json) | `add_chart` | Charts v2 (pdfnative 1.7 via add_chart): a line chart on a UTC-deterministic time axis (ISO-8601 xValues) with a secondary right axis — the 'Margin %' series bi |
| [emoji-skin-tones.json](./emoji-skin-tones.json) | `add_international_text` | Colour-emoji skin-tone sequences (add_international_text v1.7.0 on pdfnative 1.8): the COLRv1 module bundles 150 modifier sequences — 20 gestures and 10 generic |
| [encrypt-decrypt-roundtrip.json](./encrypt-decrypt-roundtrip.json) | `generate_basic_pdf`, `encrypt_pdf`, `inspect_pdf`, `decrypt_pdf` | Encryption round-trip (pdfnative v1.6): generate a PDF, re-secure it with AES-256 (owner + user password) via encrypt_pdf, confirm the cipher with inspect_pdf ( |
| [encrypted-merge.json](./encrypted-merge.json) | `merge_pdfs`, `inspect_pdf` | Merge encrypted sources and re-secure the result in one call (pdfnative v1.6 encrypted round-trip). |
| [extract-pages.json](./extract-pages.json) | `generate_basic_pdf`, `extract_pages` | Extract an arbitrary subset of pages into a SINGLE new PDF (pdfnative v1.4 page-tree API). |
| [extract-text-runs.json](./extract-text-runs.json) | `generate_basic_pdf`, `extract_text` | Extract Unicode text with positioned runs (pdfnative v1.6 via extract_text). |
| [factur-x-invoice.json](./factur-x-invoice.json) | `add_attachment` | Factur-X / ZUGFeRD electronic invoice: PDF/A-3b document with embedded XML payload (Source). |
| [factur-x-roundtrip.json](./factur-x-roundtrip.json) | `add_attachment`, `inspect_pdf`, `extract_attachments` | Factur-X / ZUGFeRD round-trip (v1.2.0): embed the structured XML into a PDF/A-3b carrier, confirm it with inspect_pdf, then read it back byte-for-byte with extr |
| [fill-form.json](./fill-form.json) | `add_form`, `read_form_fields`, `fill_form` | Fill and flatten an existing AcroForm (pdfnative v1.6 via fill_form). |
| [financial-report.json](./financial-report.json) | `generate_basic_pdf` | Financial-report sample: PDF/A-2b multi-page document with structured headings, paragraphs and a smart table. |
| [inspect-layout.json](./inspect-layout.json) | `inspect_layout` | Layout dry run (v1.6.0 via inspect_layout): preview how generate_basic_pdf will paginate a document — total pages and the page / x / top / width / height of eve |
| [ltv-offline.json](./ltv-offline.json) | `add_ltv`, `inspect_pdf` | Air-gapped PAdES B-LT: embed validation material collected out-of-band (exported CRL / OCSP responses and the issuing chain) with add_ltv mode=offline — zero ne |
| [math-symbols.json](./math-symbols.json) | `add_international_text` | Render mathematical / technical symbols (pdfnative v1.5 math font, Noto Sans Math OFL-1.1). |
| [merge-pdfs.json](./merge-pdfs.json) | `generate_basic_pdf`, `merge_pdfs`, `inspect_pdf` | Merge several PDFs into one (pdfnative v1.4 page-tree API). |
| [multi-signature.json](./multi-signature.json) | `sign_pdf`, `verify_pdf` | Two signatures on one document (pdfnative 1.7): the first sign_pdf call injects the 'Author' placeholder; the second adds a 'Reviewer' signature with allowMulti |
| [multilingual-doc.json](./multilingual-doc.json) | `add_international_text` | Multilingual cover page with Arabic, CJK and Latin runs. |
| [pades-ltv-ladder.json](./pades-ltv-ladder.json) | `prepare_signature_placeholder`, `sign_pdf`, `add_ltv`, `timestamp_pdf`, `verify_pdf` | PAdES long-term-validation ladder (pdfnative 1.7): B-B (sign_pdf profile=pades) -> B-T (timestamp=true, RFC 3161 token from the OPERATOR-configured TSA: PDFNATI |
| [page-labels-inspect.json](./page-labels-inspect.json) | `generate_basic_pdf`, `inspect_pdf` | Round-trip logical page numbering: author page labels then read them back (pdfnative v1.5 getPageLabels surfaced by inspect_pdf). |
| [pdfa-embed-fonts.json](./pdfa-embed-fonts.json) | `generate_basic_pdf` | Conformant PDF/A-2b with embedded fonts (pdfnative 1.7 via generate_basic_pdf v1.6.0). |
| [pdfx4-cmyk-validate.json](./pdfx4-cmyk-validate.json) | `generate_basic_pdf`, `validate_pdf`, `inspect_pdf` | PDF/X-4 round trip with a CMYK printing condition (pdfnative 1.8 via v1.7.0): (1) generate a four-colour PDF/X-4 file — CMYK colours, a 5 mm bleed with crop mar |
| [pdfx4-gray.json](./pdfx4-gray.json) | `generate_basic_pdf` | PDF/X-4 print exchange file (ISO 15930-7, pdfnative 1.8 via generate_basic_pdf v1.7.0), for a one-colour (black) job. |
| [print-bleed-marks.json](./print-bleed-marks.json) | `generate_basic_pdf` | Print-production document (pdfnative 1.7 via generate_basic_pdf v1.6.0): a 3 mm bleed (8.5 pt) derives the TrimBox/BleedBox, `marks: true` draws crop + registra |
| [print-colour-bars.json](./print-colour-bars.json) | `generate_basic_pdf` | Colour control strip (pdfnative 1.8 via generate_basic_pdf v1.7.0): `print.marks.colourBars` adds the C M Y K solids and their 50 % tints in the bleed, beside t |
| [reproducible-footer-date.json](./reproducible-footer-date.json) | `generate_basic_pdf` | Reproducible bytes with a dated footer (generate_basic_pdf v1.7.0 on pdfnative 1.8): every date is written in UTC (`+00'00'`), so pinning `creationDate` makes t |
| [scatter-log-chart.json](./scatter-log-chart.json) | `add_chart` | Charts v2 (pdfnative 1.7 via add_chart): a scatter plot on a linear x axis with a logarithmic value axis (strictly positive values required). |
| [scripts-lao-tai-cham.json](./scripts-lao-tai-cham.json) | `add_international_text` | The five scripts added by pdfnative 1.8 (add_international_text v1.7.0): Lao (`lo`, dedicated shaper), Tai Tham / Lanna (`nod`) and Cham (`cjm`) through the Uni |
| [sign-and-verify.json](./sign-and-verify.json) | `prepare_signature_placeholder`, `sign_pdf`, `verify_pdf` | Sign + verify workflow. |
| [split-pdf.json](./split-pdf.json) | `generate_basic_pdf`, `split_pdf` | Split one PDF into several documents — one per page range (pdfnative v1.4 page-tree API). |
| [stacked-bar-chart.json](./stacked-bar-chart.json) | `add_chart` | Charts v2 (pdfnative 1.7 via add_chart): a stacked bar chart with per-point data labels. |
| [token-frugal-read.json](./token-frugal-read.json) | `verify_pdf` | Token-frugal read (v1.2.0): the smallest 'is this PDF signed and valid?' probe. |
| [typography-exact-metrics.json](./typography-exact-metrics.json) | `generate_basic_pdf` | Exact base-14 metrics (pdfnative 1.8 via generate_basic_pdf v1.7.0): without `embedFonts` the text is set in the viewer's Helvetica, which the engine measures w |
| [typography-french.json](./typography-french.json) | `generate_basic_pdf` | French micro-typography (pdfnative 1.8 via generate_basic_pdf v1.7.0): `punctuationSpacing: "fr"` sets a narrow no-break space (U+202F) before ; ! ? and a no-br |
| [typography-report.json](./typography-report.json) | `generate_basic_pdf` | Book-quality report (pdfnative 1.8 typography via generate_basic_pdf v1.7.0). |
| [update-metadata.json](./update-metadata.json) | `update_metadata` | Rewrite the /Info dictionary of an existing PDF as an incremental update (pdfnative 1.7 PdfModifier.updateMetadata); XMP stays in sync on PDF/A files. |
| [watermarked-report.json](./watermarked-report.json) | `add_table` | Confidential tabular report with a semi-transparent text watermark on every page (v1.2.0). |
