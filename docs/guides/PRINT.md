# Print-production guide (for AI agents)

pdfnative-mcp v1.7.0 (on pdfnative 1.8.0) lets every document-producing tool emit a
**print-ready** PDF: page boxes and bleed, printer's marks and a colour control strip,
`/UserUnit` for large formats, the `/Trapped` flag, an RGB, CMYK or Gray ICC output
intent, CMYK colours, a **PDF/X-4** claim, and print-dialog defaults.
All of it is **opt-in** — omit the options and the bytes do not change.

## Which tools

`generate_basic_pdf`, `add_barcode`, `add_international_text`, `add_table`,
`add_form`, `embed_image`, `prepare_signature_placeholder`, `add_attachment`,
`add_chart` all accept `print`, `metadata` and `outputIntent`. Six of them also accept
`pdfx` (see [PDF/X-4](#pdfx-4)). Existing PDFs are not
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
| `marks` | `true` for defaults, or `{ crop?, registration?, length?, offset?, weight?, colourBars? }` — corner crop (trim) marks and edge-midpoint registration targets drawn **outside the TrimBox** (defaults: both on, length 14 pt, offset 5 pt, weight 0.25 pt; `colourBars` off). **Requires a TrimBox** (via `bleed` or `trimBox`). |
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

Since pdfnative 1.8.0 every mark **stops 0.5 pt short of the trim line** (or the stroke
weight, if heavier) and of the media edge, so no ink prints on the cut. The bytes of
every document drawing `print.marks` therefore differ from those of v1.6.0 — rebaseline
once if you compare bytes. Under a CMYK output intent the marks are stroked in the
registration colour (the `All` separation, which prints on every plate) instead of black.

### `print.marks.colourBars` — the colour control strip

```json
{ "tool": "generate_basic_pdf", "arguments": {
  "title": "Press sheet",
  "print": { "bleed": 14.17, "marks": { "colourBars": { "tints": true, "size": 12 } } },
  "metadata": { "trapped": "False" },
  "blocks": [{ "type": "heading", "text": "Press sheet", "level": 1 }]
}}
```

`colourBars` is `true` for the defaults, or `{ tints?, size? }`: `tints` (default
`true`) adds tint patches after the four C M Y K solids, `size` is the patch side in
points (**4–72**, default 12). It is off by default, so existing `marks` output is
unchanged. The strip is drawn in the bottom bleed and needs room: use a bleed of about
**5 mm (14.17 pt)** — a 3 mm bleed clamps the patches below the aperture of a
densitometer, and the strip is **skipped silently** when it would not fit. The patches
are DeviceCMYK, so pair them with a CMYK `outputIntent`; under another intent the usual
`PDFA_DEVICE_CMYK_CONTENT` / `PDFX_DEVICE_CMYK` diagnostic applies. Example:
[`examples/print-colour-bars.json`](../../examples/print-colour-bars.json).

## `metadata` — `/Info` and XMP

`{ author?, subject?, keywords?, trapped? }` writes `/Author`, `/Subject`,
`/Keywords` and **`/Trapped`** (`'True' | 'False' | 'Unknown'`, mirrored to
`pdf:Trapped` in XMP under PDF/A). `trapped` tells a prepress workflow whether the
document has already been trapped for high-end colour printing. (To change the
metadata of an **existing** PDF, use `update_metadata` instead — it is an incremental
update and does not write `/Trapped`.)

Next to `metadata`, the same nine tools accept an opt-in `creationDate` (ISO-8601,
e.g. `'2026-01-15T09:00:00Z'`). Pinning it fixes `/CreationDate`, the XMP dates
under PDF/A, the `{date}` placeholder of a header / footer template and therefore the
trailer `/ID`, so a proof re-generated with identical inputs is **byte-identical on
every host and in every time zone** (since pdfnative 1.8.0 every date is written in
UTC). Omitted, the operator's pin (`PDFNATIVE_MCP_CREATION_DATE`, else
`SOURCE_DATE_EPOCH`) applies, else the wall clock — and then every call differs. See
[REPRODUCIBLE.md](REPRODUCIBLE.md). Two MCP prompts cover this ground: `print_ready`
(boxes, bleed, marks, colour bars, `/UserUnit`, metadata, output intent, CMYK, PDF/X-4)
and `reproducible_output` (which inputs to pin, what stays non-deterministic).

## `outputIntent` — custom ICC profile

```jsonc
"outputIntent": {
  "iccProfileBase64": "<RGB, CMYK or Gray ICC profile, base64, ≤ 8 MiB>",
  "outputConditionIdentifier": "sRGB IEC61966-2.1",
  "registryName": "http://www.color.org",          // default
  "outputCondition": "…", "info": "…"             // optional
}
```

Replaces the built-in sRGB OutputIntent of a PDF/A (tagged) document, and is the
**required** printing condition of a PDF/X-4 file. **RGB, CMYK and Gray** profiles are
accepted (v1.6.0 accepted RGB only). What an agent cannot guess:

- **No ICC profile is bundled** beyond the engine's built-in sRGB — neither the engine
  nor this server ships a press profile. Ask the printer for theirs (ISO Coated v2,
  GRACoL, …) and pass it base64-encoded exactly once.
- The payload must be a **real ICC file**: the `acsp` signature at byte 36 and a size
  field no larger than the bytes supplied. A hand-made stub, a truncated profile or a
  data colour space other than RGB / CMYK / Gray is `PRINT_ERROR`. (v1.6.0 let a stub
  through.)
- Under **`pdfx`** the profile's device class must be **`prtr`** (an output / printer
  profile); a monitor-class profile (`mntr`, e.g. sRGB) is refused with
  `VALIDATION_ERROR`.
