# Agent contract — pdfnative-mcp

The consumer contract for AI agents **using** the server (Copilot, Claude, Cursor,
Cline, …): the tool catalogue, the decision tree, token-frugal responses, output modes
and operator environment, recipes, and the error reference. Section numbers §1–§6 are
stable anchors — tests, prompts and other documents cite them.

Agents **contributing** to this repository read [AGENTS.md](../AGENTS.md) instead.

Verified on 2026-09-21 against pdfnative-mcp 1.7.0 and pdfnative 1.8.0.

The server also returns the §2 decision tree in `serverInfo.instructions`. Deeper
references: [AI_GUIDE.md](AI_GUIDE.md) (pitfalls + recipes),
[guides/TYPOGRAPHY.md](guides/TYPOGRAPHY.md), [guides/PRINT.md](guides/PRINT.md) and
[guides/REPRODUCIBLE.md](guides/REPRODUCIBLE.md) (the 1.7.0 surface in depth),
[KNOWLEDGE_BASE.md](KNOWLEDGE_BASE.md) (architecture),
[API_STABILITY.md](API_STABILITY.md) (versioning charter). Worked
invocations live under [examples/](../examples/).

---

## 1. Tool catalogue (28 tools)

| # | Tool | Use it for | Read-only |
|---|------|-----------|:---:|
| 1 | `generate_basic_pdf` | Any document from the **13 block kinds**: `heading`, `paragraph`, `list`, `table`, `image`, `link`, `toc`, `barcode`, `svg`, `formField`, `chart`, `pageBreak`, `spacer`⁴. Paragraphs take `align` (incl. `justify`), `keepWithNext`, `splittable`. Optional `pdfA`, `watermark` (text and/or image), `normalize`, `outline` (bookmarks), `pageLabels`, `viewerPreferences`, print / PDF/A / PDF/X options³ (`pdfx`), layout + `typography` options⁵, CMYK colours⁶. | |
| 2 | `add_barcode` | QR / Code 128 / EAN-13 / Data Matrix / PDF417. Print / PDF/A / PDF/X options³ (`pdfx`), layout + `typography` options⁵. | |
| 3 | `add_international_text` | 27 Unicode scripts (v1.7.0 adds `lo` Lao, `nod` Tai Tham, `khb` New Tai Lue, `tdd` Tai Le, `cjm` Cham; `ha` / `yo` / `ig` / `sw` are aliases of `latin` — tone marks attach) + colour emoji (flag / ZWJ sequences, skin-tone modifiers) + `math`, BiDi + OpenType shaping. Optional `pdfA` (`nod`: use `pdfa2b`, not `pdfa2u`), `normalize` (default `NFC`), `viewerPreferences`, `print`, `outputIntent`, `pdfx`³, `metadata`, `creationDate`, `strict`, `includeDiagnostics` (fonts are always embedded, so no `embedFonts` — `pdfx` and every `typography` key work as they are), layout + `typography` options⁵. | |
| 4 | `add_table` | Tabular reports (wrap, repeatHeader, zebra, caption, `cellBorders`, `cellVAlign`…). Optional `watermark` (text and/or image), `viewerPreferences`, print / PDF/A / PDF/X options³ (`pdfx`), layout + `typography` options⁵, CMYK colours⁶. | |
| 5 | `add_form` | Create a **new** interactive AcroForm (`text`, `textarea`, `checkbox`, `radio`, `dropdown`, `listbox`; `placeholder` hint text). Print / PDF/A options³ (no `pdfx` — form fields are annotations), layout + `typography` options⁵ — `encrypt` keeps the AcroForm; archival with `pdfA` + `embedFonts: true`. | |
| 6 | `read_form_fields` | Enumerate an **existing** AcroForm's fields (name, type, value, widgets). Supports `password`. | ✓ |
| 7 | `fill_form` | Fill / flatten an **existing** AcroForm (incremental update). Supports `password`. | |
| 8 | `add_chart` | Native vector charts v2 (bar / barH / stackedBar / stackedBarH / line / area / scatter / pie / donut; `axis2`, log / time scales, `dataLabels`, `labelStride`), PDF/A-safe. Print / PDF/A / PDF/X options³ (`pdfx`), layout + `typography` options⁵, CMYK series colours⁶. | |
| 9 | `embed_image` | Embed a JPEG/PNG into a titled PDF (`align`, `alt`; no length bound on `imageBase64`). Print / PDF/A / PDF/X options³ (`pdfx`), layout + `typography` options⁵. | |
| 10 | `prepare_signature_placeholder` | Customize the `/Sig` placeholder before signing (signer metadata, `subFilter`, `reserveTimestamp`, `placeholderBytes`). Print / PDF/A options³, layout + `typography` options⁵ (no `encrypt` — the output must stay signable; no `pdfx`). | |
| 11 | `sign_pdf` | PAdES B-B / B-T CMS signature (RSA-SHA256/384/512, ECDSA-P256; `profile:'pades'`, `timestamp`, `certChainDerBase64`, `fieldName`, `allowMultiple`, `signingTime`); DER keys sign through constant-time `node:crypto` (raw P-256 scalars through the pure-JS signer). Auto-injects a placeholder. Never cached. | |
| 12 | `add_ltv` | PAdES B-LT: embed `/DSS` + `/VRI` (certs, OCSP, CRLs). `mode:'online'` via the operator provider, `mode:'offline'` with caller-supplied DER material. | |
| 13 | `timestamp_pdf` | PAdES B-LTA: append an RFC 3161 `/DocTimeStamp` from the operator TSA; re-run to extend the chain. | |
| 14 | `verify_pdf` | Verify every PAdES signature and document timestamp (integrity + value + chain; verification is pure JS). A `/DocTimeStamp` counts in `allValid` like any signature. `ltv:true` adds profile / timestamp / revocation / `ltvLevel`. Supports `password`. | ✓ |
| 15 | `validate_pdf` | Structural conformance. `standard: 'pdf-ua-1'` (default — PDF/UA, ISO 14289-1) or `'pdf-x-4'` (PDF/X-4, ISO 15930-7: output intent + `prtr` ICC profile, TrimBox, embedded fonts, no annotations / JavaScript / embedded files). The PDF/X result adds `caveats[]`: structural prerequisites only, **not a certified preflight**. Neither checks PDF/A. | ✓ |
| 16 | `inspect_pdf` | Metadata: version, pages (+ boxes), encryption (+ `encryptionInfo`), PDF/A claim (not its validity), PDF/X claim (`pdfX`, present only when the XMP claims it — not its validity), signatures (+ `signatures:true` inventory, `dss`, `docTimestampCount`), `trapped`, attachments, `annotations:true` (every page annotation + `annotationCount`). `check:[…]` (`pdfa`, `pdfx`, `signed`, `encrypted`, `placeholder`, `attachments`, `dss`, `docTimestamp`, `trapped`, `annotations`) → `checks` with the requested keys only + `checksPassed`. Supports `password`. | ✓ |
| 17 | `update_metadata` | Rewrite `/Info` title / author / subject / keywords (+ XMP, incl. XMP dates) of an **existing** PDF (incremental update; unencrypted only). | |
| 18 | `add_attachment` | PDF/A-3 with embedded files (Factur-X / ZUGFeRD). Print / PDF/A options³, layout + `typography` options⁵ (no `encrypt` — PDF/A-3 forbids it; no `pdfx` — PDF/X-4 forbids embedded files). | |
| 19 | `extract_attachments` | Read embedded files back out (byte-for-byte). Supports `password`. | ✓ |
| 20 | `extract_text` | Unicode text extraction (resolves `/ToUnicode`; in a tagged PDF a marked-content span yields its `/ActualText`, so tagged pdfnative output round-trips complex scripts exactly), optional positioned `runs`. Supports `password`. | ✓ |
| 21 | `merge_pdfs` | Concatenate 2–50 PDFs into one (page-tree API; page boxes preserved). Optional `password` / `encrypt`. | |
| 22 | `split_pdf` | Split a PDF into one document per page range (multi-output). Optional `password` / `encrypt`. | |
| 23 | `extract_pages` | Pull an arbitrary page subset into a single PDF. Optional `password` / `encrypt`. | ✓¹ |
| 24 | `encrypt_pdf` | Re-secure a PDF with AES-128 / AES-256 (owner/user passwords, permissions, rotation). | |
| 25 | `decrypt_pdf` | Emit an unencrypted copy of an RC4 / AES-128 / AES-256 document. | |
| 26 | `annotate_pdf` | Add markup annotations (highlight, sticky note, square/circle, line, freetext; CMYK colours⁶). Visual overlay only — does **not** redact underlying content. | |
| 27 | `inspect_layout` | **Pagination dry run** of the same `blocks` as `generate_basic_pdf` (+ `title`, `footerText`, `pdfA`, `normalize`, `embedFonts`, `pageSize`, `margins`, `headerTemplate`, `footerTemplate`, `typography` — it moves blocks, so pass the same object): `totalPages` and each block's page / x / top / width / height; the page count matches the built document (one pagination planner, `toc` included). No PDF produced. `verbosity` / `fields`. | ✓ |
| 28 | `draft_governance_issue` | Draft a governance-compliant GitHub issue for **human** review. Produces a local draft + compliance report; **never submits**, no network. | ✓² |

