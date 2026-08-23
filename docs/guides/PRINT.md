# Print-production guide (for AI agents)

pdfnative-mcp v1.6.0 (on pdfnative 1.7.0) lets every document-producing tool emit a
**print-ready** PDF: page boxes and bleed, printer's marks, `/UserUnit` for large
formats, the `/Trapped` flag, a custom ICC output intent, and print-dialog defaults.
All of it is **opt-in** — omit the options and the bytes are identical to v1.5.0.

## Which tools

`generate_basic_pdf`, `add_barcode`, `add_international_text`, `add_table`,
`add_form`, `embed_image`, `prepare_signature_placeholder`, `add_attachment`,
`add_chart` all accept `print`, `metadata` and `outputIntent`. Existing PDFs are not
re-boxed by this server; use the options at generation time, then `merge_pdfs` /
`split_pdf` / `extract_pages`, which **preserve the boxes and `/UserUnit`** per page.

## TL;DR — a 3 mm bleed with crop and registration marks

```jsonc
{ "tool": "generate_basic_pdf", "arguments": {
  "title": "Product Leaflet",
  "print": { "bleed": 8.5, "marks": true },                  // 3 mm = 8.5 pt
  "metadata": { "author": "Marketing", "trapped": "True" },
  "viewerPreferences": { "duplex": "duplexFlipLongEdge" },
  "blocks": [{ "type": "heading", "text": "Product Leaflet", "level": 1 }]
}}
```

Worked, placeholder-free example: [`examples/print-bleed-marks.json`](../../examples/print-bleed-marks.json).

## `print` — page boxes (ISO 32000-1 §14.11)

| Field | Meaning |
| --- | --- |
| `bleed` | Points (0 < n ≤ 200). Shorthand: **TrimBox = MediaBox inset by `bleed`**, **BleedBox = MediaBox**. Mutually exclusive with `trimBox`. |
| `trimBox` | `[x0, y0, x1, y1]` in points, origin bottom-left — the finished page size. |
| `bleedBox` | Area to which content should extend before trimming. |
| `artBox` | Meaningful content extent (placement in other documents). |
| `cropBox` | Default visible region in viewers. |
| `marks` | `true` for defaults, or `{ crop?, registration?, length?, offset?, weight? }` — corner crop (trim) marks and edge-midpoint registration targets drawn **outside the TrimBox** (defaults: both on, length 14 pt, offset 5 pt, weight 0.25 pt). **Requires a TrimBox** (via `bleed` or `trimBox`). |
| `userUnit` | 1–75000: size of one user-space unit in multiples of 1/72 inch (`/UserUnit`, PDF 1.6+). Use for pages larger than 14400 pt. Raises the header to PDF 1.7. |

Every box must lie within the MediaBox — which is A4 unless you pick another
`pageSize` (`Letter`, `Legal`, `A3`, `Tabloid`; v1.6.0); the engine rejects
inconsistent boxes, marks without a TrimBox and similar mistakes with **`PRINT_ERROR`**
(the message says what to fix). Because the `bleed` shorthand insets the MediaBox, the
page you design is the **MediaBox** — place content that must survive trimming at least
`bleed` points away from the edge, and extend backgrounds that should bleed all the way
to the edge. `margins` and running `headerTemplate` / `footerTemplate` (v1.6.0) affect
where content flows, not the boxes; a header reserves 15 pt at the top of the content
area.

## `metadata` — `/Info` and XMP

`{ author?, subject?, keywords?, trapped? }` writes `/Author`, `/Subject`,
`/Keywords` and **`/Trapped`** (`'True' | 'False' | 'Unknown'`, mirrored to
`pdf:Trapped` in XMP under PDF/A). `trapped` tells a prepress workflow whether the
document has already been trapped for high-end colour printing. (To change the
metadata of an **existing** PDF, use `update_metadata` instead — it is an incremental
update and does not write `/Trapped`.)

