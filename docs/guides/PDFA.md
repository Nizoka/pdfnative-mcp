# PDF/A authoring guide (for AI agents)

This guide tells you, in two pages, **when to pick which PDF/A part** and **which pitfalls trip up automated PDF/A generators**. It is intentionally short and copy-paste friendly.

## TL;DR — pick a conformance level

| Use case | Pick | pdfnative-mcp tool input |
| --- | --- | --- |
| Long-term archival of a generated report | `PDF/A-2b` | `pdfA: 'pdfa2b'` |
| Same, but you need Unicode mapping for every glyph (legal, scientific) | `PDF/A-2u` | `pdfA: 'pdfa2u'` |
| Legacy compatibility with PDF 1.4 archivers | `PDF/A-1b` | `pdfA: 'pdfa1b'` |
| Embedded files (Factur-X, ZUGFeRD, ISO 20022) | `PDF/A-3b` | `add_attachment` (sets `pdfa3b` automatically) |
| Universal accessibility (screen readers) | `PDF/A-2u` + tagging | `pdfA: 'pdfa2u'`, then check structure with `validate_pdf` |

> When in doubt, use **`pdfa2b`**. It is the broadest, best-supported archival profile.
> Need to confirm accessibility structure? Run [`validate_pdf`](../KNOWLEDGE_BASE.md#validate_pdf) — a read-only PDF/UA (ISO 14289-1) structural check.

## Hard rules pdfnative-mcp enforces for you

1. Fonts must be **embedded** — but this is *not* automatic for Latin text. The eight Latin document tools — `generate_basic_pdf`, `add_table`, `add_form`, `embed_image`, `add_barcode`, `add_attachment`, `add_chart` and `prepare_signature_placeholder` — render Latin text through the base-14 Helvetica, which is **not embedded** and voids the PDF/A claim (ISO 19005 §6.2.11.4.1). Pass `embedFonts: true` (new in 1.6.0) to embed Noto Sans instead, or use `add_international_text`, which has no `embedFonts` input because it always embeds the Noto fonts it renders with. Set `strict: true` to turn the silent diagnostic into a `PDF_A_COMPLIANCE_VIOLATION` error. Two more diagnostics (1.6.0) follow the same path: `PDFA_UNEMBEDDED_FORM_FONT` — any form field (`add_form`, `formField` block) under a PDF/A claim keeps an unembedded `/DR /Helv` widget font even with `embedFonts` (engine gap; flatten or drop the claim) — and `PDFA_DEVICE_CMYK_IMAGE` — a CMYK JPEG (`embed_image`, `image` block) against the sRGB OutputIntent (keep images RGB).
2. An **OutputIntent** with sRGB ICC is added — done by pdfnative.
3. The document **must not be encrypted** — on the document tools `encrypt` + `pdfA` is rejected with `VALIDATION_ERROR` (ISO 19005-1 §6.3.2), and `encrypt_pdf` (or the page-tree `encrypt` option) rebuilds the document without the XMP packet, so any PDF/A claim is dropped rather than combined with encryption. Layout options are PDF/A-neutral: `compress` leaves the XMP packet uncompressed (bytes change, the claim holds), `pageSize` / `margins` / templates only move content, `debug` draws plain stroked rectangles (no transparency) — but as unmarked content, so not for PDF/UA. A text or image watermark below opacity 1.0 is rejected under `pdfa1b` only.
4. **No JavaScript, no actions, no movies, no XFA** — none of pdfnative-mcp's tools emit these.
5. **XMP `pdfaid:part` / `pdfaid:conformance` keys** are written — verified by `inspect_pdf` via the `pdfA` field.

## Common mistakes

- **Emitting literal newlines in a paragraph.** Write multi-line text naturally — the server auto-splits embedded `\n` into separate paragraph blocks. A literal `\n` is not a glyph; pre-1.1 this produced `.notdef` tofu in PDF/A.
- **Substituting `EUR` for `€`.** No longer needed — since pdfnative 1.3 the Euro sign and other CP-1252 symbols render and extract correctly. Use the real `€` character.
- **Worrying about wrapped table cells.** Wrapped cells now receive a unique MCID per line (pdfnative 1.3), so tagged/PDF-A tables are PDF/UA-safe automatically.
- **Mixing attachments with PDF/A-1 or PDF/A-2.** Attachments are only legal in PDF/A-3. The `add_attachment` tool enforces this by always emitting `pdfa3b`. If you call `generate_basic_pdf` with `pdfA: 'pdfa2b'` *and* try to attach a file in a follow-up step, the chain will fail validation.
- **Using `generate_basic_pdf` for Factur-X and then re-running pdfnative on the bytes.** Round-tripping a PDF/A-3b document through a non-PDF/A-aware builder strips the XMP — call `add_attachment` directly with the desired body blocks instead.
- **Forgetting to inspect afterwards.** Always call `inspect_pdf` and assert `checks.pdfa === true` in your test pipeline, and `validate_pdf` for PDF/UA structure:
  ```json
  { "name": "inspect_pdf", "arguments": { "pdfBase64": "...", "check": ["pdfa"] } }
  ```

## Two-step workflows that produce conformant PDF/A

### PDF/A-2b plain report

```jsonc
// 1) Generate
{ "name": "generate_basic_pdf", "arguments": {
    "title": "Q4 Report", "pdfA": "pdfa2b",
    "blocks": [
        { "type": "heading", "text": "Q4 Highlights", "level": 1 },
        { "type": "paragraph", "text": "Revenue grew 14%." }
    ]
}}
// 2) Verify
{ "name": "inspect_pdf", "arguments": { "pdfBase64": "<step-1 base64>", "check": ["pdfa"] } }
```

### PDF/A-3b Factur-X invoice

```jsonc
// 1) Generate with embedded XML
{ "name": "add_attachment", "arguments": {
    "title": "Invoice INV-2025-001",
    "blocks": [
        { "type": "heading", "text": "Invoice INV-2025-001", "level": 1 },
        { "type": "paragraph", "text": "Total due: 1\u00a0234,56 EUR" }
    ],
    "attachments": [{
        "filename": "factur-x.xml",
        "mimeType": "application/xml",
        "dataBase64": "<base64 of the CII/UBL payload>",
        "relationship": "Source",
        "description": "Factur-X structured invoice"
    }]
}}
// 2) Verify
{ "name": "inspect_pdf", "arguments": { "pdfBase64": "<step-1 base64>", "check": ["pdfa", "attachments"] } }
// → expect attachments.length === 1, pdfA === "3B"
```

## Validating with veraPDF

`inspect_pdf` confirms the claim is *present*; only a reference validator confirms it is *true*. The repository ships a corpus runner: `npm run validate:pdfa` builds the server, generates a 26-file corpus into `test-output/pdfa/` — 24 PDF/A-claiming documents (spanning the document tools, every `generate_basic_pdf` block kind, the layout options and the 1b / 2b / 2u / 3b levels, including 3 **negative canaries** expected to fail) plus 2 page-tree outputs (`merge-pdfa2b.pdf`, `extract-pages-pdfa2b.pdf`) that carry no claim — and runs each through [veraPDF](https://verapdf.org) against its claimed profile. Every file gets one of six outcomes: `PASS` / `FAIL` (claim met / not met), `XFAIL` / `XPASS` (a canary failed as expected / unexpectedly passed — time to drop the canary), `INFRA` (veraPDF or Java missing, crashed, or produced an unparseable report) and `SKIP` (the two page-tree outputs carry no claim and are never sent to veraPDF). Exit code 0 means every expectation was met (or veraPDF is absent and the run degrades to an advisory skip with install hints); 1 means a `FAIL` or `XPASS`; 3 means `INFRA`. Set `VERAPDF_REQUIRED=1` to fail closed — an absent validator is then `INFRA`, exit 3, instead of a skip. The same flow runs in CI (`.github/workflows/verapdf.yml`, veraPDF installer SHA-256 pinned, `VERAPDF_REQUIRED=1`; the step is still advisory / non-blocking in 1.6.0 and becomes blocking in 1.7.0). The `pdfa_valid` MCP prompt walks an agent through the same generate-then-validate loop. Note that `merge_pdfs` / `extract_pages` rebuild the page tree without the source XMP, so their outputs no longer claim PDF/A — generate the final document in one step when you need the claim. Setup and details: [CONTRIBUTING.md](../../CONTRIBUTING.md#pdfa-validation-verapdf).

### Reproducible PDF/A bytes

All nine document tools accept an opt-in `creationDate` (ISO-8601). When pinned, `/Info /CreationDate`, the XMP `xmp:CreateDate` / `xmp:ModifyDate` and therefore the trailer `/ID` are derived from the inputs only, so two calls with identical arguments return identical bytes **on the same host time zone** (the engine serialises local time — set `TZ=UTC` when portability across hosts matters). Omitted, every call differs by the wall clock.

## Known limitations (engine gaps, documented honestly)

- **`add_form` (or a `formField` block) + `pdfA` + `embedFonts: true` still fails PDF/A-2b under veraPDF** — reported as the `PDFA_UNEMBEDDED_FORM_FONT` diagnostic. The interactive form's default resources (`/AcroForm /DR /Helv`) reference the base-14 Helvetica as an unembedded Type1 font, which violates ISO 19005-2 rule 6.2.11.4.1 even though the page content itself uses the embedded Noto Sans. This is an engine-side gap in pdfnative, tracked as the `form-pdfa2b.pdf` negative canary in the corpus; it is a candidate for an upstream report via `draft_governance_issue`. Until it is fixed, do not combine `add_form` with a PDF/A claim you need to be true.
- **An unsigned placeholder from `prepare_signature_placeholder` + `pdfA` is not conformant until it is signed.** The reserved signature field has an empty `/Contents`, which ISO 19005-2 6.4.3 rejects (`placeholder-pdfa2b-unsigned.pdf` negative canary). Once signed with `sign_pdf profile: 'pades'` the document passes. Remember that `inspect_pdf checks.pdfa` reports the *claim*, not its validity — only veraPDF does that.
- **Latin text without `embedFonts: true` is never conformant** (`basic-pdfa2b-no-embedfonts.pdf` negative canary) — see hard rule 1.

## References

- ISO 19005-1, -2, -3 (PDF/A parts 1/2/3)
- ISO 14289-1 (PDF/UA-1) — structural prerequisites checked by `validate_pdf`
- veraPDF — the de-facto open PDF/A validator (use it in CI for ground-truth conformance)
- Factur-X / ZUGFeRD specification (FNFE-MPE)