¹ `extract_pages` only reads the source, but it produces a new PDF, so it is not annotated `readOnlyHint`.
² `draft_governance_issue` is read-only in the default inline mode; `outputMode:'file'` writes a `.md` into the sandbox, so its `readOnlyHint` is `false`.
³ Print / PDF/A / PDF/X options (v1.6.0, every document-producing tool; extended in v1.7.0): `print` (`bleed` shorthand or `trimBox` / `bleedBox` / `artBox` / `cropBox`, `marks`, `userUnit`) — `marks` is `true` or `{ crop, registration, length, offset, weight, colourBars }`, and `colourBars` (`true` or `{ tints, size }`, `size` 4–72 pt; off by default) draws the C M Y K control strip in the bleed: it wants a bleed of about 5 mm (14.17 pt) and is skipped when it would not fit. `metadata` (`author`, `subject`, `keywords`, `trapped`). `outputIntent` (`iccProfileBase64` + `outputConditionIdentifier`, under `pdfA` or `pdfx`): an RGB, CMYK or Gray ICC profile, ≤ 8 MiB — it must be a real profile (`acsp` signature, consistent size field; `PRINT_ERROR` otherwise), and **no press profile is bundled**: the caller supplies the printer's. `pdfx: 'pdfx4'` (six tools only: `generate_basic_pdf`, `add_table`, `add_chart`, `add_barcode`, `embed_image`, `add_international_text`) writes a PDF/X-4 file (ISO 15930-7: `%PDF-1.6`, the PDF/X XMP identification, a `/GTS_PDFX` output intent, a TrimBox on every page, `/Trapped`); it **requires** `outputIntent` with a printer-class (`prtr`) profile and `embedFonts: true`, is exclusive with `pdfA` and `encrypt`, needs `metadata.trapped` `'True'` or `'False'` (omitted = `'False'`), and takes a TrimBox or an ArtBox, not both — each incoherent request is `VALIDATION_ERROR`; `link` / `formField` blocks are reported as `PDFX_ANNOTATIONS`. `embedFonts` (the 8 Latin tools — `add_international_text` always embeds), `strict` (fail on any engine diagnostic, see §6), `includeDiagnostics`, and `creationDate` (ISO-8601 with a time zone; pins `/CreationDate`, the XMP dates, the `{date}` placeholder and therefore the trailer `/ID` — every date is written in UTC, so the output is byte-identical on every host, whatever its time zone; the operator can pin it for the whole process, §4). `viewerPreferences` also takes `duplex`, `pickTrayByPDFSize`, `printPageRange`, `numCopies`. All optional; defaults stay byte-identical. Unknown or misspelt keys (top-level or nested) are rejected with `VALIDATION_ERROR`.
⁴ Block rules: `table` / `barcode` / `formField` / `chart` take the same body as `add_table` / `add_barcode` / `add_form` / `add_chart`. `paragraph` (v1.7.0): `align` (`left` default / `right` / `center` / `justify` — every line but the last spans the measure; pair with `typography.opticalMargins`), `keepWithNext` (a lead-in line stays with the table or figure that follows), `splittable` (allow / forbid a page break inside this paragraph, overriding `typography.splitParagraphs`). `heading` (v1.7.0): `keepWithNext` (overrides `typography.keepHeadingsWithNext` for this block, either way). The same keys are accepted by `inspect_layout`. `image`: JPEG or 8-bit non-interlaced greyscale/RGB PNG (alpha, palette, 16-bit, interlaced → `VALIDATION_ERROR` with a remedy), ≤ 12 M base64 chars each, ≤ 24 MiB decoded per call, `align`, `alt`. `link`: `http:` / `https:` / `mailto:` only, no control characters. `toc`: printed contents built from the heading blocks (internal `/GoTo` links) — pair with `outline:'auto'`. `svg`: path `d` string or markup with `<path>` `<rect>` `<circle>` `<ellipse>` `<line>` `<polyline>` `<polygon>` `<text>`/`<tspan>`; `transform`, `<g>`, `<use>`, `<image>`, gradients, opacity and CSS are silently ignored; nothing is ever fetched; ≤ 100 000 chars. `formField` under `pdfA` without `embedFonts: true` → `PDFA_UNEMBEDDED_FORM_FONT` (`strict:true` fails); with it the field font is embedded and the form is archival. `link` / `formField` under `pdfx` → `PDFX_ANNOTATIONS`. `barcode` has no `alt`. More than 50 000 engine blocks after newline splitting → `VALIDATION_ERROR` (split the document).
⁵ Layout options (v1.6.0, the nine document tools and `inspect_layout`): `pageSize` (`A4` default, `Letter`, `Legal`, `A3`, `Tabloid` — `print.*` boxes must fit it), `margins` (`top`/`right`/`bottom`/`left`, 0–200 pt, default 45/36/35/36), `headerTemplate` / `footerTemplate` (`left` / `center` / `right` zones with `{page}` `{pages}` `{title}` `{date}`; a `footerTemplate` **replaces** the default footer so `footerText` is then ignored; `{date}` is the UTC calendar date of the pinned instant — `creationDate`, else the operator pin of §4 — and the build day only when nothing is pinned; the template `color` takes hex or CMYK⁶), `compress` (FlateDecode streams: smaller file, different bytes; XMP stays plain under PDF/A), `debug` (guide rectangles as unmarked content — not for PDF/UA output). `encrypt` (seven tools: `generate_basic_pdf`, `add_table`, `add_form`, `add_international_text`, `embed_image`, `add_barcode`, `add_chart`; not `inspect_layout`, `prepare_signature_placeholder` or `add_attachment`): build-time Standard Security Handler, AES-128 default / AES-256, keeps the AcroForm (unlike `encrypt_pdf`), exclusive with `pdfA` (`VALIDATION_ERROR`), randomised bytes, never cached. `typography` (v1.7.0, the same ten tools; 12 keys, all off by default): `splitParagraphs` (paragraphs break across pages at a line boundary; atomic by default) with `orphans` / `widows` (1–10, default 2), `keepHeadingsWithNext` (`true` or `{ minLines }`), `unitBinding` (`true` or `{ units }` — `150 €`, `12 kg` stay together), `bindShortWords` (`true` or `{ maxLength, words }`), `punctuationSpacing` (`'fr'`, `'fr-CA'` or explicit `{ char, side, space }` rules; converts existing spaces only), `opticalMargins` (hanging punctuation on `align: 'justify'` text), `metrics` (`'approximate'` default / `'exact'` AFM widths — base-14 text only), `fontFeatures` (`tnum` `pnum` `lnum` `onum` `zero` `ordn` `sups` `subs` `smcp` `c2sc` `case`), `kerning`, `hyphenationLanguage`. Honest limits: `kerning`, `fontFeatures` and the `'fr'` narrow no-break space (U+202F) need an embedded font — `embedFonts: true`, or `add_international_text` — because base-14 Helvetica has no GPOS / GSUB and no U+202F (`'fr'` then degrades to `'fr-CA'`); `tnum` / `lnum` change nothing on the bundled Noto Sans (`TYPOGRAPHY_FEATURE_INEFFECTIVE`); **no hyphenation dictionary is installed**, so `hyphenationLanguage` has no effect on this server — soft hyphens (U+00AD) in the text are honoured. All absent by default — default output stays byte-identical.
⁶ CMYK colours (v1.7.0): every colour input keeps the form it has always taken (hex on charts, blocks and templates; a `'R G B'` operand string or hex on table borders and outline entries; a 0–1 RGB triple on watermarks and `annotate_pdf`) and gains DeviceCMYK beside it, in two forms — an operand string `'c m y k'` with each component 0–1 (`'0 0.6 1 0'`) and a percent tuple `[c, m, y, k]` with each component 0–100 (`[0, 60, 100, 0]`). Accepted on `watermark.color`, `headerTemplate` / `footerTemplate` `color`, `cellBorders.color`, `outline` entries, chart series, `link` and `svg` blocks (`fill` / `stroke`) and the `annotate_pdf` colours. CMYK content against an RGB or Gray output intent is reported (`PDFA_DEVICE_CMYK_CONTENT` / `PDFX_DEVICE_CMYK`); under a CMYK or Gray intent RGB content is mapped through a calibrated default space. A 0–1 RGB triple such as `[1, 0, 0]` renders the colour it names (before v1.7.0 it rendered near-black).