Next to `metadata`, the same nine tools accept an opt-in `creationDate` (ISO-8601,
e.g. `'2026-01-15T09:00:00Z'`). Pinning it fixes `/CreationDate`, the XMP dates
under PDF/A and therefore the trailer `/ID`, so a proof re-generated with identical
inputs is **byte-identical on the same host time zone** (the engine serialises the
instant in local time; set `TZ=UTC` for portability across hosts). Omitted, the wall
clock is used and every call differs. Two MCP prompts cover this ground: `print_ready`
(boxes, bleed, marks, `/UserUnit`, metadata, output intent) and `reproducible_output`
(which inputs to pin, what stays non-deterministic).

## `outputIntent` — custom ICC profile

```jsonc
"outputIntent": {
  "iccProfileBase64": "<RGB ICC profile, base64, ≤ 8 MiB>",
  "outputConditionIdentifier": "sRGB IEC61966-2.1",
  "registryName": "http://www.color.org",          // default
  "outputCondition": "…", "info": "…"             // optional
}
```

Replaces the built-in sRGB OutputIntent of a PDF/A (tagged) document. Only **RGB**
profiles are accepted — a CMYK profile is rejected with `PRINT_ERROR`, because the
engine draws in RGB.

## `viewerPreferences` — print-dialog defaults

In addition to the viewer hints (`pageMode`, `hideToolbar`, …), v1.6.0 adds:

| Field | Meaning |
| --- | --- |
| `duplex` | `'simplex'` \| `'duplexFlipShortEdge'` \| `'duplexFlipLongEdge'` (`/Duplex`). |
| `pickTrayByPDFSize` | Ask the printer to pick the input tray from the page size. |
| `printPageRange` | Inclusive 1-based `[first, last]` pairs, e.g. `[[1, 4], [7, 7]]`. |
| `numCopies` | 1–1000 default copies in the Print dialog. |

## PDF/A interaction

- `print.userUnit` needs PDF 1.6+ and is **not allowed under `pdfa1b`** —
  `PDF_A_COMPLIANCE_VIOLATION` before any work is done. Use `pdfa2b` or later.
- Boxes, marks, `/Trapped` and a custom RGB `outputIntent` are all PDF/A-safe.
- Remember that a *valid* PDF/A claim on Latin text also needs `embedFonts: true`
  (see [PDFA.md](PDFA.md)).

## Reading the boxes back

`inspect_pdf` with `pages: true` reports, per page, `width`, `height` and — only when
set on the page — `trimBox`, `bleedBox`, `artBox`, `cropBox` and `userUnit`.
`trapped` appears at document level when the file carries the flag, and
`check: ['trapped']` asserts it in CI.

```jsonc
{ "tool": "inspect_pdf", "arguments": { "pdfBase64": "<pdf>", "pages": true, "check": ["trapped"] } }
// perPage[0] → { index: 0, width: 595, height: 842, trimBox: [8.5, 8.5, 586.5, 833.5], bleedBox: [0, 0, 595, 842] }
```

## Error codes

| Code | Meaning |
| --- | --- |
| `PRINT_ERROR` | The engine rejected `print` / `outputIntent`: box outside the MediaBox, `marks` without a TrimBox, non-RGB ICC profile, … |
| `PDF_A_COMPLIANCE_VIOLATION` | `print.userUnit` combined with `pdfA: 'pdfa1b'`. |
| `VALIDATION_ERROR` | `bleed` and `trimBox` both given, a box with fewer than 4 numbers, an ICC payload that is not base64 / empty / over 8 MiB. |

## Units cheat-sheet

1 pt = 1/72 in = 0.3528 mm. 3 mm bleed = 8.5 pt · 5 mm = 14.2 pt · A4 = 595.28 × 841.89 pt (the default `pageSize`); the other presets are Letter 612 × 792, Legal 612 × 1008, A3 841.89 × 1190.55, Tabloid 792 × 1224 (all portrait). Every `print.*` box must fit the chosen page; `margins` (0–200 pt each) and `headerTemplate` / `footerTemplate` only move the content, never the boxes.