- Under **`pdfA: 'pdfa1b'`** the profile must be ICC v2; a v4 profile raises the
  `PDFA_ICC_PROFILE_VERSION` diagnostic (see [PDFA.md](PDFA.md)).
- Under a CMYK or Gray intent, RGB content (hex colours, RGB images) is mapped through
  a calibrated default colour space, so it stays legal; CMYK content is written directly.

## CMYK colours

Every colour input keeps the form it has always accepted and gains two CMYK forms:

| Form | Example | Components |
| --- | --- | --- |
| CMYK operand string `'C M Y K'` | `"1 0.6 0 0.1"` | four numbers, each 0.0–1.0, single spaces |
| CMYK percent tuple `[c, m, y, k]` | `[100, 60, 0, 10]` | four ink percentages, each 0–100 |

Where: `watermark.color`, `headerTemplate.color` / `footerTemplate.color`, table
`cellBorders.color`, outline entry `color`, chart `series[].color` and `colors[]`, the
`link` block `color`, the `svg` block `fill` / `stroke`, and the `color` /
`interiorColor` of `annotate_pdf`. (Table borders and outline entries take a free
string, which already admits `'C M Y K'`.) The content stream then paints with the
DeviceCMYK operators — except an outline label, which is RGB by definition (`/C`): a
CMYK value there is converted for on-screen display.

```json
{ "tool": "generate_basic_pdf", "arguments": {
  "title": "Process colours",
  "watermark": { "text": "PROOF", "opacity": 0.15, "color": [0, 100, 100, 0] },
  "headerTemplate": { "left": "{title}", "color": "0 0 0 0.8" },
  "blocks": [
    { "type": "link", "text": "Colour reference", "url": "https://github.com/Nizoka/pdfnative-mcp", "color": [100, 60, 0, 10] },
    { "type": "table", "headers": ["Ink", "Coverage"], "rows": [["Cyan", "100 %"]], "cellBorders": { "all": true, "color": [0, 0, 0, 40] } },
    { "type": "chart", "chartType": "bar", "categories": ["Front", "Back"], "series": [{ "label": "Cyan", "values": [62, 48], "color": "1 0 0 0" }] }
  ]
}}
```