**Engine diagnostics (9 codes, pdfnative 1.8.0).** A diagnostic is a warning the engine raises while building; the file is still produced. `includeDiagnostics: true` returns them in `structuredContent.diagnostics[]` (`{ code, message, severity: 'warning' }`); `strict: true` turns the first one into an error instead (§6).

| Raised when | Diagnostic | Remedy | Under `strict: true` |
|---|---|---|---|
| `pdfA`, Latin text on base-14 Helvetica | `PDFA_NO_FONT_ENTRIES` | `embedFonts: true` | `PDF_A_COMPLIANCE_VIOLATION` |
| `pdfA`, `add_form` / a `formField` block without `embedFonts` | `PDFA_UNEMBEDDED_FORM_FONT` | `embedFonts: true` | `PDF_A_COMPLIANCE_VIOLATION` |
| `pdfA`, CMYK JPEG against an RGB output intent | `PDFA_DEVICE_CMYK_IMAGE` | RGB image, or a CMYK `outputIntent` | `PDF_A_COMPLIANCE_VIOLATION` |
| `pdfA`, CMYK colours against an RGB output intent | `PDFA_DEVICE_CMYK_CONTENT` | RGB colours, or a CMYK `outputIntent` | `PDF_A_COMPLIANCE_VIOLATION` |
| `pdfA: 'pdfa1b'`, ICC v4 profile | `PDFA_ICC_PROFILE_VERSION` | ICC v2 profile, or `pdfa2b`+ | `PDF_A_COMPLIANCE_VIOLATION` |
| `pdfx`, text not embedded | `PDFX_NO_FONT_ENTRIES` | `embedFonts: true` | `PDF_X_COMPLIANCE_VIOLATION` |
| `pdfx`, CMYK content under a non-CMYK printing condition | `PDFX_DEVICE_CMYK` | CMYK `outputIntent`, or Gray / RGB colours | `PDF_X_COMPLIANCE_VIOLATION` |
| `pdfx`, a `link` or `formField` block on a print page | `PDFX_ANNOTATIONS` | remove the block | `PDF_X_COMPLIANCE_VIOLATION` |
| `typography.fontFeatures` with `tnum` / `lnum` on Noto Sans, or a feature without an embedded font | `TYPOGRAPHY_FEATURE_INEFFECTIVE` | drop the feature, or `embedFonts: true` | `DIAGNOSTIC_ESCALATED` |

