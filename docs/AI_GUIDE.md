# AI Agent Guide — pdfnative-mcp

> **Read this first if you are an AI agent (Copilot, Claude, Cursor, Continue, Zed, Windsurf, Cline, Roo Code, …) about to call pdfnative-mcp.**
> It tells you which of the 28 tools to pick and how to avoid the common retry loops.
> Current for pdfnative-mcp 1.7.0 on pdfnative 1.8.0 (tool API `1.7.0`).

The server also returns the same decision tree in `serverInfo.instructions`. The consumer contract (catalogue, environment, every error code) is [`AGENT_CONTRACT.md`](AGENT_CONTRACT.md); the full reference lives in [`KNOWLEDGE_BASE.md`](KNOWLEDGE_BASE.md); the stability charter in [`API_STABILITY.md`](API_STABILITY.md). Worked invocations are in [`../examples/`](../examples).

---

## 1. Decision tree — pick the right tool in one step

| You want to… | Tool |
|---|---|
| Any document — headings, paragraphs, lists, and inline `table` / `image` / `link` / `toc` / `barcode` / `svg` / `formField` / `chart` blocks (13 kinds) | `generate_basic_pdf` |
| Preview the pagination of those blocks (page count, block positions) without rendering | `inspect_layout` *(same `blocks` + layout inputs; read-only)* |
| A standalone QR code or barcode | `add_barcode` |
| Non-Latin text (Arabic, Hindi, CJK, Lao, Tai Tham, Cham, …), colour emoji (skin tones included), math symbols | `add_international_text` *(27 Unicode scripts; `ha` / `yo` / `ig` / `sw` are aliases of `latin`)* |
| A tabular report | `add_table` |
| A **new** interactive AcroForm (text, textarea, checkbox, radio, dropdown, listbox) | `add_form` *(or `formField` blocks in `generate_basic_pdf`)* |
| A **new** form that must stay fillable **and** be password-protected | `add_form` with `encrypt` *(not `encrypt_pdf`, which drops the AcroForm)* |
| List the fields of an **existing** AcroForm | `read_form_fields` |
| Fill / flatten an **existing** AcroForm | `fill_form` |
| A native vector chart (bar, line, area, scatter, pie, …) | `add_chart` *(or a `chart` block in `generate_basic_pdf`)* |
| Embed a JPEG/PNG into a PDF | `embed_image` *(or an `image` block in `generate_basic_pdf`)* |
| Letter / Legal / A3 / Tabloid pages, custom margins, a running header or footer, a smaller file | `pageSize`, `margins`, `headerTemplate` / `footerTemplate`, `compress` on any document tool |
| Fine typography — paragraphs that split with orphan / widow control, justified text, French punctuation spacing, unit binding, kerning, OpenType features | `typography` on any document tool and on `inspect_layout` *(+ `embedFonts: true`; paragraph `align: 'justify'` in `generate_basic_pdf`)* |
| Colours as ink percentages (process colours) | CMYK on any colour input: `'c m y k'` (0–1) or `[c, m, y, k]` (0–100) |
| A print-exchange file — the printer asks for PDF/X-4 | `pdfx: 'pdfx4'` + `outputIntent` (the printer's ICC profile) + `embedFonts: true` on `generate_basic_pdf` / `add_table` / `add_chart` / `add_barcode` / `embed_image` / `add_international_text`, then `validate_pdf` with `standard: 'pdf-x-4'` |
| A colour control strip next to the crop marks | `print: { bleed: 14.17, marks: { colourBars: true } }` on any document tool |
| The same bytes on every machine | `creationDate` on the document tools (`signingTime` / `modDate` on the signing / metadata tools) — or the operator pin |
| Digitally sign any PDF | `sign_pdf` *(auto-injects placeholder)* |
| Customize the signature placeholder before signing (`subFilter`, `reserveTimestamp`, `placeholderBytes`, signer metadata, `signingTime`) | `prepare_signature_placeholder` → `sign_pdf` |
| Embed revocation material (PAdES B-LT, `/DSS`) | `add_ltv` |
| Append a document timestamp (PAdES B-LTA) | `timestamp_pdf` |
| **Factur-X / ZUGFeRD invoice** or any PDF with attachments | `add_attachment` *(NOT `generate_basic_pdf` — only `add_attachment` embeds files)* |
| **Pull embedded files back out** (e.g. Factur-X XML) | `extract_attachments` |
| Inspect / assert metadata ("does a signed field exist?", "which annotations are on page 3?") | `inspect_pdf` *(`annotations: true` for the annotation inventory)* |
| Verify all PAdES signatures (cryptographic validity) | `verify_pdf` |
| Validate PDF/UA accessibility structure | `validate_pdf` *(`standard: 'pdf-ua-1'`, the default)* |
| Check the structural prerequisites of a PDF/X-4 file | `validate_pdf` with `standard: 'pdf-x-4'` *(read `caveats[]` — not a certified preflight)*; the claim alone: `inspect_pdf check: ['pdfx']` |
| Extract plain text | `extract_text` |
| Rewrite title / author / subject / keywords of an existing PDF | `update_metadata` |
| Join several PDFs into one | `merge_pdfs` |
| Split one PDF into per-range documents | `split_pdf` |
| Keep an arbitrary page subset (one PDF) | `extract_pages` |
| Password-protect a PDF (AES-128 / AES-256) | `encrypt_pdf` |
| Produce an unencrypted copy | `decrypt_pdf` *(to merely read an encrypted PDF, pass `password` to the read tools instead)* |
| Overlay markup annotations on a PDF (review layer) | `annotate_pdf` |
| Draft a GitHub issue for a human to submit | `draft_governance_issue` |

Ambiguities resolved: `add_attachment` vs `generate_basic_pdf` — only `add_attachment` embeds files (PDF/A-3); `inspect_pdf check:'signed'` is structural ("a signed field exists"), cryptographic validity is `verify_pdf`'s job; `sign_pdf` auto-injects its placeholder, use `prepare_signature_placeholder` only to customise it first (signer metadata is frozen at placeholder time).

Input validation is strict: unknown top-level or nested keys are rejected with `VALIDATION_ERROR` ("Unrecognized key"), matching `additionalProperties: false`. Calling a tool name that does not exist is a JSON-RPC protocol error (`-32602`, `[UNKNOWN_TOOL] Unknown tool: <name>`), not an `isError` result.

---

## 2. Common pitfalls (these cause the most retries)

### Document blocks (`generate_basic_pdf`, v1.6.0)
- 13 block kinds: `heading`, `paragraph`, `list`, `table`, `image`, `link`, `toc`, `barcode`, `svg`, `formField`, `chart`, `pageBreak`, `spacer`. `table` / `barcode` / `formField` / `chart` take **exactly** the body of `add_table` / `add_barcode` / `add_form` / `add_chart` (same keys, same rules — a table row must have as many cells as headers, a radio / dropdown / listbox field needs `options`).
- `image`: JPEG or PNG, `mimeType` must match the bytes. PNGs must be **8-bit, non-interlaced, greyscale or RGB** — alpha-channel (colour type 4 / 6), palette (type 3), 16-bit and interlaced PNGs are rejected with `VALIDATION_ERROR` and a remedy (flatten / re-export; the same rule applies to `embed_image` and watermark images). Each inline image ≤ 12 M base64 characters, all images of one call ≤ 24 MiB decoded. Under PDF/A a CMYK JPEG reports `PDFA_DEVICE_CMYK_IMAGE` — keep images RGB.
- `link.url` must start with `http://`, `https://` or `mailto:` and contain no control characters; anything else (`javascript:`, `file:`, …) is `VALIDATION_ERROR`.
- `svg.data` is a path `d` string or SVG markup (≤ 100 000 chars). Supported: `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>`, `<text>`/`<tspan>`, `fill` / `stroke` / `stroke-width`, double-quoted attributes. **Silently ignored:** `transform`, `<g>`, `<use>`, `<image>`, `<defs>` / `<clipPath>`, gradients, opacity, CSS / `style`, dash patterns. Pass `viewBox` for a bare path string that is not 0-based. Nothing is ever fetched.
- `toc` prints a table of contents built from the `heading` blocks (internal links, dot leaders) — pair it with `outline: 'auto'` for the bookmark pane. Since v1.7.0 `inspect_layout` and the build share one pagination planner: a `toc` block reports its real height and the previewed page count matches the built document.
- `formField` under `pdfA` **without** `embedFonts: true` reports `PDFA_UNEMBEDDED_FORM_FONT` (`strict: true` fails the call) — add `embedFonts: true` (the field font is then embedded and the form is archival). Under `pdfx`, `link` and `formField` blocks report `PDFX_ANNOTATIONS`. `barcode` blocks have no `alt`.
- **v1.7.0:** `paragraph` takes `align` (`left` / `right` / `center` / `justify`), `keepWithNext` (a lead-in line stays with the table that follows) and `splittable` (overrides `typography.splitParagraphs` for this block); `heading` takes `keepWithNext`. A paragraph is **atomic by default** — one taller than a page overflows unless `typography.splitParagraphs` (or `splittable: true`) lets it break.
- More than 50 000 engine blocks after newline splitting → `VALIDATION_ERROR`; split the document and `merge_pdfs` the parts.
- Preview first: `inspect_layout` with the same `title`, `blocks`, `footerText`, `pdfA`, `normalize`, `embedFonts`, `pageSize`, `margins`, `headerTemplate`, `footerTemplate`, `typography` returns `totalPages` and every block's page / x / top / width / height — no PDF is produced. `verbosity: 'summary'` + `fields: ['totalPages']` is the cheapest "does it fit on one page?" probe.

### Layout options (the nine document tools, v1.6.0)
- `pageSize`: `A4` (default), `Letter`, `Legal`, `A3`, `Tabloid` — portrait presets; `print.*` boxes must fit the chosen page.
- `margins`: all four of `top` / `right` / `bottom` / `left` (0–200 pt); default 45 / 36 / 35 / 36.
- `headerTemplate` / `footerTemplate`: `{ left?, center?, right?, fontSize?, color? }` with `{page}` `{pages}` `{title}` `{date}`. A **`footerTemplate` replaces the default footer** — `footerText` is then ignored and page numbers appear only where you put `{page}/{pages}`. Since v1.7.0 `{date}` is the **UTC calendar date of the pinned instant** (YYYY-MM-DD) — the call's `creationDate`, else the operator pin — so a dated footer is reproducible once an instant is pinned; unpinned it is the build day, and a cache hit returns the earlier date. `color` takes hex or CMYK.
- `compress: true`: FlateDecode streams — smaller file, different bytes (the XMP packet stays plain under PDF/A). `debug: true`: margin / block / cell guide rectangles as unmarked content — fine for PDF/A-2b, not for PDF/UA output.
- `encrypt: { ownerPassword, userPassword?, … }` (seven tools: `generate_basic_pdf`, `add_table`, `add_form`, `add_international_text`, `embed_image`, `add_barcode`, `add_chart`): AES-128 by default, AES-256 on request, **keeps the AcroForm**. Exclusive with `pdfA` (`VALIDATION_ERROR`). Output is randomised and never cached. Not on `prepare_signature_placeholder` (must stay signable) or `add_attachment` (PDF/A-3).
- Everything is opt-in; omit the keys and the output is byte-identical to before.

### Fine typography (`typography`, v1.7.0)
- One object on the nine document tools and on `inspect_layout`, 12 keys, all off by default: `splitParagraphs` (+ `orphans` / `widows`, 1–10, default 2), `keepHeadingsWithNext` (`true` or `{ minLines }`), `unitBinding` (`true` or `{ units }`), `bindShortWords` (`true` or `{ maxLength, words }`), `punctuationSpacing` (`'fr'`, `'fr-CA'` or explicit `{ char, side, space }` rules), `opticalMargins`, `metrics` (`'approximate'` / `'exact'`), `fontFeatures`, `kerning`, `hyphenationLanguage`.
- **Embed a font first.** `kerning`, `fontFeatures` and the `'fr'` narrow no-break space (U+202F) need `embedFonts: true` (or `add_international_text`, which always embeds): base-14 Helvetica has no GPOS / GSUB tables and no U+202F glyph. Without it `'fr'` silently degrades to `'fr-CA'` (colon and guillemets only) and a font feature reports `TYPOGRAPHY_FEATURE_INEFFECTIVE`.
- **No hyphenation dictionary is installed.** `hyphenationLanguage` is accepted and has **no effect** on this server (the engine seam is a function, which JSON cannot carry). Put soft hyphens (U+00AD) in long words — they are honoured as break opportunities and never drawn mid-word.
- **`tnum` / `lnum` are no-ops** on the bundled Noto Sans (its default figures already are tabular and lining): the engine reports `TYPOGRAPHY_FEATURE_INEFFECTIVE`, and with `strict: true` the call fails with `DIAGNOSTIC_ESCALATED`. The tags that do something: `onum`, `pnum`, `smcp`, `c2sc`, `sups`, `subs`, `ordn`, `zero`, `case`.
- `metrics: 'exact'` acts on **base-14 text only** (the AFM widths: right / centre alignment lands exactly, lines may wrap differently); it does nothing for text set in an embedded font.
- `unitBinding`, `bindShortWords` and `punctuationSpacing` convert **existing** plain spaces into no-break spaces; they never insert one. `opticalMargins` acts on `align: 'justify'` paragraphs.
- `typography` moves blocks: pass the **same object** to `inspect_layout` when previewing. Long form: the `typography` MCP prompt and [`guides/TYPOGRAPHY.md`](guides/TYPOGRAPHY.md).

### Colours (CMYK, v1.7.0)
- Every colour input keeps the form it always had and gains DeviceCMYK in two forms: an operand string `'c m y k'` with components **0–1** (`'0 0.6 1 0'`) and a percent tuple `[c, m, y, k]` with components **0–100** (`[0, 60, 100, 0]`). Do not mix the scales: `[0, 0.6, 1, 0]` is a valid tuple meaning 0.6 % magenta and 1 % yellow.
- Accepted on `watermark.color`, `headerTemplate` / `footerTemplate` `color`, `cellBorders.color`, `outline` entries (an outline label is RGB by definition — a CMYK value is converted for display), chart series, `link` and `svg` blocks, and the `annotate_pdf` colours.
- **A 0–1 RGB triple now renders the colour it names.** Until v1.7.0 `watermark.color: [1, 0, 0]` (and the `annotate_pdf` colours) reached the engine as 1/255 red and rendered near-black; it is red now. Bytes change only for inputs that rendered the wrong colour.
- Under `pdfA` or `pdfx`, CMYK content against an RGB (or Gray) output intent is reported — `PDFA_DEVICE_CMYK_CONTENT` / `PDFX_DEVICE_CMYK` — and fails under `strict: true`. Supply a CMYK `outputIntent`, or keep the colours RGB.

### Barcodes / QR codes
- `data` is the **raw** payload. To produce a QR pointing at `https://google.com`, send `{ "format": "qr", "data": "https://google.com" }` — **do not** URL-encode the URL.
- `ecLevel` (`L`/`M`/`Q`/`H`) applies **only** when `format='qr'`. It is silently ignored for `code128`, `ean13`, `datamatrix`, `pdf417`.
- Use `ecLevel: 'H'` for printed media that may be smudged or partially covered (e.g. logo overlay).
- `ean13` requires **12 or 13 digits**. Pass 12, the 13th check digit is auto-computed.

### Digital signing
- `sign_pdf` **auto-injects** a `/Sig` placeholder when missing (since v1.0.0). You can sign **any** PDF in a single call — no need to run `prepare_signature_placeholder` first.
- All key/cert material is **DER, base64-encoded** (no PEM). Convert with:
  - cert: `openssl x509 -in cert.pem -outform DER | openssl base64 -A` → `certDerBase64`
  - RSA key (PKCS#1 or PKCS#8 DER): `openssl rsa -in key.pem -outform DER -traditional | openssl base64 -A` (or `openssl pkey -in key.pem -outform DER | openssl base64 -A`) → `rsaKeyPkcs1DerBase64`
  - ECDSA key (PKCS#8 or SEC1): `openssl pkey -in key.pem -outform DER | openssl base64 -A` → `ecPrivateKeyDerBase64`
  - ECDSA scalar form: `ecPrivateScalarHex` = 64 hex chars (raw P-256 `d`)
- Base64 inputs (`pdfBase64` and every DER field) tolerate a `data:…;base64,` prefix. PEM where DER is expected → `VALIDATION_ERROR` with the exact `openssl` remedy; double-encoded base64, PEM text or a nested `data:` URI passed as a PDF → `PDF_PARSE_FAILED` with a hint; an empty payload → `VALIDATION_ERROR`.
- After signing, call `verify_pdf` to confirm. Without `trustedRootsDerBase64`, `chainTrust` is `'self-signed'` or `'unverified'` — that is expected.
- RSA and EC-DER keys sign through a constant-time `node:crypto` provider (with a transparent pure-JS fallback); the raw-scalar `ecPrivateScalarHex` path uses the pure-JS signer. "Constant-time" applies to signing with DER keys only — verification (`verify_pdf`) runs in pure JS. Signatures are interoperable either way.
- `signingTime` (ISO-8601, timezone offsets accepted, e.g. `2026-01-15T10:00:00+01:00`) pins `/Sig /M`; also available on `prepare_signature_placeholder`, where it is frozen at placeholder time. Since v1.7.0 every date is written in UTC, so pinned dates give identical bytes on every host, whatever its time zone. The operator pin (`PDFNATIVE_MCP_CREATION_DATE` / `SOURCE_DATE_EPOCH`) does **not** cover `signingTime`. TSA tokens and ECDSA signatures (random nonce) are never reproducible.
- **v1.6.0 (pdfnative 1.7):** `profile: 'pades'` gives an ETSI EN 319 142-1 baseline signature (`ETSI.CAdES.detached`, ESS signing-certificate-v2); `algorithm` also accepts `rsa-sha384` / `rsa-sha512`; `certChainDerBase64` carries intermediates. `timestamp: true` (B-T) needs the operator-configured `PDFNATIVE_MCP_TSA_URL` — otherwise `TSA_NOT_CONFIGURED`, no request is made.
- Signer metadata (`signerName`, `reason`, `location`, `contactInfo`) is **baked into the placeholder** (earlier engines dropped it): when you pre-built the placeholder with `prepare_signature_placeholder`, set them there.
- Several unsigned placeholders → pass `fieldName` (else `PLACEHOLDER_AMBIGUOUS`); to add a second signature next to an existing one, pass `allowMultiple: true` + a fresh `fieldName`.

### Long-term validation (PAdES ladder)
- B-B `sign_pdf` → B-T `sign_pdf timestamp: true` → B-LT `add_ltv` → B-LTA `timestamp_pdf`. `verify_pdf ltv: true` reports `ltvLevel` and per-signature `profile` / `timestamp` / `revocation`.
- `add_ltv mode: 'online'` (default) needs `PDFNATIVE_MCP_REVOCATION` + `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS` on the server (`REVOCATION_NOT_CONFIGURED` otherwise). `mode: 'offline'` embeds DER certificates / OCSP responses / CRLs you supply — zero network, for air-gapped pipelines. Self-signed chains yield nothing online (`LTV_EMPTY`).
- `timestamp_pdf` re-runs extend the chain (`DocTimeStamp1`, `DocTimeStamp2`, …); raise `placeholderBytes` for TSAs that return large chains (`TSA_REJECTED` / `LTV_ERROR`).
- Document timestamps are verified as RFC 3161 tokens and count in `allValid` like any signature (sound ⇒ pass, tampered or TSA-untrusted ⇒ fail); `verify_pdf` reads revocation status from embedded `/DSS` material only. `timestamp_pdf` checks the token's status, imprint and nonce before embedding; the token's own CMS signature is verified by `verify_pdf`. See [`guides/LTV.md`](guides/LTV.md).

### Print production
- Every document tool accepts `print: { bleed }` (TrimBox = MediaBox inset, BleedBox = MediaBox) or explicit `trimBox` / `bleedBox` / `artBox` / `cropBox` (points, inside the MediaBox), `marks: true | { crop, registration, length, offset, weight, colourBars }` (needs a TrimBox), and `userUnit` (not under `pdfa1b`). `bleed` and `trimBox` are mutually exclusive. `colourBars: true | { tints, size }` (v1.7.0, `size` 4–72 pt, off by default — `marks: true` does not draw it) adds the C M Y K control strip in the bleed: it wants about 5 mm (`bleed: 14.17`) and is **silently skipped** when the strip does not fit.
- `metadata: { author, subject, keywords, trapped }` writes `/Info` (+ XMP under PDF/A); `outputIntent` (under `pdfA` or `pdfx`) replaces the built-in sRGB intent with your ICC profile — RGB, CMYK or Gray since v1.7.0. It must be a real profile: a hand-made stub (no `acsp` signature, a size field larger than the bytes) or another colour space is `PRINT_ERROR`.
- **PDF/X-4 (v1.7.0):** `pdfx: 'pdfx4'` exists on six tools only — `generate_basic_pdf`, `add_table`, `add_chart`, `add_barcode`, `embed_image`, `add_international_text`. It **requires** `outputIntent` and `embedFonts: true`. **No ICC press profile is bundled: you supply the printer's** (device class `prtr`, CMYK or Gray — ask the printer for theirs); a monitor-class profile such as sRGB is `VALIDATION_ERROR`. `pdfx` with `pdfA` and `pdfx` with `encrypt` are `VALIDATION_ERROR` (one conformance claim per file; PDF/X forbids encryption), as are a missing `outputIntent`, `metadata.trapped: 'Unknown'` and `print.artBox` beside a TrimBox. `link` / `formField` blocks report `PDFX_ANNOTATIONS`; `strict: true` fails on any `PDFX_*` diagnostic with `PDF_X_COMPLIANCE_VIOLATION`.
- **`validate_pdf standard: 'pdf-x-4'` is a structural check, not a certified preflight.** `valid: true` means the prerequisites hold (output intent + `prtr` profile, TrimBox, embedded fonts, no annotations / JavaScript / embedded files); the result says so itself in `caveats[]`. Confirm a press job with the printer's preflight tool. `inspect_pdf` (`pdfX`, `check: ['pdfx']`) reports the claim only.
- `creationDate` (ISO-8601) on the nine document tools (`generate_basic_pdf`, `add_table`, `add_form`, `add_international_text`, `embed_image`, `add_barcode`, `add_attachment`, `add_chart`, `prepare_signature_placeholder`) pins `/Info /CreationDate` (+ XMP dates on PDF/A), the `{date}` template placeholder and therefore the trailer `/ID` — reproducible bytes on **every host**: all dates are written in UTC since v1.7.0 (`+00'00'`), whatever the server's time zone. Omit it and the dates follow the wall clock — or the operator pin, see *Reproducible output* below.
- Read the boxes back with `inspect_pdf pages: true`; they survive `merge_pdfs` / `split_pdf` / `extract_pages`. See [`guides/PRINT.md`](guides/PRINT.md).

### Reproducible output (v1.7.0)
- Precedence of the creation instant, highest first: the call's `creationDate` → the operator's `PDFNATIVE_MCP_CREATION_DATE` → `SOURCE_DATE_EPOCH` → the wall clock. The two variables are read once at boot; an invalid value refuses to start.
- **`SOURCE_DATE_EPOCH` in the operator's shell pins every date.** Many build environments export it; a server started from such a shell stamps every document with that instant (its stderr says so at boot). If two calls minutes apart return the same `/CreationDate`, this is why — pass `creationDate` to override it per call, or have the operator unset the variable.
- Not covered by the pin: `signingTime`, `modDate`, the second `/ID` of incremental writers (`annotate_pdf`, `fill_form`), RFC 3161 tokens and online revocation data, encryption (fresh key, salts, IVs) and ECDSA signatures.
- If you compared bytes against v1.6.0: rebaseline once. pdfnative 1.8.0 changed the bytes of documents that embed a TrueType subset, draw `print.marks`, or shape text with mark positioning, and `/CreationDate` now ends in `+00'00'` (same instant). See [`guides/REPRODUCIBLE.md`](guides/REPRODUCIBLE.md).

### Charts v2
- Kinds: `bar`, `barH`, `stackedBar`, `stackedBarH`, `line`, `area`, `scatter`, `pie`, `donut`. `scatter` (and `line` / `area` on a `linear` / `time` x axis) needs per-series `xValues`. `yAxis: 'right'` on a series draws the secondary `axis2`. `axis.scale: 'log'` requires strictly positive, non-stacked data. Engine cross-field violations come back as `CHART_ERROR` with the remedy. Series colours are hex or CMYK.
- Overlapping category labels are thinned automatically; `labelStride: 1` restores every label, `labelRotation` disables the stride. See [`guides/CHARTS.md`](guides/CHARTS.md).

### Combining / carving PDFs (page-tree)
- `merge_pdfs` joins 2–50 PDFs (`pdfsBase64[]`) into one. `split_pdf` cuts one PDF into one document per `ranges[]` entry (`{ start, end? }`, 0-based inclusive). `extract_pages` keeps an arbitrary `pages[]` subset (0-based) in a single PDF.
- `split_pdf` returns a **multi-output** result (`{ mode, count, totalSizeBytes, parts[] }`); in `file` mode each part is written to an indexed path (`report.pdf` → `report-1.pdf`, …).
- **Encrypted sources** open with `password` (one password applied to every source of `merge_pdfs`); a missing or wrong password throws `PASSWORD_REQUIRED` / `PASSWORD_INVALID` — these tools never raise `ENCRYPTED_SOURCE`. The output is unencrypted unless `encrypt` is set. Oversize output throws `OUTPUT_TOO_LARGE`; an out-of-range page index or range is a `VALIDATION_ERROR` whose message reminds you that indices are 0-based.

### Bookmarks, page labels & nested lists
- `generate_basic_pdf` accepts `outline: 'auto'` (derive bookmarks from headings) or an explicit `[{ title, pageIndex, children?, open? }]` tree, plus `pageLabels: [{ startPage, style?, prefix?, start? }]` for viewer page numbering.
- `list` blocks accept nested `items` (`{ text, items?, style? }`, up to 6 levels) for multi-level lists.
- Pair `outline` with `viewerPreferences: { pageMode: 'useOutlines' }` to open the bookmark pane on load.

### Table cell borders & alignment
- `add_table` accepts `cellBorders: { top?, right?, bottom?, left?, color?, width? }` and `cellVAlign: 'top' | 'middle' | 'bottom'`. Either forces the document backend (same as `watermark`).

### Attachments (Factur-X / ZUGFeRD)
- Use `add_attachment`, **not** `generate_basic_pdf`. The latter cannot embed files.
- The output is PDF/A-3b. PDF/A-3 is the only PDF/A part that permits embedded files.
- Per-attachment cap: 8 MiB. Use `relationship: 'Source'` for the structured invoice XML.
- To read attachments back out, call `extract_attachments` — it returns each embedded file's bytes as `dataBase64` (byte-for-byte). Set `includeData: false` for a metadata-only probe, or `filename: '…'` to pull a single file. `inspect_pdf` lists attachment metadata only (no payload).

### Watermarks
- `generate_basic_pdf` and `add_table` accept an optional `watermark: { text?, fontSize?, opacity?, angle?, color?, image?, position? }` rendered on every page — `text`, `image` (v1.6.0: `{ imageBase64, mimeType, opacity?, width?, height? }`, JPEG / opaque 8-bit PNG, ≤ 8 MiB decoded) or both. `color` is an `[r, g, b]` triple in the `0.0–1.0` range (rendered as the colour it names since v1.7.0), or CMYK — `'c m y k'` (0–1) or `[c, m, y, k]` (0–100). At least one of `text` / `image` is required.
- Defaults match pdfnative: text `opacity 0.15`, image `opacity 0.10`, `angle -45`, light-gray, `position 'background'` (`'foreground'` paints above the content, for text and image alike). Omit `watermark` and output is byte-identical to before.
- **PDF/A-1b forbids transparency** (ISO 19005-1 §6.4): a text **or** image opacity below `1.0` (the defaults included) with `pdfA: 'pdfa1b'` throws `PDF_A_COMPLIANCE_VIOLATION`. Use `opacity: 1.0` (and `image.opacity: 1.0`) or a PDF/A-2/3 level.

### Unicode normalization
- `generate_basic_pdf` and `add_international_text` accept an optional `normalize: 'NFC' | 'NFD' | 'NFKC' | 'NFKD'`. `add_international_text` defaults to `'NFC'` (best glyph coverage for complex scripts); `generate_basic_pdf` defaults to no normalization (byte-stable). Only set it when input may contain decomposed combining sequences (e.g. macOS-copied text).

### PDF/A
- Pass `pdfA: 'pdfa2b'` for the widest reader compatibility.
- Use `pdfa3b` when (and only when) you have attachments.
- Write text **naturally** — embedded `\n` in a paragraph is auto-split into separate paragraphs; never emit a literal newline expecting a soft line break.
- The Euro sign `€` and other CP-1252 symbols render and extract correctly (pdfnative 1.3). Do **not** substitute `EUR` for `€`.
- Wrapped table cells get unique per-line MCIDs automatically — tagged tables are PDF/UA-safe.
- After generating a tagged/PDF-A document, call `validate_pdf` to assert PDF/UA structural conformance.
- **Honesty note (v1.6.0):** the Latin document tools render text through the viewer's base-14 Helvetica, which is **not embedded** — veraPDF rejects such a PDF/A claim (ISO 19005 §6.2.11.4.1). For a valid claim pass `embedFonts: true` (Noto Sans Latin, about 0.3 MiB; `add_international_text` always embeds). `strict: true` fails with `PDF_A_COMPLIANCE_VIOLATION` instead of producing a non-conformant file; `includeDiagnostics: true` echoes the engine diagnostics (e.g. `PDFA_NO_FONT_ENTRIES`) in `structuredContent.diagnostics`. Since v1.7.0 `strict` escalates by diagnostic code: `PDFA_*` → `PDF_A_COMPLIANCE_VIOLATION`, `PDFX_*` → `PDF_X_COMPLIANCE_VIOLATION`, any other (today `TYPOGRAPHY_FEATURE_INEFFECTIVE`) → `DIAGNOSTIC_ESCALATED` — match all three if you branch on strict failures.
- A custom `outputIntent` may be RGB, CMYK or Gray; under `pdfa1b` it must be an ICC v2 profile (`PDFA_ICC_PROFILE_VERSION` otherwise). Colour must match the intent: against the default sRGB intent a CMYK JPEG reports `PDFA_DEVICE_CMYK_IMAGE` and a CMYK colour reports `PDFA_DEVICE_CMYK_CONTENT`.
- `pdfA` and `pdfx` are mutually exclusive (`VALIDATION_ERROR`): PDF/A is for archiving, PDF/X for print exchange.
- `print.userUnit` is rejected under `pdfa1b`.
- **Forms are archival since v1.7.0** (pdfnative 1.8.0): `add_form` (and `formField` blocks) + `pdfA` + `embedFonts: true` validates under veraPDF — the field font is embedded too. Without `embedFonts` the `PDFA_UNEMBEDDED_FORM_FONT` diagnostic tells you so.
- **Known limitations (engine-side):** Tai Tham (`nod`) under `pdfa2u` fails veraPDF (one glyph has no `ToUnicode` entry, rule 6.2.11.7.2) — use `pdfa2b` for `nod`. `prepare_signature_placeholder` + `pdfA` is **not** conformant until signed (empty `/Contents`, ISO 19005-2 6.4.3); once signed with `sign_pdf profile: 'pades'` it passes. `inspect_pdf` reports the PDF/A claim, not its validity, and `validate_pdf` checks PDF/UA or PDF/X-4 structure — never PDF/A.
- See [`guides/PDFA.md`](guides/PDFA.md) for the per-tool capability matrix.

### International text
- `add_international_text` covers **27 Unicode scripts** (incl. Telugu, Sinhala, Tibetan, Khmer, Myanmar, Ethiopic, and since v1.7.0 `lo` Lao, `nod` Tai Tham, `khb` New Tai Lue, `tdd` Tai Le, `cjm` Cham) and COLRv1 colour emoji, skin-tone modifiers included. Pass `lang` as a single code, a comma-separated string, or an array (e.g. `["ar", "emoji"]`) for multi-script runs.
- For mathematical / scientific symbols, add the **explicit** `math` script, e.g. `lang: ["latin", "math"]`. It embeds the Noto Sans Math face **only when requested** — there is no global auto-routing, so plain `latin` text will not pick up math glyphs on its own.
- Input is NFC-normalised automatically; you do not need to pre-compose decomposed sequences.
- `ha` (Hausa), `yo` (Yoruba), `ig` (Igbo) and `sw` (Swahili) are **aliases of `latin`**: no extra font, and the tone marks attach to their base letters. Any other unknown code is `UNSUPPORTED_LANG` (the message lists the supported ones).
- **`nod` (Tai Tham) with PDF/A: use `pdfa2b`, not `pdfa2u`** — one glyph lacks a `ToUnicode` entry in the engine, so the stricter Unicode level fails veraPDF while `pdfa2b` validates.
- The tool always embeds its fonts, so `pdfx` and every `typography` key work without `embedFonts` (which this tool does not have — passing it is `VALIDATION_ERROR`).

### Annotating an existing PDF (review overlay)
- `annotate_pdf` overlays markup annotations via an incremental update. Types: `text` (sticky note), `highlight`, `underline`, `strikeout`, `squiggly`, `square`, `circle`, `line`, `freetext`. Each entry needs a 0-based `page`, a `rect: [x1, y1, x2, y2]`, and optional `color` / `contents`. Colours: hex or an operand string, a 0–1 `[r, g, b]` triple (rendered as the colour it names since v1.7.0), or a CMYK `[c, m, y, k]` percent tuple.
- This is a **visual review layer, NOT a redaction** — the underlying page content is untouched, so never use it to hide sensitive data.
- Encrypted sources are rejected with `ENCRYPTED_SOURCE`; out-of-range `page` indices are rejected by validation.

### Drafting a GitHub issue (human-in-the-loop)
- `draft_governance_issue` produces a **local** draft `.md` + a machine-readable compliance report. It **never** submits to GitHub and makes **no** network call — you are a draftsman; a human is the only gate that submits. (The server's only possible egress is the operator-configured TSA / OCSP / CRL endpoints used by the LTV tools; tool arguments can never supply a URL.)
- Always set `duplicateSearchPerformed: true` (after actually searching) and include a `reproduction: { command, result }`. Proposing a runtime dependency, omitting the reproduction, or `duplicateSearchPerformed: false` is rejected with `GOVERNANCE_VIOLATION`.
- Read the `governance_contract` and `draft_issue_workflow` MCP prompts first; the full contract is in [`guides/AI_GOVERNANCE.md`](guides/AI_GOVERNANCE.md).

### Text extraction
- `extract_text` returning `extractable: false` is **not an error**. The PDF uses subset fonts without `/ToUnicode` CMaps; the `extractableReason` field explains. The file is not corrupt.
- Since v1.7.0 text extracted from a **tagged** PDF is the writer's `/ActualText` for a marked-content span, so tagged pdfnative output round-trips complex scripts exactly; on an untagged PDF eleven scripts come back in visual order (engine limit).
- Encrypted PDFs open with `password` (missing / wrong → `PASSWORD_REQUIRED` / `PASSWORD_INVALID`). `EXTRACTION_UNSUPPORTED` is a legacy code that is never raised.
- Empty text for a page that visibly has text can also mean the page's content stream exceeded the operator's decompression cap (`PDFNATIVE_MCP_MAX_INFLATE_BYTES`): the engine swallows the per-page decode failure, so no error is raised. `extract_attachments includeData: true` on a capped attachment stream does raise `PDF_PARSE_FAILED` with a remedy.

### Token-frugal reads (v1.2.0)
The seven read-only tools — `inspect_pdf`, `verify_pdf`, `validate_pdf`, `extract_text`, `extract_attachments`, `read_form_fields`, `inspect_layout` — accept two **optional** inputs that shrink the response (typically ~90% fewer output tokens for large results) without losing the fields you branch on:

- `verbosity: 'summary'` returns a compact scalar-only verdict and drops the heavy arrays / full text:
  - `inspect_pdf` → `{ version, pageCount, encryption, pdfA, signatureCount, hasSignaturePlaceholder, attachmentCount }` plus `docTimestampCount` / `trapped` / `pdfX` / `checksPassed` / `annotationCount` when present (drops `attachments[]`, `info`, `perPage`, `dss`, `annotations[]`).
  - `inspect_layout` → `{ pageWidth, pageHeight, totalPages, blockCount }` (drops `pages[]`, `margins`).
  - `verify_pdf` → `{ signatureCount, allValid, invalid, summary }` plus `ltvLevel` when `ltv: true` (drops `signatures[]`).
  - `validate_pdf` → `{ standard, valid, errorCount, warningCount, summary }` (drops `errors[]`, `warnings[]`); `standard` echoes the rule set you asked for (`'pdf-ua-1'` or `'pdf-x-4'`).
  - `extract_text` → `{ pageCount, extractedPageCount, extractable, charCount }` (drops `pages[]`, `fullText`).
  - `extract_attachments` → `{ attachmentCount }` (drops `attachments[]`).
- `fields: ['a', 'b.c']` projects the structured result to named dot-paths (an array segment maps over every element, e.g. `['signatures.valid']`). It composes **after** `verbosity`; unknown paths are omitted leniently, and when something is unmatched the result carries `_meta.unmatchedFields` + `_meta.availableFields` so you can correct the path.
- `inspect_pdf check: [...]` returns `checks` with **only the requested keys** plus `checksPassed` (their AND). `check: 'signed'` is structural — at least one signature field with signed content; an extra unsigned placeholder does not negate it, and validity stays `verify_pdf`'s job.

Defaults are unchanged: omit both and you get the full v1.1.0-identical response. Smallest "is this PDF signed and valid?" probe: `{ pdfBase64, verbosity: 'summary', fields: ['allValid'] }`.

### Response cache
With `PDFNATIVE_MCP_CACHE_DIR` set, a repeated identical call (same tool, same input) may be answered from cache — the result then carries `_meta.cached: true` and returns the **earlier** call's bytes (e.g. the old `/CreationDate`, or an earlier `{date}` template placeholder) within the 1 h TTL. Never cached: `encrypt_pdf`, `decrypt_pdf`, `sign_pdf` (every call), `add_ltv`, `timestamp_pdf`, `update_metadata`, any document call carrying `encrypt`, and any `outputMode: 'file'` call. The key is namespaced by the tool API + package version and by the operator's pinned creation instant, so neither an upgrade nor a change of pin ever serves old bytes.

> **PDF bytes delivery:** generated PDFs (base64 mode) are returned **once** as an embedded `resource` content block (a `data:application/pdf;base64,…` URI), not duplicated into `structuredContent` (which is `{ mode, sizeBytes }`, plus `diagnostics[]` when `includeDiagnostics: true` and a `summary` for `add_ltv`). Read the bytes from the resource block.

### Protocol (v1.6.0)
- The server speaks MCP 2026-07-28 (stateless, `server/discover`, `resultType`, cache hints) and falls back automatically to the 2025-era `initialize` handshake. Whatever your host negotiates, the `tools/call` payload is the same.
- `tools/list` and `prompts/list` are safe to cache for 24 h (`cacheScope: 'public'`); `resources/*` results are private and must not be cached.
- Seven MCP prompts are advertised: `governance_contract`, `draft_issue_workflow`, `pades_ladder`, `print_ready` (bleed, marks, colour bars, CMYK, PDF/X-4), `reproducible_output`, `typography` (new in v1.7.0), `pdfa_valid` — read the one matching your workflow before the first call.
- Over HTTP (`PDFNATIVE_MCP_PORT`), the operator may require a bearer token (`PDFNATIVE_MCP_HTTP_TOKEN`): send `Authorization: Bearer <token>` or every `/mcp` request is answered 401. Without it HTTP mode has no authentication (loopback bind + Host/Origin guard only). stdio is unaffected.
- Operator environment, for reference (an agent never sets these): `PDFNATIVE_MCP_OUTPUT_DIR` (file-mode sandbox), `PDFNATIVE_MCP_CACHE_DIR` (opt-in response cache), `PDFNATIVE_MCP_PORT` / `PDFNATIVE_MCP_HTTP_TOKEN` (HTTP transport), `PDFNATIVE_MCP_MAX_INFLATE_BYTES` (engine decompression cap — a capped attachment stream is `PDF_PARSE_FAILED`, a capped content stream yields empty `extract_text` output), `PDFNATIVE_MCP_TSA_URL` / `PDFNATIVE_MCP_TSA_AUTH` (RFC 3161 TSA, the auth value is a secret never echoed), `PDFNATIVE_MCP_REVOCATION` + `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS` (online LTV), `PDFNATIVE_MCP_NETWORK_TIMEOUT_MS` (1000–120000 ms, default 10000), `PDFNATIVE_MCP_CREATION_DATE` (ISO 8601 instant with a time zone) and `SOURCE_DATE_EPOCH` (integer seconds) — the operator pin of the creation instant for the whole process: a call's own `creationDate` wins, then the first, then the second, then the wall clock; read once at boot, an invalid value refuses to start. Full table: [AGENT_CONTRACT.md](AGENT_CONTRACT.md) §4.
- `tools/list` is ≈ 306 kB (budgeted at 320 KiB by the gate) because every block kind, layout option, the `typography` fragment and the widened colour schemas are spelled out inline (no `$ref`); if your host has a tight context budget, read the `description` strings and `_meta.examples` first — the full `blocks` union is only needed when you compose a document.

### File output mode
- `outputMode: 'file'` only works if the host process set `PDFNATIVE_MCP_OUTPUT_DIR`. Otherwise the call fails with `SECURITY_VIOLATION`.
- `outputPath` must be **relative**, end in `.pdf`, and contain no path traversal segments.
- Files written this way are listed as MCP resources (`pdfnative://output/{+path}`); the result also carries a `resource_link`.

---

## 3. Recipes (multi-tool workflows)

### Factur-X / ZUGFeRD round-trip
1. `add_attachment` — embed the invoice XML (`relationship: 'Source'`) into a PDF/A-3b carrier.
2. `inspect_pdf` — assert `pdfA: '3B'` and that the attachment is present.
3. `extract_attachments` — pull the XML back out (`filename: 'factur-x.xml'`) and parse it downstream.
4. *(optional)* `validate_pdf` — confirm PDF/UA structural conformance.

### Sign and verify
1. `sign_pdf` — pass `certDerBase64` + one key form; the `/Sig` placeholder is auto-injected.
2. `verify_pdf` — confirm `allValid: true`. Supply `trustedRootsDerBase64` to upgrade `chainTrust` from `self-signed`/`unverified` to `trusted`.

### Sign with timestamp + LTV (B-LTA)
1. `sign_pdf` with `profile: 'pades'`, `timestamp: true`, `certChainDerBase64: [intermediates]`.
2. `add_ltv` with `mode: 'online'` (operator provider) or `mode: 'offline'` + exported DER material.
3. `timestamp_pdf` — document timestamp; repeat before the TSA certificate expires.
4. `verify_pdf` with `ltv: true` — expect `ltvLevel: 'B-LTA'` and `allValid: true`.

### Authoring a PDF/A document
1. `generate_basic_pdf` (or `add_table` / `add_international_text`) with `pdfA: 'pdfa2b'` and `embedFonts: true` (+ `strict: true` to fail on any conformance diagnostic).
2. `validate_pdf` — assert `valid: true` for PDF/UA structure before delivery.
3. *(optional, contributors)* `npm run validate:pdfa` — veraPDF run on the generated corpus (blocking in CI since v1.7.0).

### Print-ready with bleed and marks
1. `generate_basic_pdf` / `add_table` / `add_chart` / … with `print: { bleed: 8.5, marks: true }` and `metadata: { trapped: 'False' }`.
2. `inspect_pdf` with `pages: true` — read `trimBox` / `bleedBox` back; `check: ['trapped']` asserts the flag.
3. *(optional)* a colour control strip: `print: { bleed: 14.17, marks: { crop: true, registration: true, colourBars: true } }` — see [`print-colour-bars.json`](../examples/print-colour-bars.json).

### PDF/X-4 print exchange
1. Get the printer's ICC profile (device class `prtr`, CMYK or Gray). None is bundled, and an sRGB / monitor profile is refused.
2. `generate_basic_pdf` (or `add_table` / `add_chart` / `add_barcode` / `embed_image` / `add_international_text`) with `pdfx: 'pdfx4'`, `embedFonts: true`, `outputIntent: { iccProfileBase64, outputConditionIdentifier }`, `metadata: { trapped: 'False' }`, `print: { bleed: 8.5, marks: true }` — no `pdfA`, no `encrypt`, no `link` / `formField` blocks. Add `strict: true` to fail on any `PDFX_*` diagnostic.
3. `validate_pdf` with `standard: 'pdf-x-4'` — expect `valid: true` and read `caveats[]`: the check is structural, **not a certified preflight**.
4. `inspect_pdf` with `check: ['pdfx', 'trapped']`. Examples: [`pdfx4-gray.json`](../examples/pdfx4-gray.json), [`pdfx4-cmyk-validate.json`](../examples/pdfx4-cmyk-validate.json).

### CMYK colours
1. Any document tool with CMYK colour inputs, e.g. `watermark: { text: 'PROOF', color: [0, 100, 100, 0] }`, `headerTemplate: { left: '{title}', color: '0 0 0 0.8' }`, chart series `color: '1 0 0 0'`, `cellBorders: { all: true, color: [0, 0, 0, 40] }` — see [`cmyk-colours.json`](../examples/cmyk-colours.json).
2. Under `pdfA` / `pdfx` add a CMYK `outputIntent`, and `includeDiagnostics: true` to confirm no `PDFA_DEVICE_CMYK_CONTENT` / `PDFX_DEVICE_CMYK` is raised.

### Book-quality text
1. `inspect_layout` with the `blocks`, `embedFonts: true` and `typography: { splitParagraphs: true, orphans: 3, widows: 3, keepHeadingsWithNext: true, opticalMargins: true, kerning: true, fontFeatures: ['onum', 'smcp'] }`; paragraphs carry `align: 'justify'`, long words carry soft hyphens (U+00AD).
2. `generate_basic_pdf` with exactly the same inputs — see [`typography-report.json`](../examples/typography-report.json). Base-14 text with exact widths instead of embedding: `typography: { metrics: 'exact' }` ([`typography-exact-metrics.json`](../examples/typography-exact-metrics.json)).

### French typography
1. Any document tool with `embedFonts: true` and `typography: { punctuationSpacing: 'fr', unitBinding: true, bindShortWords: true }` — write the text with ordinary spaces before `;` `!` `?` `:` and inside `« »`; they become (narrow) no-break spaces. See [`typography-french.json`](../examples/typography-french.json).
2. Without `embedFonts: true` the narrow space does not exist in Helvetica and `'fr'` degrades to `'fr-CA'`.

### Reproducible output
1. Any document tool with `creationDate: '2026-01-01T00:00:00Z'` — twice, on any two hosts: the base64 is identical. A `footerTemplate` using `{date}` prints that UTC date ([`reproducible-footer-date.json`](../examples/reproducible-footer-date.json)).
2. Signing: also pin `signingTime` (RSA only — ECDSA is randomised); `update_metadata`: pin `modDate`. Timestamps and encryption are never reproducible.

### New scripts, African languages, skin tones
1. `add_international_text` with `lang: ['lo', 'nod', 'khb', 'tdd', 'cjm', 'latin']` and, for archiving, `pdfA: 'pdfa2b'` (not `pdfa2u` — Tai Tham) — [`scripts-lao-tai-cham.json`](../examples/scripts-lao-tai-cham.json).
2. `lang: ['yo', 'ig', 'ha', 'sw']` for Yoruba / Igbo / Hausa / Swahili ([`african-languages.json`](../examples/african-languages.json)); `lang: ['latin', 'emoji']` for skin-tone sequences ([`emoji-skin-tones.json`](../examples/emoji-skin-tones.json)).

### Stacked / area / scatter / dual-axis chart
1. `add_chart` with `chartType: 'stackedBar'` (or `'area'`, `'scatter'` + `xValues` + `xAxis: { type: 'linear' | 'time' }`); bind a series to `yAxis: 'right'` and configure `axis2` for a dual-axis chart; `dataLabels: true` prints values.
2. *(optional)* `inspect_pdf` to confirm the document, or `validate_pdf` when `pdfA` is set (the chart carries `/Figure` + `/Alt`).

### Update metadata of an existing PDF
1. `update_metadata` with `author` / `keywords` / … (pin `modDate` for reproducible bytes — the operator's creation-date pin does not cover it; XMP dates are rewritten too).
2. `sign_pdf` / `timestamp_pdf` again if the latest revision must be signed — the update is an unsigned incremental revision.

### Composite document with pagination preview
1. `inspect_layout` with `title`, the full `blocks[]` (`toc`, `heading`, `paragraph`, `table`, `image`, `svg`, `barcode`, `link`, `formField`, `chart`…), `pageSize: 'Letter'`, `headerTemplate: { right: '{title} — {page}/{pages}' }`, `verbosity: 'summary'`, `fields: ['totalPages']` — adjust the content until the page count is right (it matches the built document, `toc` included).
2. `generate_basic_pdf` with exactly the same inputs plus `outline: 'auto'` (and `embedFonts: true` + `pdfA: 'pdfa2b'` for archival).
3. *(optional)* `inspect_pdf` with `pages: true` / `annotations: true` to confirm page count and link annotations.

### Encrypted fillable form
1. `add_form` with the fields and `encrypt: { ownerPassword, userPassword }` — the AcroForm survives (the post-hoc `encrypt_pdf` would rebuild the page tree and drop it). Do not combine with `pdfA`.
2. `read_form_fields` / `fill_form` with `password` to work on it later.

### Watermarked report
1. `add_table` with `watermark: { text: 'CONFIDENTIAL', opacity: 0.2 }` — or a logo: `watermark: { image: { imageBase64, mimeType: 'image/png' }, position: 'foreground' }`.
2. *(optional)* `inspect_pdf` to confirm the page count / metadata.

### Bookmarked report
1. `generate_basic_pdf` with `outline: 'auto'`, `pageLabels`, and `viewerPreferences: { pageMode: 'useOutlines' }`.
2. *(optional)* `inspect_pdf` to confirm the page count.

### Assemble / carve PDFs
1. Generate the parts (any authoring tool), then `merge_pdfs` to join them — **or** `split_pdf` (per range) / `extract_pages` (one subset) on an existing PDF.
2. `inspect_pdf` to confirm the resulting page count.

### Annotate a PDF for review
1. `annotate_pdf` with `{ type: 'highlight', page, rect, contents }` and/or `{ type: 'text', … }` entries.
2. *(optional)* `inspect_pdf` to confirm the document still opens and page count is unchanged. Remember: annotations overlay, they do **not** redact.

### Propose an upstream change (human submits)
1. Search existing issues, then `draft_governance_issue` with a reproduction and `duplicateSearchPerformed: true`.
2. Review the returned `draftMarkdown` + `complianceReport`; a **human** copies the draft into GitHub and submits it. The server never does.

---

## 4. Self-documenting metadata

Every tool ships:
- `_meta.apiVersion` = `'1.7.0'` — see [`API_STABILITY.md`](API_STABILITY.md).
- `_meta.examples`   — one or two executable worked examples per tool (the rest live in [`../examples/`](../examples)). Inspect the `ListTools` response to discover them.
- Read tools declare a projectable `outputSchema` (every property optional, `additionalProperties: false`) so `structuredContent` validates under `verbosity` / `fields` as well.

You can rely on these fields when negotiating capabilities before calling a tool.

---

## 5. When things still fail

The MCP error response always includes a `code` and a message:

| `code` | Meaning | Fix |
|---|---|---|
| `VALIDATION_ERROR` | Zod rejected the input: wrong type, unknown key (strict), empty base64, PEM where DER is expected, out-of-range page index / range on `merge_pdfs` / `split_pdf` / `extract_pages`, an unsupported PNG (alpha / palette / 16-bit / interlaced), the 24 MiB image budget, a `link` URL outside `http:` / `https:` / `mailto:`, `encrypt` together with `pdfA`, an incoherent `pdfx` request (`pdfx` with `pdfA`, `pdfx` with `encrypt`, no `outputIntent`, `metadata.trapped: 'Unknown'`, `print.artBox` beside a TrimBox, an ICC profile whose device class is not `prtr`), a malformed CMYK colour, a `typography` value out of bounds, more than 50 000 engine blocks | Re-read the field’s schema (the message lists the offending path); for PEM run the `openssl … -outform DER` command in the message; page indices are 0-based; flatten / re-export the PNG; split the document; for `pdfx` keep one conformance claim, drop `encrypt`, and pass the printer's `prtr` profile. |
| `PDF_PARSE_FAILED` | Input PDF is malformed or truncated — since v1.7.0 also the classification of **any unexpected failure** on a damaged PDF input, so no uncoded failure escapes (also double-encoded base64, PEM text or a nested `data:` URI passed as a PDF; `validate_pdf` on an unparsable file; a compressed stream over the operator's decompression cap on `extract_attachments includeData: true`) | Re-encode the base64 once; verify the source PDF opens in a normal reader; for the cap, the operator raises `PDFNATIVE_MCP_MAX_INFLATE_BYTES` if the document is trusted. |
| `PDF_A_COMPLIANCE_VIOLATION` | Watermark `opacity < 1.0` (text or image, defaults included) under `pdfa1b`; `strict: true` with an engine `PDFA_*` diagnostic (`PDFA_NO_FONT_ENTRIES` unembedded Helvetica, `PDFA_UNEMBEDDED_FORM_FONT` form built without `embedFonts`, `PDFA_DEVICE_CMYK_IMAGE` CMYK JPEG, `PDFA_DEVICE_CMYK_CONTENT` CMYK colours against an RGB intent, `PDFA_ICC_PROFILE_VERSION` ICC v4 under `pdfa1b`); `print.userUnit` under `pdfa1b` | Set `opacity: 1.0` or `pdfa2b`+; add `embedFonts: true` (forms included); keep images and colours RGB or supply a CMYK `outputIntent`; use an ICC v2 profile or `pdfa2b`+; drop `userUnit` or use `pdfa2b`+. |
| `PDF_X_COMPLIANCE_VIOLATION` | **New in v1.7.0, only under `strict: true`:** the engine raised a `PDFX_*` diagnostic under `pdfx: 'pdfx4'` (`PDFX_NO_FONT_ENTRIES` text not embedded, `PDFX_DEVICE_CMYK` CMYK content under a non-CMYK printing condition, `PDFX_ANNOTATIONS` a `link` / `formField` block) | Add `embedFonts: true`; match the colours to the `outputIntent`; remove `link` / `formField` blocks. `includeDiagnostics: true` shows the codes without failing. |
| `DIAGNOSTIC_ESCALATED` | **New in v1.7.0, only under `strict: true`:** an engine diagnostic that is neither PDF/A nor PDF/X — today `TYPOGRAPHY_FEATURE_INEFFECTIVE` (`tnum` / `lnum` on Noto Sans, or a font feature without an embedded font). The message starts with `[CODE]` | Drop the ineffective feature, add `embedFonts: true`, or drop `strict`. |
| `PRINT_ERROR` | Engine rejected `print` / `outputIntent` (box outside MediaBox, marks without TrimBox, a file that is not an ICC profile — no `acsp` signature, declared size larger than the bytes — or a colour space other than RGB / CMYK / Gray) | Fix the boxes, supply `bleed` / `trimBox`, pass a real ICC profile base64-encoded once (hand-made stubs are rejected since v1.7.0). |
| `CHART_ERROR` | Chart cross-field rule violated (log scale with non-positive values, scatter without `xValues`, …) | The message carries the remedy. |
| `METADATA_ERROR` | `update_metadata` could not rewrite `/Info` | Confirm the PDF opens; report with a reproduction if it persists. |
| `GENERATION_FAILED` | Generic engine throw while building | The message carries the engine text. |
| `ATTACHMENT_BUILD_FAILED` | `add_attachment`: the engine threw while building the PDF/A-3 document (bad MIME type, unreadable payload, …) | The message carries the engine text; fix the attachment it names. |
| `PLACEHOLDER_FAILED` | `sign_pdf` (auto-inject) / `prepare_signature_placeholder`: the engine could not inject the `/Sig` placeholder | Check the source PDF opens; for a custom `pageIndex` confirm the page exists. |
| `VERIFY_FAILED` | `verify_pdf`: structural failure before signature checks (ByteRange beyond the file, unsupported EC public-key encoding) | Re-encode the base64; confirm the PDF is not truncated. |
| `TSA_NOT_CONFIGURED` / `TSA_REJECTED` | No `PDFNATIVE_MCP_TSA_URL`, or the TSA answered with a failure / bad imprint / bad nonce | Operator configures the TSA; check auth; raise `placeholderBytes`. |
| `REVOCATION_NOT_CONFIGURED` | `add_ltv mode: 'online'` without `PDFNATIVE_MCP_REVOCATION` + allow-list | Operator configures both, or use `mode: 'offline'`. |
| `NETWORK_HOST_NOT_ALLOWED` / `NETWORK_ERROR` | Responder URL not allow-listed / internal address, or the request failed (timeout, HTTP status, size cap) | Allow-list the host verbatim; check connectivity and env values. |
| `LTV_NO_SIGNATURE` / `LTV_EMPTY` / `LTV_MATERIAL_INVALID` / `LTV_ERROR` | No signed signature; nothing collectable; offline DER blob does not parse; other LTV failure | Sign first; use offline material; export DER not PEM. |
| `PLACEHOLDER_AMBIGUOUS` / `SIGNATURE_FIELD_NOT_FOUND` | Several unsigned placeholders without `fieldName`, or `fieldName` unknown | List fields with `inspect_pdf signatures: true` and pass `fieldName`. |
| `ENCRYPTED_SOURCE` | Encrypted input on `annotate_pdf`, `update_metadata`, `add_ltv`, `timestamp_pdf` (the only tools that raise it; no `password` input) | `annotate_pdf` / `update_metadata`: run `decrypt_pdf` first (drops signatures/AcroForm), then `encrypt_pdf` again. `add_ltv` / `timestamp_pdf`: `decrypt_pdf` would drop the signatures — sign / timestamp the unencrypted document and encrypt last. |
| `PASSWORD_REQUIRED` / `PASSWORD_INVALID` | Encrypted source without `password`, or the password did not open it (read-only and page-tree tools, `fill_form`, `decrypt_pdf`) | Pass the `password` input (user or owner password both work). |
| `ENCRYPTION_UNSUPPORTED` | Security handler this server cannot open | The document uses an unsupported scheme. |
| `ENCRYPTION_ERROR` | Re-encryption failed (e.g. no Web Crypto CSPRNG) | Run under a runtime with Web Crypto available. |
| `MISSING_PLACEHOLDER` | `sign_pdf` called with `autoInjectPlaceholder: false` on a PDF without `/Sig` | Set `autoInjectPlaceholder: true` (the default) or call `prepare_signature_placeholder` first. |
| `FORM_FIELD_NOT_FOUND` | `fill_form` value key matched no field | Use `read_form_fields` to list names, or `onUnknownField: 'ignore'`. |
| `FORM_VALUE_TYPE_ERROR` | Wrong value type / choice not in options | Match the field type; use a valid option. |
| `FORM_UNSUPPORTED` | Tried to fill / flatten a signature field | Sign with `sign_pdf` instead. |
| `EXTRACTION_UNSUPPORTED` | **Legacy — never raised.** Kept in the contract for compatibility only | Encrypted reads use `password` (`PASSWORD_REQUIRED` / `PASSWORD_INVALID` otherwise). |
| `ATTACHMENT_NOT_FOUND` | `extract_attachments` `filename` filter matched no embedded file | Omit `filename`, or call `inspect_pdf` to list the real attachment names. |
| `ATTACHMENT_TOO_LARGE` | An `add_attachment` payload exceeds the 8 MiB per-file cap | Compress / shrink the payload, or split it across files. |
| `OUTPUT_TOO_LARGE` | Generated PDF over 50 MiB, or extracted attachments over the 16 MiB/file · 32 MiB aggregate caps | Reduce embedded images / split documents; for extraction use `includeData: false` or the `filename` filter. |
| `UNSUPPORTED_LANG` | `add_international_text` `lang` not in the supported set | Use a supported code — the message lists them (see the international-text pitfalls). |
| `FONT_LOAD_FAILED` | A bundled Noto font module failed to load | Retry; if it persists the install is corrupt — reinstall `pdfnative`. |
| `SIGNING_FAILED` / `CMS_PARSE_FAILED` / `EC_KEY_PARSE_FAILED` / `EC_CURVE_UNSUPPORTED` | Signing or key/cert material problem | Re-check the DER encodings; ECDSA keys must be P-256. (Unparsable cert / chain / key blobs are `VALIDATION_ERROR` with the `openssl` remedy.) |
| `SECURITY_VIOLATION` | Sandbox or path-traversal rejection | Check `PDFNATIVE_MCP_OUTPUT_DIR` is set and `outputPath` is relative + ends in `.pdf`. |
| `MISSING_OUTPUT_PATH` | `outputMode: 'file'` without `outputPath` | Pass a relative `outputPath`. |
| `INVALID_PATH` | `outputPath` empty / not a string | Pass a non-empty relative path. |
| `INVALID_EXTENSION` | `outputPath` does not end in `.pdf` (`.md` for `draft_governance_issue`) | Fix the extension. |
| `GOVERNANCE_VIOLATION` | `draft_governance_issue` draft breaks the governance contract (proposes a runtime dependency, missing reproduction, or `duplicateSearchPerformed: false`) | Remove the dependency proposal, include a reproduction, confirm the duplicate search. |
| `[UNKNOWN_TOOL]` | **Protocol error, not a tool result:** `tools/call` with a tool name that does not exist → JSON-RPC `-32602` with message `[UNKNOWN_TOOL] Unknown tool: <name>` | Pick a name from `tools/list` (28 tools). |
| `UNKNOWN_RESOURCE` | **Protocol error:** `resources/read` with an unknown `pdfnative://` URI → JSON-RPC `-32602`, the code is carried in the message | List URIs with `resources/list`. |

The authoritative table — all 47 codes, one row each — is [AGENT_CONTRACT.md](AGENT_CONTRACT.md) §6.

If a tool seems to return correct PDFs that downstream readers reject, run `inspect_pdf` and / or `verify_pdf` to confirm the byte-level structure.