CMYK colours are only meaningful against a CMYK printing condition: pair them with a
CMYK `outputIntent`. Under a PDF/A claim with the default sRGB intent the engine reports
`PDFA_DEVICE_CMYK_CONTENT`; under PDF/X with an RGB or Gray intent, `PDFX_DEVICE_CMYK`.
A three-number tuple is never CMYK: `[1, 0, 0]` on a watermark or an annotation is the
documented 0–1 RGB triple (and, since v1.7.0, renders the red it names). Example:
[`examples/cmyk-colours.json`](../../examples/cmyk-colours.json).

## PDF/X-4

`pdfx: 'pdfx4'` claims PDF/X-4 (ISO 15930-7), the print-exchange standard. It is
accepted by **six** tools: `generate_basic_pdf`, `add_table`, `add_chart`,
`add_barcode`, `embed_image` and `add_international_text`.

```jsonc
{ "tool": "generate_basic_pdf", "arguments": {
  "title": "Spring catalogue",
  "pdfx": "pdfx4",
  "embedFonts": true,                                     // every font embedded
  "strict": true,                                         // fail on any PDFX_* diagnostic
  "outputIntent": {
    "iccProfileBase64": "<the printer's CMYK ICC profile (class prtr), base64>",
    "outputConditionIdentifier": "FOGRA39"
  },
  "metadata": { "trapped": "False" },
  "print": { "bleed": 14.17, "marks": { "colourBars": true } },
  "blocks": [{ "type": "heading", "text": "Spring catalogue", "level": 1 }]
}}
```

**What it writes:** a `%PDF-1.6` header, the PDF/X-4 XMP identification, a `/GTS_PDFX`
OutputIntent carrying your ICC profile, a TrimBox on every page (the MediaBox when
`print` sets none) and `/Trapped`.

**Prerequisites:**

- `outputIntent` with the printing condition's ICC profile, device class `prtr`, CMYK
  or Gray for a press job. None is bundled.
- `embedFonts: true` — without it the engine raises `PDFX_NO_FONT_ENTRIES` and the file
  does not conform. (`add_international_text` always embeds.)
- A known trapping state: `metadata.trapped` `'True'` or `'False'`; omitted, it is
  written as `'False'`.
- No annotations on the printed area: a `link` or `formField` block is reported as
  `PDFX_ANNOTATIONS`.
- Colour that matches the intent: CMYK colours — and the colour bars, which are CMYK —
  under a **Gray** or RGB intent are reported as `PDFX_DEVICE_CMYK`. A one-colour job
  uses a Gray profile and no CMYK input.

**Five combinations are refused with `VALIDATION_ERROR` before any work is done:**

1. `pdfx` with `pdfA` — one conformance claim per file (PDF/A is for archiving, PDF/X
   for print exchange).
2. `pdfx` with `encrypt` — PDF/X forbids encryption.
3. `pdfx` without `outputIntent`.
4. `pdfx` with `metadata.trapped: 'Unknown'`.
5. `pdfx` with `print.artBox` **and** a TrimBox (`print.trimBox` or `print.bleed`) — a
   PDF/X page carries a TrimBox or an ArtBox, not both.

A sixth can only be seen by the engine — an ICC profile whose class is not `prtr` — and
is `VALIDATION_ERROR` too. The `PDFX_*` diagnostics (`PDFX_NO_FONT_ENTRIES`,
`PDFX_DEVICE_CMYK`, `PDFX_ANNOTATIONS`) are warnings by default, readable with
`includeDiagnostics: true`; under `strict: true` any of them fails the call with
**`PDF_X_COMPLIANCE_VIOLATION`**.

### Checking the result — structural, not a certified preflight

```jsonc
{ "tool": "validate_pdf", "arguments": { "pdfBase64": "<pdf>", "standard": "pdf-x-4" } }
// → { standard: 'pdf-x-4', valid: true, errors: [], warnings: [], summary: '…', caveats: [ … ] }
```