**Known limitations (engine-side, pdfnative 1.8.0):** `validate_pdf { standard: 'pdf-x-4' }` checks structural prerequisites — it is **not a certified preflight** (confirm a press job with the printer's preflight tool), and no ICC press profile is bundled. No hyphenation dictionary is installed (`typography.hyphenationLanguage` has no effect; soft hyphens work). Tai Tham (`nod`) under `pdfa2u` lacks a `ToUnicode` entry for one glyph (veraPDF rule 6.2.11.7.2) — use `pdfa2b` for `nod`. `add_form` (and `formField` blocks) with `pdfA` validate under veraPDF only with `embedFonts: true` (the field font is then embedded; without it: `PDFA_UNEMBEDDED_FORM_FONT`). An unsigned placeholder from `prepare_signature_placeholder` with `pdfA` is not conformant until it is signed (ISO 19005-2 6.4.3, empty `/Contents`); `sign_pdf profile: 'pades'` makes it pass. `extract_text` returns empty page text, not an error, when a content stream exceeds the decompression cap; on an **untagged** PDF it returns visual order for eleven scripts (tagged output round-trips exactly through `/ActualText`). `inspect_pdf` reports the PDF/A and PDF/X *claims*, never their validity.

## 2. Decision tree

```
Need a NEW PDF?
 ├─ has embedded files (Factur-X/ZUGFeRD)? → add_attachment  (only tool that embeds files; plain documents → generate_basic_pdf)
 ├─ a chart (bar/stacked/line/area/scatter/pie/donut)? → add_chart  (axis2 for a right axis, xAxis.type 'linear'|'time' + xValues, axis.scale 'log')
 ├─ a table/report?                        → add_table
 ├─ non-Latin text / emoji / math?         → add_international_text  (27 scripts; lo / nod / khb / tdd / cjm new; ha / yo / ig / sw alias latin; lang:['latin','math'] for formulas)
 ├─ a barcode/QR?                          → add_barcode
 ├─ an image?                              → embed_image
 ├─ a NEW interactive form?                → add_form
 └─ otherwise / anything mixed             → generate_basic_pdf  (13 block kinds: table, image, link, toc, barcode, svg, formField, chart inline with text)
 Will it fit / where do pages break?       → inspect_layout with the same blocks + layout inputs (no PDF produced)
 Letter / Legal / A3, margins, running header or footer, smaller file? → `pageSize`, `margins`, `headerTemplate` / `footerTemplate`, `compress` on any tool above
 Password-protected output that keeps its form? → `encrypt` on the document tool (not with `pdfA`); encrypt_pdf afterwards would drop the AcroForm
 Print-ready (bleed, crop marks, boxes)?   → add `print: { bleed, marks }` (+ `metadata.trapped`) to any tool above; `marks: { colourBars: true }` for the C M Y K control strip (bleed ≈ 14.17 pt); `userUnit` not under pdfa1b
 Print exchange / a printer asks for PDF/X-4? → `pdfx: 'pdfx4'` + `outputIntent` (the printer's ICC profile, class `prtr` — none is bundled) + `embedFonts: true` on generate_basic_pdf / add_table / add_chart / add_barcode / embed_image / add_international_text; not with `pdfA` or `encrypt`; then validate_pdf { standard: 'pdf-x-4' } (structural prerequisites, not a certified preflight)
 Ink percentages / process colours?        → CMYK on every colour input: `'c m y k'` (0–1) or `[c, m, y, k]` (0–100); match it with a CMYK `outputIntent` under pdfA / pdfx
 Fine typography / French spacing / justified text? → `typography` (+ `embedFonts: true` for kerning, fontFeatures and the 'fr' narrow space) and paragraph `align: 'justify'`; no hyphenation dictionary — use soft hyphens (U+00AD); see the `typography` prompt
 VALID PDF/A claim (veraPDF)?              → add `embedFonts: true` (+ `strict: true` to fail instead of warn, `includeDiagnostics: true` to see why); forms included (add_form / formField need `embedFonts: true` too); `nod` (Tai Tham) → `pdfa2b`, not `pdfa2u`
 Same bytes on every machine?              → pin `creationDate` (document tools; dates are written in UTC, `{date}` follows it), `signingTime` (sign_pdf / prepare_signature_placeholder), `modDate` (update_metadata); the operator can pin the whole process (PDFNATIVE_MCP_CREATION_DATE, else SOURCE_DATE_EPOCH — a call's own `creationDate` wins)
Work with an EXISTING form?
 ├─ list its fields?                       → read_form_fields
 └─ fill / flatten it?                     → fill_form
Annotate an existing PDF (overlay)?       → annotate_pdf
Change title/author/subject/keywords of an existing PDF? → update_metadata (incremental; sign again afterwards if needed)
Combine / carve existing PDFs?
 ├─ join several into one?                 → merge_pdfs   (password / encrypt optional)
 ├─ split into per-range documents?        → split_pdf    (password / encrypt optional)
 └─ keep an arbitrary page subset (1 PDF)? → extract_pages (password / encrypt optional)
Encryption?
 ├─ protect a PDF?                         → encrypt_pdf
 ├─ get an unencrypted copy?               → decrypt_pdf
 └─ just READ an encrypted PDF?            → pass `password` to inspect_pdf / extract_text / …
Need to SIGN?  (PAdES ladder, ETSI EN 319 142-1)
 ├─ B-B  basic signature                   → sign_pdf  (profile:'pades' recommended; rsa-sha256/384/512 or ecdsa-sha256; auto-injects the placeholder)
 ├─ customise the placeholder first?       → prepare_signature_placeholder (subFilter, reserveTimestamp, placeholderBytes, signer metadata, signingTime — frozen at placeholder time) then sign_pdf
 ├─ B-T  + signature timestamp             → sign_pdf with timestamp:true          (needs PDFNATIVE_MCP_TSA_URL)
 ├─ B-LT + certs / OCSP / CRL in /DSS      → add_ltv   mode:'online' (needs PDFNATIVE_MCP_REVOCATION + allow-list) or mode:'offline' (caller-supplied DER, zero network)
 ├─ B-LTA + archival document timestamp    → timestamp_pdf  (needs the TSA; re-run before the TSA cert expires)
 ├─ several signatures?                    → sign_pdf with fieldName (+ allowMultiple:true for the 2nd, 3rd …)
 └─ check the level reached                → verify_pdf with ltv:true  (ltvLevel B-B / B-T / B-LT / B-LTA)
Need to READ a PDF?      (all accept `password` for encrypted sources)
 ├─ metadata/structure?  → inspect_pdf  (pages:true → boxes; signatures:true → field inventory; annotations:true → page annotations; check:['dss','docTimestamp','trapped','annotations','pdfx']; `pdfA` / `pdfX` are claims, not verdicts)
 ├─ is it signed?        → inspect_pdf check:['signed'] is STRUCTURAL (a signed field exists); cryptographic validity → verify_pdf
 ├─ signatures valid?    → verify_pdf  (ltv:true → ltvLevel; keep fields:['ltvLevel'] or verbosity:'summary' — both keep it)
 ├─ PDF/UA conformant?   → validate_pdf  (standard:'pdf-ua-1', the default)
 ├─ PDF/X-4 structure?   → validate_pdf  standard:'pdf-x-4'  (read caveats[]: not a certified preflight)
 ├─ embedded files?      → extract_attachments
 ├─ form fields?         → read_form_fields
 └─ plain text (+runs)?  → extract_text
Preview pagination of NEW blocks?  → inspect_layout (read-only; totalPages + block geometry)
Propose a bug/feature to GitHub? → draft_governance_issue (local draft; a human reviews & submits)
```

## 3. Token-frugal responses

The seven read-only tools (`inspect_pdf`, `verify_pdf`, `validate_pdf`, `extract_text`,
`extract_attachments`, `read_form_fields`, `inspect_layout`) accept two optional inputs (defaults unchanged):

- `verbosity: 'summary'` — compact scalar verdict; drops heavy arrays / full text but
  keeps the scalars you branch on (`inspect_pdf`: `docTimestampCount` / `trapped` /
  `checksPassed` when present; `verify_pdf`: `ltvLevel` with `ltv: true`; `inspect_layout`:
  `pageWidth` / `pageHeight` / `totalPages` / `blockCount`).
- `fields: ['a', 'b.c']` — dot-path projection (array segments map over elements),
  applied **after** `verbosity`. Unmatched paths are omitted, and the result then
  carries `_meta.unmatchedFields` + `_meta.availableFields` so a typo is visible.

Smallest "signed & valid?" probe: `{ pdfBase64, verbosity: 'summary', fields: ['allValid'] }`.
The output schemas of these seven tools declare every property optional, so a projected
`structuredContent` always validates against `outputSchema`.

Generated PDFs (base64 mode) are delivered **once** as an embedded `resource`
content block (`data:application/pdf;base64,…`), not duplicated into
`structuredContent` (which is `{ mode, sizeBytes }`, plus `diagnostics[]` when
`includeDiagnostics:true` and a `summary` object for `add_ltv`).

## 4. Output modes & environment

- `outputMode: 'base64'` (default) — bytes in the `resource` block.
- `outputMode: 'file'` — writes inside `PDFNATIVE_MCP_OUTPUT_DIR`. `outputPath`
  must be **relative**, end in `.pdf`, no traversal / absolute paths / NUL bytes.
- `PDFNATIVE_MCP_OUTPUT_DIR` — sandbox root for file output (unset = file mode disabled).
- `PDFNATIVE_MCP_CACHE_DIR` — opt-in SHA-256 cache (1 h TTL, 256 MiB LRU; key namespaced
  by `TOOL_API_VERSION/PDFNATIVE_MCP_VERSION` plus the pinned creation instant when the
  operator set one, so neither an engine upgrade nor a change of pin ever serves old
  bytes). Never caches `encrypt_pdf` / `decrypt_pdf` / `sign_pdf` / `add_ltv` /
  `timestamp_pdf` / `update_metadata` (secret-, time- or network-dependent), any call
  carrying `encrypt`, or any file-mode call. A hit carries `_meta.cached: true` and returns
  the **earlier** call's bytes (its `/CreationDate`, `/ID` and any `{date}` placeholder
  included) for identical inputs.
