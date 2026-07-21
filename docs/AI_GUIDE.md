# AI Agent Guide — pdfnative-mcp

> **Read this first if you are an AI agent (Copilot, Claude, Cursor, Continue, Zed, Windsurf, Cline, Roo Code, …) about to call pdfnative-mcp.**
> It tells you which of the 24 tools to pick and how to avoid the common retry loops.

The server also returns the same decision tree in `serverInfo.instructions`. The full reference lives in [`KNOWLEDGE_BASE.md`](KNOWLEDGE_BASE.md); the stability charter in [`API_STABILITY.md`](API_STABILITY.md). Worked invocations are in [`../examples/`](../examples).

---

## 1. Decision tree — pick the right tool in one step

| You want to… | Tool |
|---|---|
| A plain document (headings, paragraphs, lists) | `generate_basic_pdf` |
| A QR code or barcode | `add_barcode` |
| Non-Latin text (Arabic, Hindi, CJK, …) | `add_international_text` |
| A tabular report | `add_table` |
| An interactive AcroForm | `add_form` |
| Embed a JPEG/PNG into a PDF | `embed_image` |
| Digitally sign any PDF | `sign_pdf` *(auto-injects placeholder)* |
| Customize the signature placeholder before signing | `prepare_signature_placeholder` → `sign_pdf` |
| **Factur-X / ZUGFeRD invoice** or any PDF with attachments | `add_attachment` *(NOT `generate_basic_pdf`)* |
| **Pull embedded files back out** (e.g. Factur-X XML) | `extract_attachments` |
| Inspect / assert metadata | `inspect_pdf` |
| Verify all PAdES signatures | `verify_pdf` |
| Validate PDF/UA accessibility structure | `validate_pdf` |
| Extract plain text | `extract_text` |
| Join several PDFs into one | `merge_pdfs` |
| Split one PDF into per-range documents | `split_pdf` |
| Keep an arbitrary page subset (one PDF) | `extract_pages` |
| Overlay markup annotations on a PDF (review layer) | `annotate_pdf` |
| Draft a GitHub issue for a human to submit | `draft_governance_issue` |

---

## 2. Common pitfalls (these cause the most retries)

### Barcodes / QR codes
- `data` is the **raw** payload. To produce a QR pointing at `https://google.com`, send `{ "format": "qr", "data": "https://google.com" }` — **do not** URL-encode the URL.
- `ecLevel` (`L`/`M`/`Q`/`H`) applies **only** when `format='qr'`. It is silently ignored for `code128`, `ean13`, `datamatrix`, `pdf417`.
- Use `ecLevel: 'H'` for printed media that may be smudged or partially covered (e.g. logo overlay).
- `ean13` requires **12 or 13 digits**. Pass 12, the 13th check digit is auto-computed.