`standard: 'pdf-x-4'` checks the **structural prerequisites** of ISO 15930-7: the
OutputIntent and its `prtr` profile, the TrimBox, embedded fonts, no annotations,
JavaScript or embedded files. Every PDF/X result — valid or not — carries `caveats[]`,
which says what the verdict does **not** establish: it is **not a certified
preflight**; colour inside Form XObjects and images, transparency blend spaces, optional
content and anything that needs rendering (overprint, ink coverage, resolution) are not
checked. veraPDF does not cover PDF/X and no open reference validator exists — confirm a
press job with callas pdfToolbox or Acrobat Preflight. The default
(`standard: 'pdf-ua-1'`) response is unchanged and has no `caveats`.

`inspect_pdf` reports the **claim**: a `pdfX` string (e.g. `'PDF/X-4'`) when the XMP
makes one, absent otherwise, and `check: ['pdfx']` asserts it in CI. A claim is not a
verdict — `validate_pdf` checks it.

Examples: [`examples/pdfx4-cmyk-validate.json`](../../examples/pdfx4-cmyk-validate.json)
(CMYK job, generate → validate → inspect) and
[`examples/pdfx4-gray.json`](../../examples/pdfx4-gray.json) (a one-colour job, runnable
as is with a synthetic Gray profile that characterises no press).

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
- Boxes, marks, `/Trapped` and a custom RGB, CMYK or Gray `outputIntent` are all
  PDF/A-safe. Colour must match the intent: CMYK colours or colour bars against the
  default sRGB intent raise `PDFA_DEVICE_CMYK_CONTENT`; under `pdfa1b` the profile must
  be ICC v2 (`PDFA_ICC_PROFILE_VERSION` otherwise).
- `pdfA` and `pdfx` are **mutually exclusive** (`VALIDATION_ERROR`): one conformance
  claim per file.
- Remember that a *valid* PDF/A claim on Latin text also needs `embedFonts: true`
  (see [PDFA.md](PDFA.md)).

## Reading the boxes back

`inspect_pdf` with `pages: true` reports, per page, `width`, `height` and — only when
set on the page — `trimBox`, `bleedBox`, `artBox`, `cropBox` and `userUnit`.
`trapped` appears at document level when the file carries the flag, and
`check: ['trapped']` asserts it in CI; `pdfX` and `check: ['pdfx']` do the same for a
PDF/X claim.

```jsonc
{ "tool": "inspect_pdf", "arguments": { "pdfBase64": "<pdf>", "pages": true, "check": ["trapped"] } }
// perPage[0] → { index: 0, width: 595.28, height: 841.89, trimBox: [8.5, 8.5, 586.78, 833.39], bleedBox: [0, 0, 595.28, 841.89] }
```

## Error codes

| Code | Meaning |
| --- | --- |
| `PRINT_ERROR` | The engine rejected `print` / `outputIntent`: box outside the MediaBox, `marks` without a TrimBox, an ICC payload that is not an ICC profile (no `acsp` signature, declared size larger than the bytes, a colour space other than RGB / CMYK / Gray), … |
| `PDF_A_COMPLIANCE_VIOLATION` | `print.userUnit` combined with `pdfA: 'pdfa1b'`; under `strict: true`, any `PDFA_*` diagnostic. |
| `PDF_X_COMPLIANCE_VIOLATION` | Under `strict: true` only: a `PDFX_*` diagnostic (`PDFX_NO_FONT_ENTRIES`, `PDFX_DEVICE_CMYK`, `PDFX_ANNOTATIONS`). |
| `VALIDATION_ERROR` | `bleed` and `trimBox` both given, a box with fewer than 4 numbers, an ICC payload that is not base64 / empty / over 8 MiB, `colourBars.size` outside 4–72, a malformed CMYK colour, and the PDF/X refusals listed under [PDF/X-4](#pdfx-4). |

## Units cheat-sheet

1 pt = 1/72 in = 0.3528 mm. 3 mm bleed = 8.5 pt · 5 mm = 14.2 pt · A4 = 595.28 × 841.89 pt (the default `pageSize`); the other presets are Letter 612 × 792, Legal 612 × 1008, A3 841.89 × 1190.55, Tabloid 792 × 1224 (all portrait). Every `print.*` box must fit the chosen page; `margins` (0–200 pt each) and `headerTemplate` / `footerTemplate` only move the content, never the boxes.