- `PDFNATIVE_MCP_CREATION_DATE` — operator pin of the creation instant for the whole process:
  an ISO 8601 instant **with a time zone** (`2026-01-01T00:00:00Z`), the same format as the
  `creationDate` tool input. `SOURCE_DATE_EPOCH` — the reproducible-builds.org convention
  (integer seconds since the Unix epoch), honoured when the first is unset. Precedence,
  highest first: per-call `creationDate` → `PDFNATIVE_MCP_CREATION_DATE` →
  `SOURCE_DATE_EPOCH` → the wall clock. Both are read **once at boot** (a tool argument can
  never change them), an invalid value **refuses to start** — never a silent fallback to the
  wall clock — and the source of the pin is logged on stderr. Every date is written in UTC
  (`/CreationDate` ends in `+00'00'`, the XMP dates in `+00:00`), and `{date}` in a
  `headerTemplate` / `footerTemplate` is the UTC calendar date of the pinned instant, so
  unencrypted output is a pure function of its inputs on every host, whatever its time zone.
  **Not covered by the pin**, by design: `signingTime` (`sign_pdf`,
  `prepare_signature_placeholder`), `modDate` (`update_metadata`), the regenerated second
  `/ID` of incremental writers (`annotate_pdf`, `fill_form`), RFC 3161 timestamp tokens and
  online revocation data, encryption (fresh file key, salts, IVs) and ECDSA signatures.
  A shell that already exports `SOURCE_DATE_EPOCH` (many build environments do) pins every
  document — unset it for the server process if that is not wanted.
- `PDFNATIVE_MCP_PORT` — opt-in Streamable HTTP transport on `127.0.0.1` (stdio otherwise).
- `PDFNATIVE_MCP_HTTP_TOKEN` — opt-in bearer token for the HTTP transport (≥ 16 characters,
  no whitespace; a weaker value aborts startup). When set, every request to `/mcp` must
  carry `Authorization: Bearer <token>` or is answered `401` + `WWW-Authenticate`. Without
  it the HTTP endpoint has **no authentication** — any local process can reach it.
- `PDFNATIVE_MCP_MAX_INFLATE_BYTES` — overrides the engine's 100 MiB per-stream
  decompression cap (integer ≥ 1024; an invalid value refuses to start). A capped
  attachment stream fails `extract_attachments includeData:true` with `PDF_PARSE_FAILED`;
  `extract_text` returns **empty page text** for a capped content stream (engine
  behaviour — no error is surfaced).
- `PDFNATIVE_MCP_TSA_URL` — RFC 3161 TSA for `sign_pdf timestamp:true` and `timestamp_pdf`
  (unset ⇒ `TSA_NOT_CONFIGURED`). `PDFNATIVE_MCP_TSA_AUTH` — optional `Authorization`
  header value (secret, never echoed).
- `PDFNATIVE_MCP_REVOCATION` — `ocsp` | `crl` | `ocsp,crl` for `add_ltv mode:'online'`
  (unset ⇒ `REVOCATION_NOT_CONFIGURED`); requires `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS`
  (comma-separated `host`, `host:port`, `*.suffix`). Allow-list caveats: entries are
  **hostnames**, not URLs; a `host:port` entry only matches URLs with an *explicit*
  port (the URL parser drops default `:80` / `:443`, so list the bare host for those);
  wildcard entries cannot carry a port; IDN hostnames must be listed in punycode
  (`xn--…`); IPv6 literals in brackets (`[2001:db8::1]`). The guard checks address
  **literals** only — a listed hostname that resolves to an internal address (DNS
  rebinding) is not detected, because there is no resolver without a dependency.
  Material returned by OCSP / CRL responders is parse-validated before it is embedded,
  and response-size caps are enforced while streaming (not after download).
- `PDFNATIVE_MCP_NETWORK_TIMEOUT_MS` — per-request timeout, 1000–120000 (default 10000).

**Privacy / network policy:** no telemetry; outbound network is **none by default** —
the only egress the server can ever perform goes to the operator-configured TSA /
OCSP / CRL endpoints above, never to a URL supplied by a tool argument, never to
GitHub. Document bytes only ever flow back in the JSON-RPC response (a timestamp
request sends only a digest to the TSA; OCSP / CRL requests carry certificate
identifiers). The optional HTTP transport (`PDFNATIVE_MCP_PORT`) binds `127.0.0.1`
only and enables DNS-rebinding protection (foreign `Host`/`Origin` → 403, the `Origin`
port must equal the server port; `GET` / `DELETE` → 405); that guard does not stop *other local processes* — set
`PDFNATIVE_MCP_HTTP_TOKEN` for that. Embedded files are passed through verbatim — the
server never executes, renders, or scans them, so scan untrusted attachments in the caller.

**Protocol:** MCP 2026-07-28 (stateless, `server/discover`, `resultType`, cache
hints) on the MCP TypeScript SDK v2, with automatic fallback to the 2025-era
`initialize` handshake on stdio and HTTP — existing hosts need no change. A
`tools/call` naming an unknown tool is a JSON-RPC protocol error (`-32602`,
`[UNKNOWN_TOOL] Unknown tool: …`), not an `isError` result. Generated files are listed
as `pdfnative://output/<path>` (template `pdfnative://output/{+path}`). Seven prompts
ship as ready-made recipes: `pades_ladder`, `print_ready` (bleed, marks, colour bars, CMYK,
PDF/X-4), `reproducible_output`, `typography`, `pdfa_valid`, plus the governance pair
`governance_contract` / `draft_issue_workflow`.

## 5. Recipes