### Digital signing
- `sign_pdf` **auto-injects** a `/Sig` placeholder when missing (since v1.0.0). You can sign **any** PDF in a single call — no need to run `prepare_signature_placeholder` first.
- All key/cert material is **DER, base64-encoded** (no PEM). Convert with:
  - cert: `openssl x509 -in cert.pem -outform DER | base64 -w0` → `certDerBase64`
  - RSA key (PKCS#1!): `openssl rsa -in key.pem -outform DER -traditional | base64 -w0` → `rsaKeyPkcs1DerBase64`
  - ECDSA key (PKCS#8 or SEC1): `openssl pkey -in key.pem -outform DER | base64 -w0` → `ecPrivateKeyDerBase64`
  - ECDSA scalar form: `ecPrivateScalarHex` = 64 hex chars (raw P-256 `d`)
- After signing, call `verify_pdf` to confirm. Without `trustedRootsDerBase64`, `chainTrust` is `'self-signed'` or `'unverified'` — that is expected.
- RSA and EC-DER keys sign through a constant-time `node:crypto` provider (with a transparent pure-JS fallback); the raw-scalar `ecPrivateScalarHex` path uses the pure-JS signer. Signatures are interoperable either way.

### Combining / carving PDFs (page-tree)
- `merge_pdfs` joins 2–50 PDFs (`pdfsBase64[]`) into one. `split_pdf` cuts one PDF into one document per `ranges[]` entry (`{ start, end? }`, 0-based inclusive). `extract_pages` keeps an arbitrary `pages[]` subset (0-based) in a single PDF.
- `split_pdf` returns a **multi-output** result (`{ mode, count, totalSizeBytes, parts[] }`); in `file` mode each part is written to an indexed path (`report.pdf` → `report-1.pdf`, …).
- **Encrypted sources are rejected** with `ENCRYPTED_SOURCE` — decrypt outside the server first. Oversize output throws `OUTPUT_TOO_LARGE`.

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
- `generate_basic_pdf` and `add_table` accept an optional `watermark: { text, fontSize?, opacity?, angle?, color?, position? }` rendered on every page. `color` is an `[r, g, b]` triple in the `0.0–1.0` range.
- Defaults match pdfnative: `opacity 0.15`, `angle -45`, light-gray, `position 'background'`. Omit `watermark` and output is byte-identical to before.
- **PDF/A-1b forbids transparency** (ISO 19005-1 §6.4): combining `opacity < 1.0` with `pdfA: 'pdfa1b'` throws. Use `opacity: 1.0` or a PDF/A-2/3 level.

### Unicode normalization
- `generate_basic_pdf` and `add_international_text` accept an optional `normalize: 'NFC' | 'NFD' | 'NFKC' | 'NFKD'`. `add_international_text` defaults to `'NFC'` (best glyph coverage for complex scripts); `generate_basic_pdf` defaults to no normalization (byte-stable). Only set it when input may contain decomposed combining sequences (e.g. macOS-copied text).

### PDF/A
- Pass `pdfA: 'pdfa2b'` for the widest reader compatibility.
- Use `pdfa3b` when (and only when) you have attachments.
- Write text **naturally** — embedded `\n` in a paragraph is auto-split into separate paragraphs; never emit a literal newline expecting a soft line break.
- The Euro sign `€` and other CP-1252 symbols render and extract correctly (pdfnative 1.3). Do **not** substitute `EUR` for `€`.
- Wrapped table cells get unique per-line MCIDs automatically — tagged tables are PDF/UA-safe.
- After generating a tagged/PDF-A document, call `validate_pdf` to assert PDF/UA structural conformance.
- See [`guides/PDFA.md`](guides/PDFA.md) for the per-tool capability matrix.

### International text
- `add_international_text` covers **24 scripts** (incl. Telugu, Sinhala, Tibetan, Khmer, Myanmar, Ethiopic) and COLRv1 colour emoji. Pass `lang` as a single code, a comma-separated string, or an array (e.g. `["ar", "emoji"]`) for multi-script runs.
- For mathematical / scientific symbols, add the **explicit** `math` script, e.g. `lang: ["latin", "math"]`. It embeds the Noto Sans Math face **only when requested** — there is no global auto-routing, so plain `latin` text will not pick up math glyphs on its own.
- Input is NFC-normalised automatically; you do not need to pre-compose decomposed sequences.

### Annotating an existing PDF (review overlay)
- `annotate_pdf` overlays markup annotations via an incremental update. Types: `text` (sticky note), `highlight`, `underline`, `strikeout`, `squiggly`, `square`, `circle`, `line`, `freetext`. Each entry needs a 0-based `page`, a `rect: [x1, y1, x2, y2]`, and optional `color` / `contents`.
- This is a **visual review layer, NOT a redaction** — the underlying page content is untouched, so never use it to hide sensitive data.
- Encrypted sources are rejected with `ENCRYPTED_SOURCE`; out-of-range `page` indices are rejected by validation.

### Drafting a GitHub issue (human-in-the-loop)
- `draft_governance_issue` produces a **local** draft `.md` + a machine-readable compliance report. It **never** submits to GitHub and makes **no** outbound network call — you are a draftsman; a human is the only gate that submits.
- Always set `duplicateSearchPerformed: true` (after actually searching) and include a `reproduction: { command, result }`. Proposing a runtime dependency, omitting the reproduction, or `duplicateSearchPerformed: false` is rejected with `GOVERNANCE_VIOLATION`.
- Read the `governance_contract` and `draft_issue_workflow` MCP prompts first; the full contract is in [`guides/AI_GOVERNANCE.md`](guides/AI_GOVERNANCE.md).

### Text extraction
- `extract_text` returning `extractable: false` is **not an error**. The PDF uses subset fonts without `/ToUnicode` CMaps; the `extractableReason` field explains. The file is not corrupt.
- Encrypted PDFs are rejected with `EXTRACTION_UNSUPPORTED`.

### Token-frugal reads (v1.2.0)
The four read-only tools — `inspect_pdf`, `verify_pdf`, `validate_pdf`, `extract_text` — accept two **optional** inputs that shrink the response (typically ~90% fewer output tokens for large results) without losing the fields you branch on:

- `verbosity: 'summary'` returns a compact scalar-only verdict and drops the heavy arrays / full text:
  - `inspect_pdf` → `{ version, pageCount, encryption, pdfA, signatureCount, hasSignaturePlaceholder, attachmentCount }` (drops `attachments[]`, `info`, `perPage`).
  - `verify_pdf` → `{ signatureCount, allValid, invalid, summary }` (drops `signatures[]`).
  - `validate_pdf` → `{ standard, valid, errorCount, warningCount, summary }` (drops `errors[]`, `warnings[]`).
  - `extract_text` → `{ pageCount, extractedPageCount, extractable, charCount }` (drops `pages[]`, `fullText`).
  - `extract_attachments` → `{ attachmentCount }` (drops `attachments[]`).
- `fields: ['a', 'b.c']` projects the structured result to named dot-paths (an array segment maps over every element, e.g. `['signatures.valid']`). It composes **after** `verbosity`; unknown paths are omitted leniently.

Defaults are unchanged: omit both and you get the full v1.1.0-identical response. Smallest "is this PDF signed and valid?" probe: `{ pdfBase64, verbosity: 'summary', fields: ['allValid'] }`.

> **PDF bytes delivery:** generated PDFs (base64 mode) are returned **once** as an embedded `resource` content block (a `data:application/pdf;base64,…` URI), not duplicated into `structuredContent` (which is `{ mode, sizeBytes }`). Read the bytes from the resource block.

### File output mode
- `outputMode: 'file'` only works if the host process set `PDFNATIVE_MCP_OUTPUT_DIR`. Otherwise the call returns `SecurityError`.
- `outputPath` must be **relative**, end in `.pdf`, and contain no path traversal segments.

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

### Authoring a PDF/A document
1. `generate_basic_pdf` (or `add_table` / `add_international_text`) with `pdfA: 'pdfa2b'`.
2. `validate_pdf` — assert `valid: true` for PDF/UA structure before delivery.

### Watermarked report
1. `add_table` with `watermark: { text: 'CONFIDENTIAL', opacity: 0.2 }`.
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
- `_meta.apiVersion` = `'1.5.0'` — see [`API_STABILITY.md`](API_STABILITY.md).
- `_meta.examples`   — at least one worked example per tool. Inspect the `ListTools` response to discover them.

You can rely on these fields when negotiating capabilities before calling a tool.

---

## 5. When things still fail

The MCP error response always includes a `code` and a message:

| `code` | Meaning | Fix |
|---|---|---|
| `VALIDATION_ERROR` | Zod rejected the input | Re-read the field’s schema (the message lists the offending path). |
| `PDF_PARSE_FAILED` | Input PDF is malformed or truncated | Re-encode the base64; verify the source PDF opens in a normal reader. |
| `PDF_A_COMPLIANCE_VIOLATION` | `generate_basic_pdf` / `add_table` watermark with `opacity < 1.0` (incl. the 0.15 default) under `pdfA: 'pdfa1b'` | Set `watermark.opacity: 1.0`, or target `pdfa2b` / `pdfa3b` (which allow transparency). |
| `MISSING_PLACEHOLDER` | `sign_pdf` called with `autoInjectPlaceholder: false` on a PDF without `/Sig` | Set `autoInjectPlaceholder: true` (the default) or call `prepare_signature_placeholder` first. |
| `EXTRACTION_UNSUPPORTED` | Encrypted PDF passed to `extract_text` / `extract_attachments` | Decrypt the PDF outside the server first. |
| `ATTACHMENT_NOT_FOUND` | `extract_attachments` `filename` filter matched no embedded file | Omit `filename`, or call `inspect_pdf` to list the real attachment names. |
| `ATTACHMENT_TOO_LARGE` | An `add_attachment` payload exceeds the 8 MiB per-file cap | Compress / shrink the payload, or split it across files. |
| `OUTPUT_TOO_LARGE` | Generated PDF over 50 MiB, or extracted attachments over the 16 MiB/file · 32 MiB aggregate caps | Reduce embedded images / split documents; for extraction use `includeData: false` or the `filename` filter. |
| `UNSUPPORTED_LANG` | `add_international_text` `lang` not in the supported set | Use a supported code (see the international-text pitfalls). |
| `FONT_LOAD_FAILED` | A bundled Noto font module failed to load | Retry; if it persists the install is corrupt — reinstall `pdfnative`. |
| `SIGNING_FAILED` / `CMS_PARSE_FAILED` / `EC_KEY_PARSE_FAILED` / `EC_CURVE_UNSUPPORTED` | Signing or key/cert material problem | Re-check the DER encodings; ECDSA keys must be P-256. |
| `SECURITY_VIOLATION` | Sandbox or path-traversal rejection | Check `PDFNATIVE_MCP_OUTPUT_DIR` is set and `outputPath` is relative + ends in `.pdf`. |

If a tool seems to return correct PDFs that downstream readers reject, run `inspect_pdf` and / or `verify_pdf` to confirm the byte-level structure.
