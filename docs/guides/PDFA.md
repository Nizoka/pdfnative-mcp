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

1. Every font is **fully embedded** (subset or full) — already done by pdfnative.
2. An **OutputIntent** with sRGB ICC is added — done by pdfnative.
3. The document **must not be encrypted** — pdfnative-mcp refuses to combine `pdfA` with encryption.
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

## References

- ISO 19005-1, -2, -3 (PDF/A parts 1/2/3)
- ISO 14289-1 (PDF/UA-1) — structural prerequisites checked by `validate_pdf`
- veraPDF — the de-facto open PDF/A validator (use it in CI for ground-truth conformance)
- Factur-X / ZUGFeRD specification (FNFE-MPE)