- **Factur-X round-trip:** `add_attachment` → `inspect_pdf` → `extract_attachments` → *(optional)* `validate_pdf`.
- **Sign & verify:** `sign_pdf` → `verify_pdf` (add `trustedRootsDerBase64` for chain trust).
- **Sign with timestamp + LTV (PAdES B-LTA):** `sign_pdf` `{ profile: 'pades', timestamp: true, certChainDerBase64: [...] }` → `add_ltv` `{ mode: 'online' }` (or `{ mode: 'offline', certificatesDerBase64, ocspResponsesDerBase64, crlsDerBase64 }` when air-gapped) → `timestamp_pdf` → `verify_pdf` `{ ltv: true }` and read `ltvLevel`. The operator must set `PDFNATIVE_MCP_TSA_URL` (+ `PDFNATIVE_MCP_REVOCATION` / `..._ALLOWED_HOSTS` for online LTV); see [docs/guides/LTV.md](guides/LTV.md).
- **Author PDF/A:** `generate_basic_pdf` / `add_table` with `pdfA: 'pdfa2b'` → `validate_pdf`.
- **Valid PDF/A claim with embedFonts:** any document tool with `pdfA: 'pdfa2b', embedFonts: true, strict: true` — without `embedFonts` the Latin text uses unembedded base-14 Helvetica and veraPDF rejects the claim (`includeDiagnostics: true` surfaces `PDFA_NO_FONT_ENTRIES`). Forms are archival the same way: `add_form` / a `formField` block with `pdfA` + `embedFonts: true` embeds the field font too. Optional local check: `npm run validate:pdfa`.
- **Print-ready with bleed and marks:** `generate_basic_pdf` / `add_table` / … with `print: { bleed: 8.5, marks: true }, metadata: { trapped: 'False' }` (or explicit `trimBox` / `bleedBox` / `artBox` / `cropBox`; `userUnit` for formats above 14400 pt, not under `pdfa1b`) → `inspect_pdf` `{ pages: true }` to read the boxes back. For a colour control strip use the object form `marks: { crop: true, registration: true, colourBars: true }` (or `colourBars: { tints, size }`) with a bleed of about 5 mm (`bleed: 14.17`) — the strip is skipped when it does not fit ([print-colour-bars.json](../examples/print-colour-bars.json)). Boxes survive `merge_pdfs` / `split_pdf` / `extract_pages` — but the XMP packet (and therefore a PDF/A claim) does not: page-tree tools rebuild the document without it. See [docs/guides/PRINT.md](guides/PRINT.md).
- **PDF/X-4 print exchange:** on `generate_basic_pdf` / `add_table` / `add_chart` / `add_barcode` / `embed_image` / `add_international_text`: `pdfx: 'pdfx4', embedFonts: true, outputIntent: { iccProfileBase64, outputConditionIdentifier }, metadata: { trapped: 'False' }, print: { bleed: 8.5, marks: true }` (+ `strict: true` to fail on any `PDFX_*` diagnostic) → `validate_pdf` `{ standard: 'pdf-x-4' }` → `inspect_pdf` `{ check: ['pdfx', 'trapped'] }`. The ICC profile is **the caller's to supply**: no press profile is bundled — ask the printer for theirs (ISO Coated v2, GRACoL, …); it must be a real profile of device class `prtr`, CMYK or Gray (a monitor-class profile is `VALIDATION_ERROR`, a file that is not an ICC profile is `PRINT_ERROR`). Not combinable with `pdfA` or `encrypt`; drop `link` / `formField` blocks (`PDFX_ANNOTATIONS`). Honest caveat: a `valid: true` verdict means the structural prerequisites hold (read `caveats[]`) — it is **not a certified preflight**; confirm a press job with the printer's preflight tool. Examples: [pdfx4-gray.json](../examples/pdfx4-gray.json), [pdfx4-cmyk-validate.json](../examples/pdfx4-cmyk-validate.json).
- **CMYK colours:** any colour input takes an operand string `'c m y k'` with components 0–1 (`'1 0.6 0 0.1'`) or a percent tuple `[c, m, y, k]` with components 0–100 (`[100, 60, 0, 10]`) beside its usual form — `watermark.color`, `headerTemplate.color`, `cellBorders.color`, chart series `color`, `link` `color`, `svg` `fill` / `stroke`, `annotate_pdf` colours. Under `pdfA` / `pdfx` pair CMYK content with a CMYK `outputIntent` (against the default sRGB intent it reports `PDFA_DEVICE_CMYK_CONTENT`). Example: [cmyk-colours.json](../examples/cmyk-colours.json).
- **Book-quality text:** `generate_basic_pdf` with `embedFonts: true, typography: { splitParagraphs: true, orphans: 3, widows: 3, keepHeadingsWithNext: true, opticalMargins: true, kerning: true, fontFeatures: ['onum', 'smcp'] }` and paragraphs with `align: 'justify'`; `keepWithNext: true` on a lead-in paragraph, `splittable` per paragraph. Long words: soft hyphens (U+00AD) — no hyphenation dictionary is installed. Preview with `inspect_layout` (same `blocks`, same `typography`). Example: [typography-report.json](../examples/typography-report.json); exact base-14 widths for right / centre alignment without embedding: `typography: { metrics: 'exact' }` ([typography-exact-metrics.json](../examples/typography-exact-metrics.json)). Prompt: `typography`.
- **French typography:** `embedFonts: true, typography: { punctuationSpacing: 'fr', unitBinding: true, bindShortWords: true }` — a narrow no-break space before `;` `!` `?`, a no-break space before `:` and inside `« »`; only **existing** spaces are converted, none is inserted. `embedFonts: true` is what makes the narrow space (U+202F) possible: base-14 Helvetica has no such glyph and `'fr'` silently degrades to `'fr-CA'` (colon and guillemets only). Example: [typography-french.json](../examples/typography-french.json).
- **New scripts, African languages, skin tones:** `add_international_text` with `lang: ['lo', 'nod', 'khb', 'tdd', 'cjm']` ([scripts-lao-tai-cham.json](../examples/scripts-lao-tai-cham.json)); `lang: ['yo', 'ig', 'ha', 'sw']` — aliases of `latin`, tone marks attach ([african-languages.json](../examples/african-languages.json)); `lang: ['latin', 'emoji']` renders skin-tone modifiers ([emoji-skin-tones.json](../examples/emoji-skin-tones.json)).
- **Tai Tham under PDF/A:** `add_international_text` with `lang: ['nod', …], pdfA: 'pdfa2b'` — **not** `pdfa2u`: one Tai Tham glyph has no `ToUnicode` entry in the engine (veraPDF rule 6.2.11.7.2), so the PDF/A-2u claim would fail while PDF/A-2b validates.
- **Stacked / area / scatter / dual-axis chart:** `add_chart` with `chartType: 'stackedBar'` (or `'area'`); scatter needs `xValues` on every series plus `xAxis: { type: 'linear' }` (or `'time'` with ISO-8601 dates); a second series with `yAxis: 'right'` draws `axis2`; `axis: { scale: 'log' }` needs strictly positive, non-stacked data; `dataLabels: true` prints values; crowded labels are thinned automatically (`labelStride: 1` forces all). See [docs/guides/CHARTS.md](guides/CHARTS.md).
- **Update metadata of an existing PDF:** `update_metadata` `{ author, keywords, modDate }` (incremental; `/ModDate` and the XMP dates are rewritten — pin `modDate` for identical bytes; the operator pin of §4 does not cover it) → `sign_pdf` / `timestamp_pdf` again if the latest revision must be signed.
- **Reproducible output:** pin `creationDate` on any document tool (`/CreationDate`, XMP dates, trailer `/ID`), `signingTime` on `sign_pdf` / `prepare_signature_placeholder` (`/Sig /M`; RSA only — ECDSA signatures are randomised by the nonce) and `modDate` on `update_metadata`. Identical bytes on **every host, whatever its time zone**: every date is written in UTC (`D:20260115090000+00'00'`), and `{date}` in a header / footer template is the UTC date of the pinned instant, so a dated footer stays reproducible ([reproducible-footer-date.json](../examples/reproducible-footer-date.json)). An operator can pin the whole process instead (`PDFNATIVE_MCP_CREATION_DATE`, else `SOURCE_DATE_EPOCH`, §4); a call's own `creationDate` still wins. TSA tokens (`timestamp: true`, `timestamp_pdf`), online `add_ltv`, any `encrypt` / `encrypt_pdf` output (fresh key, salts, IVs) and ECDSA signatures are never reproducible, and the second `/ID` of `annotate_pdf` / `fill_form` is regenerated on every call. Prompt: `reproducible_output`.
- **Valid PDF/A claim with embedFonts:** see the bullet above; the `pdfa_valid` prompt carries the same recipe. Remaining gap: a `prepare_signature_placeholder` output is conformant only once signed.
- **Watermarked report:** `add_table` with `watermark: { text: 'CONFIDENTIAL', opacity: 0.2 }`; a logo instead (or as well): `watermark: { image: { imageBase64, mimeType: 'image/png', opacity: 0.1 }, position: 'background' }` (defaults: text 0.15, image 0.10; either below 1.0 is rejected under `pdfa1b`).
- **Bookmarked report:** `generate_basic_pdf` with `outline: 'auto'` + `pageLabels` + `viewerPreferences: { pageMode: 'useOutlines' }`; add a `{ type: 'toc' }` block for a printed contents page.
- **Composite document:** `generate_basic_pdf` with `toc` + `heading` + `table` + `image` + `svg` + `barcode` + `link` + `formField` blocks in one `blocks[]`; `outline: 'auto'`, `pageSize: 'Letter'`, `headerTemplate: { right: '{title} — {page}/{pages}' }`. Preview first with `inspect_layout` (same inputs, `verbosity: 'summary'`, `fields: ['totalPages']`).
- **Encrypted fillable form:** `add_form` with `encrypt: { userPassword, ownerPassword }` — the AcroForm survives (the post-hoc `encrypt_pdf` would drop it); not combinable with `pdfA`.
- **Smaller file:** `compress: true` on any document tool (FlateDecode streams; bytes differ from the default output).
- **Assemble / carve:** generate parts → `merge_pdfs`; or `split_pdf` (per range) / `extract_pages` (one subset) → `inspect_pdf` to confirm the page count.
- **Annotate for review:** `annotate_pdf` with `{ type: 'highlight' }` / `{ type: 'text' }` overlays — a visual review layer, **not** a redaction (underlying bytes remain).
- **Math / scientific text:** `add_international_text` with `lang: ['latin', 'math']` — `math` is an **explicit** script, embedded only when requested (no global auto-routing).
- **Chart:** `add_chart` for a standalone chart, or a `chart` block inside `generate_basic_pdf` to compose one with text/tables.
- **Fill a form:** `read_form_fields` (discover names) → `fill_form` with `values` (+ `flatten: true` for a final copy).
- **Encryption round-trip:** `encrypt_pdf` to protect, `decrypt_pdf` to recover, or pass `password` to a read-only tool to read an encrypted PDF without rebuilding it. `merge_pdfs`/`split_pdf`/`extract_pages` compose `password` (in) + `encrypt` (out).
- **Propose an upstream change:** `draft_governance_issue` → review the local `.md` draft + compliance report → a **human** submits it to GitHub (the server never does).

