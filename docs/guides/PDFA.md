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

1. Fonts must be **embedded** — but this is *not* automatic for Latin text. The eight Latin document tools — `generate_basic_pdf`, `add_table`, `add_form`, `embed_image`, `add_barcode`, `add_attachment`, `add_chart` and `prepare_signature_placeholder` — render Latin text through the base-14 Helvetica, which is **not embedded** and voids the PDF/A claim (ISO 19005 §6.2.11.4.1). Pass `embedFonts: true` (new in 1.6.0) to embed Noto Sans instead, or use `add_international_text`, which has no `embedFonts` input because it always embeds the Noto fonts it renders with. Set `strict: true` to turn the silent diagnostic into a `PDF_A_COMPLIANCE_VIOLATION` error. Four more `PDFA_*` diagnostics follow the same path: `PDFA_UNEMBEDDED_FORM_FONT` — a form field (`add_form`, `formField` block) under a PDF/A claim **without** `embedFonts: true` keeps an unembedded `/DR /Helv` widget font (with `embedFonts: true` the field font is embedded too since pdfnative 1.8.0, and the form validates); `PDFA_DEVICE_CMYK_IMAGE` — a CMYK JPEG (`embed_image`, `image` block) against the sRGB OutputIntent (keep images RGB, or supply a CMYK `outputIntent`); `PDFA_DEVICE_CMYK_CONTENT` (1.7.0) — a CMYK colour (`'C M Y K'`, `[c, m, y, k]`) or the print colour bars against an OutputIntent that is not CMYK; and `PDFA_ICC_PROFILE_VERSION` (1.7.0) — a custom `outputIntent` whose ICC profile is newer than the level allows (`pdfa1b` takes ICC v2 only; a v4 profile is reported). Read them with `includeDiagnostics: true`. Since 1.7.0 `strict` escalates **by diagnostic code**: a `PDFA_*` diagnostic → `PDF_A_COMPLIANCE_VIOLATION`, a `PDFX_*` one → `PDF_X_COMPLIANCE_VIOLATION`, any other (e.g. `TYPOGRAPHY_FEATURE_INEFFECTIVE`) → `DIAGNOSTIC_ESCALATED` — so a `strict` PDF/A call can also fail on an ineffective typography request.
2. An **OutputIntent** with sRGB ICC is added — done by pdfnative. A custom `outputIntent` may replace it with an RGB, CMYK or Gray profile (a real ICC file; none is bundled — see [PRINT.md](PRINT.md#outputintent--custom-icc-profile)).
3. The document **must not be encrypted** — on the document tools `encrypt` + `pdfA` is rejected with `VALIDATION_ERROR` (ISO 19005-1 §6.3.2), and `encrypt_pdf` (or the page-tree `encrypt` option) rebuilds the document without the XMP packet, so any PDF/A claim is dropped rather than combined with encryption. Layout options are PDF/A-neutral: `compress` leaves the XMP packet uncompressed (bytes change, the claim holds), `pageSize` / `margins` / templates only move content, `debug` draws plain stroked rectangles (no transparency) — but as unmarked content, so not for PDF/UA. A text or image watermark below opacity 1.0 is rejected under `pdfa1b` only. **`pdfA` and `pdfx` are mutually exclusive** too (`VALIDATION_ERROR`): one conformance claim per file — PDF/A is for archiving, PDF/X for print exchange.
4. **No JavaScript, no actions, no movies, no XFA** — none of pdfnative-mcp's tools emit these.
5. **XMP `pdfaid:part` / `pdfaid:conformance` keys** are written — verified by `inspect_pdf` via the `pdfA` field.

## Common mistakes

- **Emitting literal newlines in a paragraph.** Write multi-line text naturally — the server auto-splits embedded `\n` into separate paragraph blocks. A literal `\n` is not a glyph; pre-1.1 this produced `.notdef` tofu in PDF/A.
- **Substituting `EUR` for `€`.** No longer needed — since pdfnative 1.3 the Euro sign and other CP-1252 symbols render and extract correctly. Use the real `€` character.
- **Worrying about wrapped table cells.** Wrapped cells now receive a unique MCID per line (pdfnative 1.3), so tagged/PDF-A tables are PDF/UA-safe automatically.
- **Mixing attachments with PDF/A-1 or PDF/A-2.** Attachments are only legal in PDF/A-3. The `add_attachment` tool enforces this by always emitting `pdfa3b`. If you call `generate_basic_pdf` with `pdfA: 'pdfa2b'` *and* try to attach a file in a follow-up step, the chain will fail validation.
- **Using `generate_basic_pdf` for Factur-X and then re-running pdfnative on the bytes.** Round-tripping a PDF/A-3b document through a non-PDF/A-aware builder strips the XMP — call `add_attachment` directly with the desired body blocks instead.
- **Claiming `pdfa2u` for Tai Tham text.** `add_international_text` with `lang: 'nod'` must use **`pdfa2b`**, not `pdfa2u`: one Tai Tham glyph has no `ToUnicode` entry (an upstream engine limit), so level U fails veraPDF rule 6.2.11.7.2 — and no diagnostic warns you. Level B does not require a Unicode mapping per glyph and validates. The other scripts added in 1.7.0 (`lo`, `khb`, `tdd`, `cjm`) validate under `pdfa2u`.
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
    "embedFonts": true, "strict": true,          // hard rule 1: without embedFonts the claim is void
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
    "embedFonts": true,
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

`inspect_pdf` confirms the claim is *present*; only a reference validator confirms it is *true*. The repository ships a conformance corpus and two runners:

```bash
npm run build && npm run corpus:pdfa   # the built server → test-output/pdfa/*.pdf + manifest.json
npm run validate:pdfa                  # veraPDF over every PDF/A-claiming file
npm run validate:pdfx                  # the engine's structural PDF/X-4 check, in-process
```

`npm run corpus:pdfa` writes a 41-file corpus into `test-output/pdfa/`: 33 PDF/A-claiming documents (spanning the document tools, every `generate_basic_pdf` block kind, the layout options, the 1b / 2b / 2u / 3b levels and — new in 1.7.0 — CMYK and Gray output intents, typography, the new scripts and an archival form, including 6 **negative canaries** expected to fail), 6 PDF/X-4 files (2 of them canaries), and 2 page-tree outputs (`merge-pdfa2b.pdf`, `extract-pages-pdfa2b.pdf`) that carry no claim. `npm run validate:pdfa` runs each PDF/A file through [veraPDF](https://verapdf.org) against its claimed profile; `npm run validate:pdfx` checks the PDF/X-4 files with pdfnative's structural validator (structural prerequisites only — not a certified preflight; veraPDF does not cover PDF/X) and never skips. Every file gets one of six outcomes: `PASS` / `FAIL` (claim met / not met), `XFAIL` / `XPASS` (a canary failed as expected / unexpectedly passed — time to flip the expectation on purpose), `INFRA` (veraPDF produced no usable report) and `SKIP` (no PDF/A claim — never sent to veraPDF). With veraPDF 1.30.2 the result is **27 PASS, 6 XFAIL**, 0 unexpected. Exit codes are the same for both validators: **0** every expectation met, **1** a conformance mismatch (`FAIL` or `XPASS`), **2** infrastructure (no corpus, veraPDF unusable). When veraPDF is simply not installed, `validate:pdfa` run by hand prints install hints and exits 0 — explicitly a skip, not a pass; the gate reports the step as skipped, and `npx tsx scripts/gate.ts --publish --require-all` turns that skip into a failure (it replaces the former `VERAPDF_REQUIRED=1`, which no longer exists). veraPDF is **blocking** in CI since 1.7.0: `.github/workflows/verapdf.yml` installs the pinned 1.30.2 release (SHA-256 verified before it is executed) and fails the build on any unmet expectation. The `pdfa_valid` MCP prompt walks an agent through the same generate-then-validate loop. Note that `merge_pdfs` / `extract_pages` rebuild the page tree without the source XMP, so their outputs no longer claim PDF/A — generate the final document in one step when you need the claim. Setup and details: [CONTRIBUTING.md](../../CONTRIBUTING.md#pdfa-validation-verapdf).

### Reproducible PDF/A bytes

All nine document tools accept an opt-in `creationDate` (ISO-8601). When pinned, `/Info /CreationDate`, the XMP `xmp:CreateDate` / `xmp:ModifyDate` and therefore the trailer `/ID` are derived from the inputs only, so two calls with identical arguments return identical bytes **on every host and in every time zone** — since pdfnative 1.8.0 every date, the XMP ones included, is written in UTC. An operator can pin the instant for the whole server instead (`PDFNATIVE_MCP_CREATION_DATE`, else `SOURCE_DATE_EPOCH`); a call's own `creationDate` still wins. Omitted everywhere, every call differs by the wall clock. See [REPRODUCIBLE.md](REPRODUCIBLE.md).

## Known limitations (engine gaps, documented honestly)

- **Fixed in 1.7.0 — forms can be archival.** `add_form` (or a `formField` block) + `pdfA` + `embedFonts: true` now **validates** under veraPDF: pdfnative 1.8.0 (upstream issue #74) embeds the AcroForm default-resources font, so `/AcroForm /DR` no longer references an unembedded base-14 Helvetica. The corpus entry `form-pdfa2b.pdf`, a negative canary until 1.6.0, is now an expected pass. `embedFonts: true` is what makes it true: **without it** the form still fails rule 6.2.11.4.1 (diagnostics `PDFA_NO_FONT_ENTRIES` + `PDFA_UNEMBEDDED_FORM_FONT`; negative canary `form-pdfa2b-no-embedfonts.pdf`).
- **Tai Tham (`lang: 'nod'`) does not validate under `pdfa2u`** — one glyph produced by the shaper has no `ToUnicode` entry (veraPDF rule 6.2.11.7.2; upstream engine limit, tracked by the `international-pdfa2u-taitham.pdf` negative canary), and the engine raises no diagnostic for it. Use `pdfa2b`, which `international-pdfa2b-taitham.pdf` proves conformant.
- **CMYK content against the default sRGB OutputIntent** (`cmyk-content-srgb-pdfa2b.pdf`, diagnostic `PDFA_DEVICE_CMYK_CONTENT`) **and an ICC v4 profile under `pdfa1b`** (`iccv4-pdfa1b.pdf`, diagnostic `PDFA_ICC_PROFILE_VERSION`) are never conformant — two more negative canaries. Keep colours RGB or supply a CMYK `outputIntent`; give `pdfa1b` an ICC v2 profile.
- **An unsigned placeholder from `prepare_signature_placeholder` + `pdfA` is not conformant until it is signed.** The reserved signature field has an empty `/Contents`, which ISO 19005-2 6.4.3 rejects (`placeholder-pdfa2b-unsigned.pdf` negative canary). Once signed with `sign_pdf profile: 'pades'` the document passes. Remember that `inspect_pdf checks.pdfa` reports the *claim*, not its validity — only veraPDF does that.
- **Latin text without `embedFonts: true` is never conformant** (`basic-pdfa2b-no-embedfonts.pdf` negative canary) — see hard rule 1.

## References

- ISO 19005-1, -2, -3 (PDF/A parts 1/2/3)
- ISO 14289-1 (PDF/UA-1) — structural prerequisites checked by `validate_pdf`
- veraPDF — the de-facto open PDF/A validator (use it in CI for ground-truth conformance)
- Factur-X / ZUGFeRD specification (FNFE-MPE)