## 6. Error reference

| `code` | Meaning | Fix |
|--------|---------|-----|
| `VALIDATION_ERROR` | Zod rejected the input: wrong type / bound / enum, an **unknown or misspelt key** (top-level or nested — schemas are strict), an empty or non-base64 payload, PEM armour where DER base64 was expected (certificates, chains, keys, offline LTV material), a 0-based page index / range out of bounds on `merge_pdfs` / `split_pdf` / `extract_pages` / `annotate_pdf` / `extract_text`, an unsupported PNG (alpha / palette / 16-bit / interlaced), an image budget overrun (24 MiB per call), a `link` URL outside `http:` / `https:` / `mailto:`, `encrypt` together with `pdfA`, an incoherent `pdfx` request (with `pdfA`, with `encrypt`, without `outputIntent`, `metadata.trapped: 'Unknown'`, `print.artBox` beside a TrimBox, or an `outputIntent` ICC profile whose device class is not `prtr`), a malformed CMYK colour (`'c m y k'` components outside 0–1, tuple components outside 0–100), a `typography` value out of bounds, or more than 50 000 engine blocks | Re-read the field schema (message lists the path and, for PEM, the exact `openssl … -outform DER` remedy); pages are 0-based; flatten / re-export the PNG; split the document; for `pdfx` keep one conformance claim, drop `encrypt`, and pass the **printer's** output profile (class `prtr`, CMYK or Gray — a monitor profile such as sRGB is refused). |
| `PDF_PARSE_FAILED` | Input PDF malformed/truncated — since v1.7.0 also the classification of **any unexpected failure** of a tool that takes PDF input on a damaged file (the engine parses lazily, so the damage can surface in any accessor; no uncoded failure escapes). Also raised when `pdfBase64` decodes to PEM text, a nested `data:` URI or base64 encoded twice (the message says which), by `validate_pdf` on unparsable input, and when a compressed stream exceeds the decompression cap (`PDFNATIVE_MCP_MAX_INFLATE_BYTES`; `extract_attachments includeData:true` — `extract_text` silently yields empty text instead) | Pass the raw PDF bytes as base64 exactly once (a `data:…;base64,` prefix is tolerated); confirm it opens in a reader; for the cap, the operator raises the variable if the document is trusted. |
| `PDF_A_COMPLIANCE_VIOLATION` | Watermark `opacity < 1.0` (text or image, defaults included) under `pdfA:'pdfa1b'`; `strict:true` and the engine raised a `PDFA_*` diagnostic — `strict` escalates by diagnostic code: `PDFA_*` → this code, `PDFX_*` → `PDF_X_COMPLIANCE_VIOLATION`, anything else → `DIAGNOSTIC_ESCALATED`, so a client that matched this code for every strict failure should match the three (`PDFA_NO_FONT_ENTRIES` — unembedded Latin text; `PDFA_UNEMBEDDED_FORM_FONT` — a form built without `embedFonts`; `PDFA_DEVICE_CMYK_IMAGE` — CMYK JPEG against an RGB intent; `PDFA_DEVICE_CMYK_CONTENT` — CMYK colours against an RGB intent; `PDFA_ICC_PROFILE_VERSION` — ICC v4 profile under `pdfa1b`); `print.userUnit` under `pdfa1b` | Use `opacity:1.0` or `pdfa2b`+; add `embedFonts:true` (forms included); keep images and colours RGB, or supply a CMYK `outputIntent`; use an ICC v2 profile or `pdfa2b`+; drop `userUnit` or target `pdfa2b`+. `includeDiagnostics:true` echoes the codes without failing. |
| `PDF_X_COMPLIANCE_VIOLATION` | `strict:true` and the engine raised a `PDFX_*` diagnostic under `pdfx:'pdfx4'` (`PDFX_NO_FONT_ENTRIES` — text not embedded; `PDFX_DEVICE_CMYK` — CMYK content under a non-CMYK printing condition; `PDFX_ANNOTATIONS` — a link or form field on a print page) | Add `embedFonts:true`; match the colours to the `outputIntent` (CMYK profile for CMYK content, or Gray / RGB colours under a Gray condition); remove `link` / `formField` blocks. `includeDiagnostics:true` echoes the codes without failing; afterwards check the file with `validate_pdf standard:'pdf-x-4'`. |
| `DIAGNOSTIC_ESCALATED` | `strict:true` and the engine raised a diagnostic that is neither PDF/A nor PDF/X — today `TYPOGRAPHY_FEATURE_INEFFECTIVE` (`typography.fontFeatures` `tnum` / `lnum` on Noto Sans, or a feature without an embedded font). The message starts with `[CODE]` | Read the `[CODE]` in the message: drop the ineffective feature (`tnum` / `lnum` are already the default figures of Noto Sans), add `embedFonts:true`, or drop `strict` and read the diagnostic with `includeDiagnostics:true`. |
| `PRINT_ERROR` | Engine rejected `print` / `outputIntent`: box outside the MediaBox, marks without a TrimBox, or an ICC profile that is not one (no `acsp` signature at byte 36, declared size larger than the bytes supplied, unsupported colour space — RGB, CMYK and Gray are accepted) | Fix the box coordinates / supply `bleed` or `trimBox` / pass a real ICC profile, base64-encoded exactly once — hand-made stubs are rejected since v1.7.0. (Under `pdfx`, a real profile of the wrong device class is `VALIDATION_ERROR`, not this code.) |
| `METADATA_ERROR` | `update_metadata` could not rewrite `/Info` | Check the PDF opens; report with a reproduction if it persists. |
| `GENERATION_FAILED` | Generic engine throw while building a document | The message carries the engine text; fix the input it names. |
| `TSA_NOT_CONFIGURED` | `sign_pdf timestamp:true` / `timestamp_pdf` without `PDFNATIVE_MCP_TSA_URL` (or not an absolute URL) | Operator sets the TSA variables; no request is made otherwise. |
| `TSA_REJECTED` | TSA answered with a failure status, wrong imprint or nonce | Check the TSA endpoint / auth; raise `placeholderBytes` if the token is large. |
| `REVOCATION_NOT_CONFIGURED` | `add_ltv mode:'online'` without `PDFNATIVE_MCP_REVOCATION` + `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS` | Operator configures both, or use `mode:'offline'` with exported material. |
| `NETWORK_HOST_NOT_ALLOWED` | Certificate-advertised OCSP / CRL URL is not allow-listed, not http(s), has credentials, or targets an internal address | Add the responder host to the allow-list (verbatim for IP literals). |
| `NETWORK_ERROR` | TSA / OCSP / CRL request failed (timeout, HTTP error, response cap, invalid timeout / allow-list value) | Check connectivity and the env values; message never contains secrets. |
| `LTV_NO_SIGNATURE` | `add_ltv` on a PDF without a signed signature | Run `sign_pdf` first. |
| `LTV_EMPTY` | Online collection yielded nothing (self-signed chain, no AIA / CRL-DP) | Use `mode:'offline'` with material you hold, or a CA-issued certificate. |
| `LTV_MATERIAL_INVALID` | An offline DER blob (cert / OCSP / CRL) did not parse | Export DER (not PEM); check the field index in the message. |
| `LTV_ERROR` | Other `add_ltv` / `timestamp_pdf` failure | Message carries the engine text. |
| `PLACEHOLDER_AMBIGUOUS` | Several unsigned placeholders and no `fieldName` | Pass `fieldName` (list them with `inspect_pdf signatures:true`). |
| `SIGNATURE_FIELD_NOT_FOUND` | `fieldName` matched no signature field | Check the name via `inspect_pdf signatures:true`. |
| `MISSING_PLACEHOLDER` | `sign_pdf` w/ `autoInjectPlaceholder:false` on unplaceheld PDF | Keep the default `true`, or run `prepare_signature_placeholder`. |
| `PASSWORD_REQUIRED` | Encrypted source, no `password` supplied (read-only or page-tree tools) | Pass the `password` input (user or owner). |
| `PASSWORD_INVALID` | Supplied `password` did not open the document | Check the password; either user or owner works. |
| `ENCRYPTION_UNSUPPORTED` | Security handler this server cannot open | The document uses an unsupported scheme. |
| `ENCRYPTION_ERROR` | Re-encryption failed (e.g. no Web Crypto CSPRNG) | Run under a runtime with Web Crypto available. |
| `FORM_FIELD_NOT_FOUND` | `fill_form` value key matched no field (the message names both remedies) | Use `read_form_fields`, or `onUnknownField:'ignore'`. |
| `FORM_VALUE_TYPE_ERROR` | Wrong value type / choice not in options | Match the field type; use a valid option. |
| `FORM_UNSUPPORTED` | Tried to fill/flatten a signature field | Sign with `sign_pdf` instead. |
| `CHART_ERROR` | Chart (`add_chart` or a `generate_basic_pdf` `chart` block) failed an engine cross-field rule: log scale with non-positive values, scatter without `xValues`, `xValues` length mismatch, `yAxis:'right'` on pie, … | The message carries the remedy; colours are hex or CMYK (`'c m y k'` / `[c, m, y, k]`). |
| `EXTRACTION_UNSUPPORTED` | **Legacy — never raised since v1.5.0.** Kept in the contract for compatibility only | Encrypted reads use `password` (`PASSWORD_REQUIRED` / `PASSWORD_INVALID` otherwise). |
| `ENCRYPTED_SOURCE` | Encrypted input on `annotate_pdf`, `update_metadata`, `add_ltv`, `timestamp_pdf` (no `password` input). Page-tree and read tools never raise it — they take `password`. | `annotate_pdf` / `update_metadata`: `decrypt_pdf` first (drops signatures + AcroForm), edit, then `encrypt_pdf` again. `add_ltv` / `timestamp_pdf`: decrypting would destroy the signatures — sign and extend the **unencrypted** document, encrypt last (if at all). |
| `ATTACHMENT_NOT_FOUND` | `extract_attachments` `filename` matched nothing | Drop `filename` or list names via `inspect_pdf`. |
| `ATTACHMENT_TOO_LARGE` | `add_attachment` payload > 8 MiB | Shrink/split the payload. |
| `ATTACHMENT_BUILD_FAILED` | `add_attachment`: the engine threw while building the PDF/A-3 document (bad MIME type, unreadable payload, …) | The message carries the engine text; fix the attachment it names. |
| `PLACEHOLDER_FAILED` | `sign_pdf` (auto-inject) / `prepare_signature_placeholder`: the engine could not inject the `/Sig` placeholder | Check the source PDF opens; for a custom `pageIndex` confirm the page exists. |
| `VERIFY_FAILED` | `verify_pdf`: structural failure before signature checks (ByteRange beyond the file, unsupported EC public-key encoding) | Re-encode the base64; confirm the PDF is not truncated. |
| `OUTPUT_TOO_LARGE` | PDF > 50 MiB, or extraction > 16 MiB/file · 32 MiB total | Reduce content; for extraction use `includeData:false` or `filename`. |
| `UNSUPPORTED_LANG` | `add_international_text` `lang` unknown | Use a supported code (the message lists them: the 27 script codes, `latin`, `emoji`, `math`, and the `latin` aliases `ha` / `yo` / `ig` / `sw`). |
| `FONT_LOAD_FAILED` | Bundled font module failed to load (`add_international_text` script fonts, or the Noto Sans Latin data behind `embedFonts: true` on the document tools) | Retry; reinstall `pdfnative` if persistent. |
| `SIGNING_FAILED` · `CMS_PARSE_FAILED` · `EC_KEY_PARSE_FAILED` · `EC_CURVE_UNSUPPORTED` | Signing / key-cert problem (key does not match the certificate, unparsable CMS, EC key not P-256) | Check DER encodings (`rsaKeyPkcs1DerBase64` takes PKCS#1 **or** PKCS#8 DER; EC keys SEC1 or PKCS#8); ECDSA must be P-256. PEM input is caught earlier as `VALIDATION_ERROR`. |
| `SECURITY_VIOLATION` | Sandbox / path-traversal rejection | Set `PDFNATIVE_MCP_OUTPUT_DIR`; use a relative `.pdf` path. |
| `MISSING_OUTPUT_PATH` | `outputMode:'file'` without `outputPath` | Pass a relative `outputPath`. |
| `INVALID_PATH` | `outputPath` empty / not a string | Pass a non-empty relative path. |
| `INVALID_EXTENSION` | `outputPath` does not end in `.pdf` (`.md` for `draft_governance_issue`) | Fix the extension. |
| `UNKNOWN_RESOURCE` | `resources/read` with an unknown `pdfnative://` URI — surfaced as JSON-RPC error **`-32602`** (Invalid params), the code is carried in the message | List URIs with `resources/list`. |
| `[UNKNOWN_TOOL]` | **Protocol error, not a tool result:** `tools/call` named a tool that does not exist — JSON-RPC error **`-32602`** with message `[UNKNOWN_TOOL] Unknown tool: <name>` (MCP classifies unknown tools as protocol errors; `isError: true` is reserved for execution failures) | List tools with `tools/list`; names are lower-snake-case. |
| `GOVERNANCE_VIOLATION` | `draft_governance_issue` draft breaks the AI-governance contract (proposes a runtime dependency, missing reproduction, or `duplicateSearchPerformed:false`) | Remove the dependency proposal, include a reproduction, confirm the duplicate search. |
