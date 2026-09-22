# pdfnative-mcp

> **MCP server for PDF generation, PDF/A archival, PDF/X-4 print exchange, fine typography, PAdES signing with long-term validation, AcroForms, merge/split, encryption and layout preview** — 28 tools and 7 prompts on the [pdfnative](https://github.com/Nizoka/pdfnative) engine (zero-dependency, ISO 32000-1 compliant), for Claude Desktop, Cursor, ChatGPT and any Model Context Protocol client.

[![npm version](https://img.shields.io/npm/v/pdfnative-mcp.svg?logo=npm&color=cb3837)](https://www.npmjs.com/package/pdfnative-mcp)
[![npm downloads](https://img.shields.io/npm/dm/pdfnative-mcp.svg?logo=npm)](https://www.npmjs.com/package/pdfnative-mcp)
[![Node version](https://img.shields.io/node/v/pdfnative-mcp.svg?logo=node.js)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Nizoka/pdfnative-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Nizoka/pdfnative-mcp/actions/workflows/ci.yml)
[![MCP](https://img.shields.io/badge/MCP-2026--07--28-6f42c1.svg)](https://modelcontextprotocol.io)
[![pdfnative](https://img.shields.io/badge/pdfnative-1.8-0a7e8c.svg)](https://github.com/Nizoka/pdfnative)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Nizoka/pdfnative-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/Nizoka/pdfnative-mcp)
[![CodeQL](https://github.com/Nizoka/pdfnative-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/Nizoka/pdfnative-mcp/actions/workflows/codeql.yml)

---

## ✨ Features

`pdfnative-mcp` exposes **28 production-grade tools** to any MCP host:

| Tool                               | Purpose                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `generate_basic_pdf`               | Multi-page documents from **13 block kinds** — `heading`, `paragraph`, `list`, `table`, `image` (JPEG/PNG), `link`, `toc` (printed table of contents), `barcode`, `svg`, `formField`, `chart`, `pageBreak`, `spacer` — every `DocumentBlock` the engine offers. Embedded newlines auto-split into paragraphs. Optional `pdfA`, `pdfx` *(new in v1.7.0)*, `print`, `metadata`, `embedFonts`, `watermark`, `outline`, layout options (`pageSize`, `margins`, `headerTemplate` / `footerTemplate`, `compress`, `debug`, `encrypt`), `typography` *(new in v1.7.0)* and CMYK colours *(new in v1.7.0)*. |
| `inspect_layout` *(new in v1.6.0)* | Read-only **pagination dry run** of the same `blocks` (+ `title`, `footerText`, `pdfA`, `normalize`, `embedFonts`, `pageSize`, `margins`, `headerTemplate`, `footerTemplate`, `typography`): page count and where every block lands, no PDF produced. |
| `add_barcode`                      | QR Code, Code 128, EAN-13, Data Matrix, PDF417 — embedded in a single-page PDF.                 |
| `add_international_text`           | **27 Unicode scripts** — Lao, Tai Tham, New Tai Lue, Tai Le and Cham *(new in v1.7.0)* — plus **Latin**, math and COLRv1 **colour emoji** (flag / ZWJ sequences, skin-tone modifiers), with BiDi & OpenType shaping; multi-lang per document. |
| `add_table`                        | Tabular reports with smart fields (wrap, repeatHeader, zebra, caption, minRowHeight, cellPadding). |
| `add_form`                         | Create a **new** interactive AcroForm PDF with text fields, text areas, checkboxes, radio buttons, dropdowns, list boxes (+ `placeholder` hint text). |
| `read_form_fields`                 | Read-only enumeration of an **existing** AcroForm's field tree (names, types, values, widgets).  |
| `fill_form`                        | Fill and/or flatten an **existing** AcroForm (non-destructive incremental update).              |
| `add_chart`                        | Native vector charts v2 — bar / barH / stackedBar / stackedBarH / line / area / scatter / pie / donut, secondary axis, log & time scales, data labels (pure PDF path operators, PDF/A-safe). |
| `embed_image`                      | Embed a JPEG or PNG image (base64) into a titled PDF document (`align`, `alt` text for tagged output). |
| `prepare_signature_placeholder`    | Optional step 1 of the sign workflow — create a PDF with a `/Sig` placeholder (signer metadata, `subFilter`, `reserveTimestamp` baked in). |
| `sign_pdf`                         | PAdES B-B / B-T CMS signature (RSA-SHA256/384/512, ECDSA-SHA256 P-256; `profile: 'pades'`, `timestamp`, `certChainDerBase64`, multiple signatures, pinnable `signingTime`). Auto-injects a placeholder when needed. |
| `add_ltv` *(new in v1.6.0)*        | PAdES B-LT — embed a `/DSS` with certificates + OCSP/CRL material (operator-configured provider, or caller-supplied offline material). |
| `timestamp_pdf` *(new in v1.6.0)*  | PAdES B-LTA — append an RFC 3161 `/DocTimeStamp` from the operator-configured TSA; re-run to extend the archival chain. |
| `verify_pdf`                       | Verify every PAdES signature and document timestamp (integrity + signature value + optional chain trust; a `/DocTimeStamp` counts in `allValid` like any signature); `ltv: true` reports the B-B…B-LTA level. |
| `validate_pdf`                     | Validate a Tagged PDF for PDF/UA (ISO 14289-1) structural conformance, or with `standard: 'pdf-x-4'` *(new in v1.7.0)* the structural prerequisites of PDF/X-4 (ISO 15930-7) — read-only, not a certified preflight. |
| `add_attachment`                   | Generate a PDF/A-3 document with embedded files (Factur-X / ZUGFeRD invoices).                  |
| `extract_attachments`              | Read-only extraction of embedded files (Factur-X / ZUGFeRD XML round-trip) with byte-for-byte payloads. |
| `extract_text`                     | Unicode text extraction (resolves `/ToUnicode`) with optional positioned runs; opens encrypted PDFs via `password`. |
| `inspect_pdf`                      | Read-only inspection: PDF version, page count, encryption (+ precise `encryptionInfo`), PDF/A claim, PDF/X claim (`pdfX`, *new in v1.7.0*), signatures (+ inventory, `/DSS`, document timestamps), page boxes, `/Trapped`, attachments, placeholder state, `annotations: true` inventory of existing page annotations. |
| `update_metadata` *(new in v1.6.0)* | Rewrite `/Info` title / author / subject / keywords (+ XMP, dates included) of an **existing** PDF as an incremental update; pin `modDate` for reproducible bytes. |
| `encrypt_pdf`                      | Re-secure a PDF with AES-128 / AES-256 (owner/user passwords, permissions, password rotation).  |
| `decrypt_pdf`                      | Emit an unencrypted copy of an RC4 / AES-128 / AES-256 document.                                |
| `merge_pdfs`                       | Concatenate 2–50 PDFs into one via pdfnative's page-tree API (page boxes preserved).            |
| `split_pdf`                        | Split one PDF into one document per page range (multi-output).                                  |
| `extract_pages`                    | Pull an arbitrary page subset into a single PDF.                                               |
| `annotate_pdf`                     | Add markup annotations (highlight, note, square/circle, line, freetext) as a visual overlay — **not** a redaction. |
| `draft_governance_issue`           | Draft a governance-compliant GitHub issue locally for **human** review; never submits, no network. |

**New in v1.7.0:**

- 🔤 **Fine typography** — an opt-in `typography` object on the nine document tools and on `inspect_layout`: `splitParagraphs` with `orphans` / `widows`, `keepHeadingsWithNext`, `unitBinding`, `bindShortWords`, `punctuationSpacing` (`'fr'`, `'fr-CA'` or explicit rules), `opticalMargins`, `metrics: 'exact'`, `fontFeatures` (11 OpenType tags), `kerning`, `hyphenationLanguage`. Paragraph blocks gain `align` (`left` / `right` / `center` / `justify`), `keepWithNext` and `splittable`; heading blocks gain `keepWithNext`. Honest limits: `kerning`, `fontFeatures` and the `'fr'` narrow no-break space need `embedFonts: true` (base-14 Helvetica degrades `'fr'` to `'fr-CA'`); `tnum` / `lnum` change nothing on the bundled Noto Sans (diagnostic `TYPOGRAPHY_FEATURE_INEFFECTIVE`); **no hyphenation dictionary is installed**, so `hyphenationLanguage` has no effect here — soft hyphens (U+00AD) are honoured. See [`docs/guides/TYPOGRAPHY.md`](docs/guides/TYPOGRAPHY.md).
- 🎨 **CMYK everywhere a colour is accepted** — `'c m y k'` operand strings (0–1) and `[c, m, y, k]` percent tuples (0–100) beside the existing hex / RGB forms: watermarks, header / footer templates, table cell borders, outline entries, charts, `link` and `svg` blocks, `annotate_pdf`. Every 1.6.0 colour form still validates.
- 🖨️ **PDF/X-4** — `pdfx: 'pdfx4'` on six generation tools (`generate_basic_pdf`, `add_table`, `add_chart`, `add_barcode`, `embed_image`, `add_international_text`), CMYK or Gray `outputIntent` profiles beside RGB, `print.marks.colourBars`, and `validate_pdf { standard: 'pdf-x-4' }` to check the result; `inspect_pdf` reports the claim (`pdfX`, check `'pdfx'`). It requires the printer's ICC profile (device class `prtr` — **none is bundled**), needs `embedFonts: true` for a conformant file (`PDFX_NO_FONT_ENTRIES` otherwise; `strict: true` refuses), and is exclusive with `pdfA` and `encrypt`. The validation is structural — **not a certified preflight**; the result says so itself in `caveats[]`. See [`docs/guides/PRINT.md`](docs/guides/PRINT.md).
- 🌏 **27 Unicode scripts** — `add_international_text` accepts `lo` (Lao), `nod` (Tai Tham), `khb` (New Tai Lue), `tdd` (Tai Le) and `cjm` (Cham); `ha`, `yo`, `ig`, `sw` are aliases of `latin` (tone marks attach); emoji skin-tone modifiers render. Tai Tham under PDF/A must use `pdfa2b`, not `pdfa2u` (one glyph lacks a `ToUnicode` entry upstream).
- 🔁 **Reproducible on every host** — every date is written in UTC, `{date}` in a header or footer follows the pinned instant, and the operator can pin the whole process with `PDFNATIVE_MCP_CREATION_DATE` or `SOURCE_DATE_EPOCH` (see [Environment variables](#environment-variables)). Not covered, by design: `signingTime`, `modDate`, RFC 3161 tokens and revocation data, encryption, ECDSA signatures. See [`docs/guides/REPRODUCIBLE.md`](docs/guides/REPRODUCIBLE.md).
- 🚦 **`strict` escalates by diagnostic code** — `PDFA_*` → `PDF_A_COMPLIANCE_VIOLATION`, `PDFX_*` → `PDF_X_COMPLIANCE_VIOLATION` (new), anything else → `DIAGNOSTIC_ESCALATED` (new). Both new codes can only be returned by a call that sets `strict: true`.
- 🧩 **A seventh MCP prompt, `typography`** — and `print_ready`, `reproducible_output`, `pdfa_valid` rewritten for CMYK, PDF/X-4, colour bars and the UTC / operator pin.
- 🐛 **Fixes** — a 0–1 RGB triple (`watermark.color`, the `annotate_pdf` colours) now renders the colour it names (`[1, 0, 0]` used to render almost black); any unexpected failure of a tool that takes PDF input is classified `PDF_PARSE_FAILED` instead of surfacing uncoded.
- ✅ **Closed upstream** — a PDF/A form built with `embedFonts: true` now validates under veraPDF (the AcroForm font is embedded), and `inspect_layout` measures a `toc` block exactly as the build lays it out.
- 🧪 **One gate, hardened CI, verified docs** — `npm run gate` is the single definition of green (the built server is driven over stdio and stdout must carry JSON-RPC frames only); veraPDF is **blocking** over a 41-file conformance corpus; a 96-sample byte baseline guards the output; `npm run verify:docs` holds every count, version, tool, error code and operator variable quoted in the docs to [`docs/assets/ecosystem.json`](docs/assets/ecosystem.json) and the source tree.
- 🧾 **Catalogue** — `tools/list` grows to ≈ 306 kB (the typography fragment and the widened colour schemas are inlined in every tool that carries them; `npx tsx scripts/tool-shape.ts --check` holds it under 320 KiB and the instructions under 8 KiB); `_meta.apiVersion` is `1.7.0`.
- ⬆ **Engine upgrade** — [pdfnative **v1.8.0**](https://github.com/Nizoka/pdfnative). No breaking change to the tool API; the bytes that do change (embedded TrueType subsets, `print.marks`, shaped text with mark positioning, UTC dates) are listed under *Upgrade* in [`release-notes/v1.7.0.md`](release-notes/v1.7.0.md).

**New in v1.6.0:**

- 🧱 **Full engine coverage — 13 block kinds** — `generate_basic_pdf` accepts every `DocumentBlock` pdfnative offers: the new `table`, `image`, `link`, `toc`, `barcode`, `svg` and `formField` blocks share their body with the dedicated tools (`add_table`, `embed_image`, `add_barcode`, `add_form`) so a standalone artefact and an inline block validate and render identically. Rules: `link` accepts `http:` / `https:` / `mailto:` only (control characters rejected); `image` blocks are bounded (12 M base64 characters each, 24 MiB decoded per call; PNG must be 8-bit, non-interlaced, without alpha or palette — rejected with a remedy); `svg` covers paths, basic shapes and `<text>` (no `transform`, `<g>`, gradients or CSS — silently ignored; nothing is ever fetched); `toc` pairs with `outline: 'auto'`; `formField` under a PDF/A claim reports `PDFA_UNEMBEDDED_FORM_FONT`; `barcode` has no `alt` (engine limitation).
- 📐 **Layout options on the nine document tools** — `pageSize` (`A4` default, `Letter`, `Legal`, `A3`, `Tabloid`), `margins` (all four, 0–200 pt), `headerTemplate` / `footerTemplate` with `{page}` `{pages}` `{title}` `{date}` (a `footerTemplate` replaces the default footer, so `footerText` is then ignored; `{date}` was the build-day wall clock in 1.6.0 — since v1.7.0 it follows the pinned instant), `compress` (FlateDecode streams — smaller file, different bytes; XMP stays plain under PDF/A) and `debug` (guide rectangles, unmarked content — not for PDF/UA). Absent by default, so default output stays byte-identical.
- 🔐 **Encryption at build time** — `encrypt` on seven document tools (`generate_basic_pdf`, `add_table`, `add_form`, `add_international_text`, `embed_image`, `add_barcode`, `add_chart`): Standard Security Handler, AES-128 default / AES-256, **keeps the AcroForm** (unlike `encrypt_pdf`, which rebuilds the page tree). Exclusive with `pdfA` (`VALIDATION_ERROR`), never cached; not offered on `prepare_signature_placeholder` (must stay signable) or `add_attachment` (PDF/A-3).
- 📏 **`inspect_layout`** — the 28th tool: a read-only pagination dry run over the same `blocks` and layout inputs, reporting `totalPages` and each block's page / x / top / width / height without rendering a PDF. Known engine gap in 1.6.0 (closed in v1.7.0): a `toc` block was measured as 0 pt, so documents with a printed contents could paginate one page later than previewed.
- 🔎 **`inspect_pdf annotations: true`** — lists every page annotation (subtype, 0-based page, rect, contents truncated to 200 chars, title, colour, quadPoints, link URL) plus `annotationCount`; new `check: 'annotations'`.
- 🖼️ **Image watermarks** — `watermark.image` (JPEG/PNG, default opacity 0.10, own 8 MiB cap) on `generate_basic_pdf` and `add_table`, alone or combined with `text` (default opacity 0.15); `position: 'background' | 'foreground'` for both. Either opacity below 1.0 is rejected under `pdfa1b`.
- 🧯 **`PDFNATIVE_MCP_MAX_INFLATE_BYTES`** — operator override of the engine's 100 MiB per-stream decompression cap (integer ≥ 1024; an invalid value refuses to start). A capped attachment stream fails `extract_attachments includeData: true` with `PDF_PARSE_FAILED`; `extract_text` degrades to empty page text (the engine swallows per-page decode failures).
- 📝 **Forms** — `add_form` and `formField` blocks gain `listbox` and `placeholder`; `fieldType: 'textarea'` now reaches the engine as `multilineText` (it was passed through unmapped before and rendered as a single-line field — a bug fix that changes bytes for that input). `embed_image` gains `align` and `alt`.
- 🔏 **PAdES long-term validation ladder** — `sign_pdf` gains `profile: 'pades'` (ETSI EN 319 142-1 baseline, ESS signing-certificate-v2, `ETSI.CAdES.detached`), `timestamp: true` (B-T, RFC 3161), RSA-SHA384/512, `certChainDerBase64`, `fieldName` / `allowMultiple` for several signatures; new `add_ltv` embeds a `/DSS` (B-LT, `mode: 'online'` through the operator provider or `mode: 'offline'` with caller-supplied DER material); new `timestamp_pdf` appends a `/DocTimeStamp` (B-LTA). `verify_pdf ltv: true` reports profile, timestamp, revocation status and `ltvLevel`. See [`docs/guides/LTV.md`](docs/guides/LTV.md).
- 🌐 **Network charter** — no outbound request by default. The only egress the server can ever perform goes to the RFC 3161 / OCSP / CRL endpoints the operator configured (`PDFNATIVE_MCP_TSA_URL`, `PDFNATIVE_MCP_REVOCATION`, `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS`), behind an SSRF guard; tool arguments can never supply a URL.
- 🖨️ **Print production** — every document tool accepts `print` (TrimBox / BleedBox / ArtBox / CropBox or the `bleed` shorthand, crop + registration `marks`, `/UserUnit`), `metadata` (`/Author`, `/Subject`, `/Keywords`, `/Trapped`) and `outputIntent` (custom RGB ICC for PDF/A); `viewerPreferences` gains `duplex`, `pickTrayByPDFSize`, `printPageRange`, `numCopies`. `inspect_pdf pages: true` reports the boxes; merge / split / extract preserve them. See [`docs/guides/PRINT.md`](docs/guides/PRINT.md).
- ✍️ **`update_metadata`** — rewrite `/Info` + XMP of an existing PDF as an incremental update (earlier revisions and signatures preserved verbatim).
- 📊 **Charts v2** — `stackedBar` / `stackedBarH` / `area` / `scatter`, secondary right axis (`axis2`), `axis.scale: 'log'`, `xAxis.type: 'linear' | 'time'`, `dataLabels`, `labelStride` / `labelRotation`; overlapping category labels are thinned automatically.
- 📜 **Honest PDF/A** — `embedFonts: true` embeds Noto Sans Latin (base-14 Helvetica is not embedded, so a PDF/A claim on plain Latin text is rejected by veraPDF), `strict: true` fails instead of producing a non-conformant file, `includeDiagnostics: true` echoes engine diagnostics. Local veraPDF script (`npm run validate:pdfa`) over a 26-file corpus (24 validated, 3 of them negative canaries; 2 page-tree outputs skipped) and a fail-closed `VERAPDF_REQUIRED=1` mode; the CI workflow pins the installer by SHA-256 and stays non-blocking in 1.6.0 (blocking since v1.7.0, where `--require-all` on the gate replaces `VERAPDF_REQUIRED=1`). Known engine gaps in 1.6.0: `add_form` output fails PDF/A-2b even with `embedFonts` (unembedded `/DR /Helv` — closed in v1.7.0), and a `prepare_signature_placeholder` output is conformant only once signed. <!-- verify-docs:allow count-tokens -->
- 🧰 **`inspect_pdf`** — `signatures: true` inventory, `dss` / `docTimestampCount` / `trapped` (presence-gated), new `check` values `dss`, `docTimestamp`, `trapped`; `checks` lists only the keys you requested, and `signed` is structural (a signed field exists — validity is `verify_pdf`'s job).
- 🔁 **Reproducible output** — opt-in `creationDate` on all nine document tools pins `/CreationDate`, the XMP dates and the trailer `/ID`; `signingTime` on `prepare_signature_placeholder` (and on `sign_pdf`, now with time-zone offsets) pins `/Sig /M`. Identical bytes on the same host time zone in 1.6.0 (on every host since v1.7.0: dates are written in UTC). Backed by the `reproducible_output` prompt.
- 🛡️ **Hardened boundary** — strict input schemas (unknown or misspelt keys → `VALIDATION_ERROR` instead of being silently ignored); `data:…;base64,` prefixes tolerated, PEM-where-DER and double-encoded payloads rejected with the exact remedy; page-index mistakes on the page-tree tools are `VALIDATION_ERROR` with a 0-based hint; an unknown tool name is a JSON-RPC protocol error (`-32602`, `[UNKNOWN_TOOL]`).
- 🔑 **HTTP bearer token** — opt-in `PDFNATIVE_MCP_HTTP_TOKEN` gates the Streamable HTTP endpoint (`401` + `WWW-Authenticate` otherwise). Without it the loopback endpoint has no authentication — see [`SECURITY.md`](SECURITY.md).
- 🧾 **Catalogue** — `tools/list` is ≈ 245 kB (1.5.0: ≈ 108 kB) because every block kind, layout option and `encrypt` fragment is now advertised inline — no `$ref` / `$defs` by policy, so hosts that forward `inputSchema` to function-calling APIs never meet a reference; the server instructions are ≈ 6.7 kB (from 12.9 kB). Structure is guarded by `scripts/tool-shape.mjs` (`scripts/tool-shape.ts` since v1.7.0) + `tests/catalogue-parity.test.ts`, and `tests/catalogue-superset.test.ts` proves the live catalogue is a superset of the published 1.5.0 one; at most two executable `_meta.examples` per tool, the rest under [`examples/`](examples/). Four new recipe prompts: `pades_ladder`, `print_ready`, `reproducible_output`, `pdfa_valid`.
- 🐛 **Fixes** — signer metadata (`signerName` / `reason` / `location` / `contactInfo`) never reached the `/Sig` dictionary on pdfnative < 1.7; it is now baked at placeholder time. `verify_pdf` no longer reports `allValid: false` on B-LTA documents (a `/DocTimeStamp` was parsed as a CMS signature).
- 🔌 **MCP 2026-07-28** on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`) with automatic fallback to the 2025-era `initialize` handshake — existing hosts keep working unchanged. See [MCP protocol compliance](#-mcp-protocol-compliance).
- ⬆ **Engine upgrade** — [pdfnative **v1.7.0**](https://github.com/Nizoka/pdfnative) (LTV, print production, charts v2, digest agility, flag / ZWJ emoji sequences, UAX #9 fixes). <!-- verify-docs:allow version-token -->

**New in v1.5.0:**

- 📊 **Native vector charts** — `add_chart` renders bar / horizontal-bar / line / pie / donut charts as pure PDF path operators (zero rasterisation, PDF/A-safe with auto alt text). `generate_basic_pdf` also accepts a `chart` block for composition with text and tables.
- 📝 **Fill & flatten forms** — `read_form_fields` lists an existing AcroForm's fields; `fill_form` fills and/or flattens it via a non-destructive incremental update (the counterpart to `add_form`).
- 🔐 **Encryption round-trip** — `encrypt_pdf` re-secures with AES-128 / AES-256 (RC4 never emitted), `decrypt_pdf` recovers an unencrypted copy, a `password` input opens encrypted sources on the read-only tools, and `merge_pdfs` / `split_pdf` / `extract_pages` gain `password` + `encrypt`.
- 🔤 **Real text extraction** — `extract_text` now resolves each font's `/ToUnicode` CMap (no more glyph-index output) and can return positioned `runs`.
- 🔗 **Native MCP resources** — sandboxed generated PDFs become `pdfnative://output/…` resources (`resources/list` + `resources/read`), with a `resource_link` in file-mode results for cross-call re-reference.
- 🏷️ **Tool annotations** — every tool advertises `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`.
- ⬆ **Engine upgrade** — [pdfnative **v1.6.0**](https://github.com/Nizoka/pdfnative) (decrypt/re-encrypt, `extractText`, fill/flatten, charts; colour-emoji subset 221 → 1167 glyphs). <!-- verify-docs:allow version-token -->

**New in v1.4.0:**

- 🤝 **AI governance + human-in-the-loop** — `draft_governance_issue` lets an agent draft a fully compliant GitHub issue **locally** (draft `.md` + machine-readable compliance report). The agent is a *draftsman, never an autonomous submitter*: a human is the only gate, and the server makes **zero** GitHub writes (and, since v1.6.0, no outbound call other than to operator-configured TSA / OCSP / CRL endpoints). Backed by the `governance_contract` and `draft_issue_workflow` MCP prompts.
- ✏️ **Markup annotations** — `annotate_pdf` overlays highlight, sticky-note, underline, strikeout, squiggly, square, circle, line, and freetext annotations on an existing PDF via incremental update. It is a *visual review layer, not a redaction* — underlying bytes remain.
- 🔢 **Page labels in `inspect_pdf`** — read-only surfacing of `/PageLabels` ranges (roman, decimal, prefixed).
- ∑ **Math / scientific script** — `add_international_text` accepts `lang: 'math'` (explicit, like `emoji`) to embed the Noto Sans Math face on demand.
- 🧩 **MCP prompts** — the server now advertises the `prompts` capability with `governance_contract` and `draft_issue_workflow`.
- ⬆ **Engine upgrade** — pdfnative **v1.5.0**. <!-- verify-docs:allow version-token -->

**New in v1.3.0:**

- 🆕 **Three page-tree tools** — `merge_pdfs`, `split_pdf`, `extract_pages` (built on [pdfnative v1.4.0](https://github.com/Nizoka/pdfnative)'s page-tree API; encrypted sources were rejected until v1.5.0 added `password`). <!-- verify-docs:allow version-token -->
- 🔖 **Bookmarks, page labels & nested lists** — `generate_basic_pdf` gains `outline` (`'auto'` or explicit tree), `pageLabels`, multi-level `list` items, and `viewerPreferences`.
- 📐 **Table cell borders & alignment** — `add_table` gains `cellBorders`, `cellVAlign`, and `viewerPreferences`; `add_international_text` gains `viewerPreferences`.
- 🔐 **Constant-time signing** — `sign_pdf` signs RSA and EC-DER keys through a `node:crypto` provider with a transparent pure-JS fallback (raw P-256 scalars stay pure JS, and verification is pure JS); signatures stay interoperable.
- ⬆ **Engine upgrade** — pdfnative **v1.4.0**. <!-- verify-docs:allow version-token -->

- 🆕 **Tool `extract_attachments`** — read embedded files back out of a PDF (completes the Factur-X / ZUGFeRD round-trip) with byte-for-byte payloads, a `filename` filter, and an `includeData: false` metadata-only probe.
- 💧 **Watermarks** — `generate_basic_pdf` and `add_table` accept an optional `watermark` (text, opacity, angle, colour, position; `image` since v1.6.0) rendered on every page.
- 🌐 **Unicode `normalize`** — opt-in `NFC`/`NFD`/`NFKC`/`NFKD` on `generate_basic_pdf` and `add_international_text`.
- 🪙 **Token-frugal reads** — the read-only tools (`inspect_pdf`, `verify_pdf`, `validate_pdf`, `extract_text`, `extract_attachments`; `read_form_fields` since v1.5.0) accept optional `verbosity: 'summary'` and `fields: […]` inputs for ~90% smaller responses on large results, with no loss of the fields agents branch on. Defaults are unchanged.
- 🪙 **No base64 duplication** — generated PDFs (base64 mode) are returned **once** as an embedded `resource` content block instead of also being copied into `structuredContent`.
- 🔧 **MCP registry publish fix** — `mcpName` now uses the canonical GitHub login casing (`io.github.Nizoka/pdfnative-mcp`) so the registry's case-sensitive validation accepts the npm package.
- ⬆ **Dependency** — upgraded to **zod 4**.

**New in v1.1.0:**

- 🆕 **Tool `validate_pdf`** — read-only PDF/UA (ISO 14289-1) structural conformance check.
- 🆕 **Six new scripts** — Telugu, Sinhala, Tibetan, Khmer, Myanmar, Ethiopic (**24 scripts** total).
- 🆕 **COLRv1 colour emoji** — native colour emoji with monochrome fallback.
- 🆕 **Newline sanitizer** — embedded `\n` in paragraphs auto-splits into separate paragraphs (Safe PDF/A).
- 🆕 **Automatic NFC normalisation** for `add_international_text`.
- 🛠 **Engine upgrade** — [pdfnative v1.3.0](https://github.com/Nizoka/pdfnative): the Euro sign / CP-1252 symbols now extract correctly, and wrapped table cells get unique per-line MCIDs (PDF/UA-safe). <!-- verify-docs:allow version-token -->

**New in v1.0.0:**

- 🆕 **Three new tools:** `verify_pdf`, `add_attachment` (Factur-X / ZUGFeRD), `extract_text`.
- 🆕 **Smart-table fields:** `wrap`, `repeatHeader`, `zebra`, `caption`, `minRowHeight`, `cellPadding`.
- 🆕 **`inspect_pdf`** now reports `hasSignaturePlaceholder` and per-attachment summary; new `check` values `'placeholder'` and `'attachments'`.
- 🆕 **Signing ergonomics:** `sign_pdf` accepts ECDSA SEC1 / PKCS#8 DER keys and auto-injects a `/Sig` placeholder when missing (one-call signing of any PDF).
- 🆕 **Opt-in cache** (`PDFNATIVE_MCP_CACHE_DIR`): SHA-256 keyed, 1 h TTL, 256 MiB LRU.
- 🆕 **`_meta.apiVersion`** and per-tool **`_meta.examples`** for AI-agent discovery — see [`docs/API_STABILITY.md`](docs/API_STABILITY.md).
- 🆕 **AI agent guide:** [`docs/AI_GUIDE.md`](docs/AI_GUIDE.md) — decision tree + common pitfalls. See also the agent contract, [`docs/AGENT_CONTRACT.md`](docs/AGENT_CONTRACT.md) (catalogue, decision tree, recipes, error table); contributors and coding agents start at [`AGENTS.md`](AGENTS.md).
- 🆕 **PDF/A authoring guide:** [`docs/guides/PDFA.md`](docs/guides/PDFA.md).
- 🛠 **Env-var rename:** `PDFNATIVE_MCP_OUTPUT_DIR` (was `PDFNATIVE_MPC_OUTPUT_DIR`; old name still works with a one-shot deprecation warning).
- ✅ **Now shipped:** `merge_pdfs`, `split_pdf`, `extract_pages` (v1.3.0), `annotate_pdf` (v1.4.0), the `add_chart` / `read_form_fields` / `fill_form` / `encrypt_pdf` / `decrypt_pdf` tools plus the encrypted round-trip and native MCP resources (v1.5.0), and `add_ltv` / `timestamp_pdf` / `update_metadata` plus print production and charts v2 (v1.6.0). `redact_pdf` stays **deferred** — pdfnative can overlay/flatten but not *remove* page content, and an overlay-only "redaction" would create false security, so it is intentionally not shipped (tracked as an upstream content-removal request). <!-- verify-docs:allow tool-parity -->

All tools support two output modes:

- **`base64`** *(default)* — the generated PDF is returned **once** as an embedded `resource` content block (a `data:application/pdf;base64,…` URI); `structuredContent` carries only `{ mode, sizeBytes }` (plus `diagnostics[]` when `includeDiagnostics: true`, and a `summary` for `add_ltv`).
- **`file`** — the PDF is written to a sandboxed directory configured via `PDFNATIVE_MCP_OUTPUT_DIR`. File output is disabled unless this variable is set; absolute paths, path traversal, non-`.pdf` extensions, and NUL bytes are all rejected.

> **Upgrading from v1.1.0:** the only behaviour change is that base64-mode bytes are
> no longer duplicated into `structuredContent.base64`. Read them from the embedded
> `resource` block instead:
>
> ```diff
> - const base64 = response.structuredContent.base64;   // v1.1.0
> + const block = response.content.find((c) => c.type === 'resource');
> + const base64 = block.resource.blob;                  // v1.2.0
> ```


**Token-frugal reads (v1.2.0).** The seven read-only tools (`inspect_pdf`, `verify_pdf`, `validate_pdf`, `extract_text`, `extract_attachments`, `read_form_fields`, `inspect_layout`) accept two optional inputs:

- `verbosity: 'summary'` — returns a compact scalar-only verdict (drops the heavy arrays / full text). E.g. `verify_pdf` → `{ signatureCount, allValid, invalid, summary }` (+ `ltvLevel` with `ltv: true`); `inspect_pdf` keeps `docTimestampCount` / `trapped` / `checksPassed` when present.
- `fields: ['a', 'b.c']` — projects the structured result to named dot-paths; composes after `verbosity`. Unmatched paths are omitted and reported in `_meta.unmatchedFields` (with `_meta.availableFields`).

Smallest “is this PDF signed and valid?” probe: `{ "pdfBase64": "…", "verbosity": "summary", "fields": ["allValid"] }`.

### Why pdfnative?

`pdfnative-mcp` inherits every guarantee of the underlying engine:

- **Zero runtime dependencies in the engine** — pure JavaScript, no native bindings (this server adds only the MCP SDK and zod: three runtime dependencies in total).
- **ISO 32000-1 (PDF 1.7)** compliant output.
- **PDF/A-1b/2b/2u/3b**, **AES-128/256 encryption**, **AcroForm**, **digital signatures**.
- **27 Unicode scripts** (34 `lang` codes incl. `latin`, `emoji`, `math` and the four `latin` aliases) with built-in BiDi reordering, Arabic positional shaping, Thai/Devanagari/Bengali/Tamil OpenType shaping.
- **PDF/X-4** print exchange, DeviceCMYK colour and fine typography (orphan / widow control, justification, French punctuation spacing, OpenType features).
- Tree-shakeable ESM build.

---

## 🚀 Installation

```bash
# Run directly with npx (recommended for MCP clients)
npx -y pdfnative-mcp

# Or install globally
npm install -g pdfnative-mcp
pdfnative-mcp
```

Requirements: **Node.js ≥ 22**.

---

## ⚙️ Configuration

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "pdfnative": {
      "command": "npx",
      "args": ["-y", "pdfnative-mcp"],
      "env": {
        "PDFNATIVE_MCP_OUTPUT_DIR": "/Users/you/Documents/mcp-pdfs"
      }
    }
  }
}
```

### Cursor / Continue / Zed / Windsurf / Cline / Roo Code

Any MCP-compatible client that supports stdio servers will work. Use the same `command` + `args` + `env` triple. Example for **Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "pdfnative": {
      "command": "npx",
      "args": ["-y", "pdfnative-mcp"],
      "env": { "PDFNATIVE_MCP_OUTPUT_DIR": "/Users/you/Documents/mcp-pdfs" }
    }
  }
}
```

**Windsurf / Cline / Roo Code** use the same shape inside their respective MCP config files.

### 🌐 Supported AI Ecosystem & Clients

`pdfnative-mcp` is designed for MCP-native environments and works with clients that support MCP over stdio or Streamable HTTP.

Community-verified compatibility includes:

- **[Ontheia](https://ontheia.ai)** — a self-hosted, open-source AI agent platform (privacy-first). Reported as working out of the box in [issue #41](https://github.com/Nizoka/pdfnative-mcp/issues/41) and listed on Ontheia's [compatible MCP servers page](https://docs.ontheia.ai/en/getting-started/03_compatible-mcp-servers/).

### 🔌 MCP protocol compliance

Since v1.6.0 the server is built on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`) and speaks **MCP 2026-07-28**:

- **Stateless serving** — `server/discover` replaces the session handshake; every result carries `resultType` and the `_meta` `serverInfo` envelope. Over HTTP, 2026-07-28 clients send `Mcp-Method` / `Mcp-Name` headers with each `POST /mcp`.
- **Cache hints** — `tools/list` and `prompts/list` are `public` with a 24 h `ttlMs`, `server/discover` is `public` for 1 h, and `resources/list` / `resources/templates/list` / `resources/read` are `private` with `ttlMs: 0` (generated PDFs are per-host user data).
- **Resource errors** — an unknown resource URI is reported as JSON-RPC `-32602` (Invalid params), as the 2026-07-28 specification requires.
- **Automatic legacy fallback** — a client that opens with `initialize` (2025-11-25, 2025-06-18 or 2025-03-26) is served through the SDK's legacy path on both stdio and HTTP. Nothing changes for existing hosts.
- **HTTP** — `GET` / `DELETE /mcp` answer **405** (no SSE resumability; the server is stateless). The loopback bind and the `Host` / `Origin` guard are unchanged, and the `Origin` port must now equal the server port (the SDK check alone is port-agnostic); `PDFNATIVE_MCP_HTTP_TOKEN` adds an opt-in bearer-token gate (`401` + `WWW-Authenticate` without it). JSON-RPC batch arrays (2025-03-26) are accepted over HTTP. Keep-alive connections no longer accumulate socket listeners.
- **stdio** — as in every SDK release to date, a request sent before `initialize` is dropped without a reply and JSON-RPC batch arrays are not accepted on stdio (unchanged from 1.5.0; no major host batches).
- **Protocol errors** — `tools/call` with an unknown tool name is a JSON-RPC error (`-32602`, `[UNKNOWN_TOOL] Unknown tool: …`) rather than an `isError` result, as the specification classifies it; `isError: true` is reserved for execution failures.
- **Output schemas** — every `structuredContent` validates against the tool's `outputSchema` (a 2026-07-28 MUST), including `verbosity: 'summary'` and `fields` projections: the seven read tools declare projectable schemas (all properties optional, `additionalProperties: false` kept). Input schemas carry no `$schema` keyword by policy (MCP ≥ 2025-11-25 defaults to JSON Schema 2020-12; some hosts forward `inputSchema` to function-calling APIs that reject unknown keywords). `serverInfo` carries `websiteUrl`; the resource template is `pdfnative://output/{+path}`.

The `tools/call` payload (`content`, `structuredContent`, `isError`) is identical between the 2026-07-28 path and the legacy path; `tests/http-modern.test.ts` asserts it, and `tests/schema-conformance.test.ts` validates `structuredContent` with the SDK's JSON Schema 2020-12 validator.

| Client                                                   | Transport        | Protocol negotiated                                 |
| -------------------------------------------------------- | ---------------- | --------------------------------------------------- |
| Claude Desktop, Cursor, Continue, Zed, Windsurf, Cline   | stdio            | legacy `initialize` (2025-xx) — unchanged           |
| ChatGPT and other Streamable HTTP hosts                  | HTTP `POST /mcp` | legacy stateless streamable HTTP — unchanged        |
| MCP 2026-07-28 clients (SDK v2 `Client`, current MCP Inspector) | stdio / HTTP | `server/discover`, cache hints, `_meta` envelope |
| Ontheia                                                  | stdio            | legacy `initialize` (community-verified, #41)       |

### Environment variables

| Variable                      | Purpose                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `PDFNATIVE_MCP_OUTPUT_DIR`    | Absolute path to the sandbox directory. **Required to enable `outputMode: 'file'`.** |
| `PDFNATIVE_MCP_CACHE_DIR`     | Absolute path to enable the persistent SHA-256-keyed result cache (1 h TTL, 256 MiB LRU; key namespaced by tool API + package version + the pinned creation instant). When unset, the cache is disabled. Never caches `encrypt_pdf` / `decrypt_pdf` / `sign_pdf` / `add_ltv` / `timestamp_pdf` / `update_metadata` or file-mode calls; a hit carries `_meta.cached: true` and returns the earlier call's bytes. |
| `PDFNATIVE_MCP_PORT`          | When set to a valid port (1–65535), starts an HTTP server on `http://127.0.0.1:<port>/mcp` instead of stdio. Binds loopback only and enables DNS-rebinding protection (foreign `Host`/`Origin` → **403**). **No authentication unless `PDFNATIVE_MCP_HTTP_TOKEN` is set** — other local processes can reach the endpoint. |
| `PDFNATIVE_MCP_HTTP_TOKEN`    | *(v1.6.0, secret)* Opt-in bearer token for the HTTP transport (≥ 16 characters, no whitespace — a weaker value aborts startup). When set, every `/mcp` request must carry `Authorization: Bearer <token>`; otherwise **401** + `WWW-Authenticate: Bearer realm="pdfnative-mcp"` (with `error="invalid_token"` only when credentials were sent — RFC 6750 §3.1). Compared constant-time, never logged. |
| `PDFNATIVE_MCP_MAX_INFLATE_BYTES` | *(v1.6.0)* Overrides the engine's 100 MiB per-stream decompression cap (zip-bomb guard): a positive integer number of bytes ≥ 1024, read once at startup — an invalid value refuses to start. Lower it on a shared host, raise it for trusted archives of large scans. A capped attachment stream fails `extract_attachments includeData: true` with `PDF_PARSE_FAILED`; `extract_text` degrades to empty page text for a capped content stream (engine behaviour, no error surfaced). |
| `PDFNATIVE_MCP_TSA_URL`       | *(v1.6.0)* Absolute `http(s)` URL of the RFC 3161 timestamp authority used by `sign_pdf timestamp: true` and `timestamp_pdf`. Unset: `TSA_NOT_CONFIGURED`, no request is made. |
| `PDFNATIVE_MCP_TSA_AUTH`      | *(v1.6.0, secret)* Optional `Authorization` header value sent to the TSA. Never logged or echoed. |
| `PDFNATIVE_MCP_REVOCATION`    | *(v1.6.0)* `ocsp`, `crl` or `ocsp,crl` — enables online revocation collection for `add_ltv mode: 'online'`. Unset: `REVOCATION_NOT_CONFIGURED`. |
| `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS` | *(v1.6.0)* Comma-separated allow-list (`host`, `host:port`, `*.suffix`) for OCSP / CRL responders. **Mandatory** when `PDFNATIVE_MCP_REVOCATION` is set — responder URLs come from untrusted certificates. |
| `PDFNATIVE_MCP_NETWORK_TIMEOUT_MS` | *(v1.6.0)* Per-request timeout for TSA / OCSP / CRL calls, 1000–120000 ms (default 10000). |
| `PDFNATIVE_MCP_CREATION_DATE` | *(v1.7.0)* ISO 8601 instant **with a time zone** (e.g. `2026-01-01T00:00:00Z`) that pins the creation instant of every document the process builds: `/CreationDate`, the XMP dates, the trailer `/ID` and the `{date}` header / footer placeholder. Read once at startup — an invalid value refuses to start; the source of the pin is logged on stderr. |
| `SOURCE_DATE_EPOCH`           | *(v1.7.0)* The [reproducible-builds.org](https://reproducible-builds.org/docs/source-date-epoch/) convention: integer seconds since the Unix epoch, used when `PDFNATIVE_MCP_CREATION_DATE` is unset. An invalid value refuses to start. Many build environments already export it: from this release it pins every document's creation date — unset it for the server process if that is not wanted. |

**Creation-date precedence** (highest first): the per-call `creationDate` → `PDFNATIVE_MCP_CREATION_DATE` → `SOURCE_DATE_EPOCH` → the wall clock. Dates are always written in UTC, so pinned output is byte-identical on every host and in every time zone. The pin does **not** cover, by design: `signingTime` (`sign_pdf`, `prepare_signature_placeholder`), `modDate` (`update_metadata`), the regenerated second `/ID` of incremental writers (`annotate_pdf`, `fill_form`), RFC 3161 timestamp tokens and online revocation data, encryption (fresh file key, salts and IVs) and ECDSA signatures (randomised by design). See [`docs/guides/REPRODUCIBLE.md`](docs/guides/REPRODUCIBLE.md).

---

## 🛠 Tool reference

### `generate_basic_pdf`

```jsonc
{
  "title": "Q1 2026 Report",
  "blocks": [
    { "type": "heading", "text": "Executive summary", "level": 1 },
    { "type": "paragraph", "text": "Revenue grew 24% year over year." },
    { "type": "list", "style": "bullet", "items": ["Strong APAC", "Stable EU", "Soft NA"] },
    { "type": "pageBreak" },
    { "type": "heading", "text": "Details", "level": 2 }
  ],
  "footerText": "Confidential — Internal use only",
  "outputMode": "base64"
}
```

The 13 block kinds: `heading`, `paragraph`, `list`, `table`, `image`, `link`, `toc`, `barcode`, `svg`, `formField`, `chart`, `pageBreak`, `spacer`. A composite report:

```jsonc
{
  "title": "Quarterly report",
  "blocks": [
    { "type": "toc" },
    { "type": "heading", "text": "Sales", "level": 1 },
    { "type": "table", "headers": ["Region", "Revenue"], "rows": [["EMEA", "1.2 M"], ["APAC", "0.9 M"]], "zebra": true },
    { "type": "image", "imageBase64": "<base64 JPEG>", "mimeType": "image/jpeg", "width": 300, "alt": "Revenue chart" },
    { "type": "svg", "data": "M10 10 H 90 V 90 H 10 Z", "viewBox": [0, 0, 100, 100], "fill": "#0a7e8c" },
    { "type": "barcode", "format": "qr", "data": "https://example.com/q1", "align": "center" },
    { "type": "link", "text": "Full dataset", "url": "https://example.com/data" },
    { "type": "formField", "fieldType": "text", "name": "reviewer", "label": "Reviewed by" }
  ],
  "outline": "auto",
  "pageSize": "Letter",
  "headerTemplate": { "right": "{title} — page {page}/{pages}" },
  "embedFonts": true
}
```

Block rules: `table`, `barcode`, `formField` and `chart` take the same body as `add_table` / `add_barcode` / `add_form` / `add_chart`; `link` URLs must be `http:`, `https:` or `mailto:`; `image` blocks are capped at 12 M base64 characters each and 24 MiB decoded per call (PNG: 8-bit greyscale/RGB, non-interlaced, no alpha, no palette — otherwise `VALIDATION_ERROR` with a remedy); `svg` supports `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>`, `<text>`/`<tspan>` and silently ignores `transform`, `<g>`, `<use>`, `<image>`, gradients, opacity and CSS (no external reference is ever fetched); `toc` is built from the heading blocks and pairs with `outline: 'auto'`; `formField` under `pdfA` needs `embedFonts: true` so the field font is embedded too (`PDFA_UNEMBEDDED_FORM_FONT` otherwise; `strict: true` then fails); `barcode` has no `alt`. Use `inspect_layout` with the same inputs to preview the pagination before rendering.

**Typography (v1.7.0).** `typography` is one opt-in object (12 keys, all off by default — omitted means unchanged bytes) on the nine document tools and on `inspect_layout`:

```jsonc
{
  "title": "Annual report",
  "embedFonts": true,
  "typography": {
    "splitParagraphs": true, "orphans": 3, "widows": 3,
    "keepHeadingsWithNext": { "minLines": 3 },
    "opticalMargins": true, "kerning": true, "fontFeatures": ["onum", "smcp"],
    "unitBinding": true, "bindShortWords": true, "punctuationSpacing": "fr"
  },
  "blocks": [
    { "type": "heading", "text": "Outlook", "level": 2, "keepWithNext": true },
    { "type": "paragraph", "text": "A long justified paragraph…", "align": "justify" },
    { "type": "paragraph", "text": "Figures by region:", "keepWithNext": true, "splittable": false }
  ]
}
```

- Keys: `splitParagraphs`, `orphans` / `widows` (1–10, default 2, need `splitParagraphs`), `keepHeadingsWithNext` (`true` or `{ minLines }`), `unitBinding` (`true` or `{ units }`), `bindShortWords` (`true` or `{ maxLength, words }`), `punctuationSpacing` (`'fr'`, `'fr-CA'` or an array of `{ char, side, space }` rules), `opticalMargins`, `metrics` (`'approximate'` default / `'exact'`), `fontFeatures` (`tnum`, `pnum`, `lnum`, `onum`, `zero`, `ordn`, `sups`, `subs`, `smcp`, `c2sc`, `case`), `kerning`, `hyphenationLanguage`.
- Block inputs: a `paragraph` takes `align` (`left` default / `right` / `center` / `justify`), `keepWithNext` and `splittable` (overrides `typography.splitParagraphs` for that block); a `heading` takes `keepWithNext` (overrides `typography.keepHeadingsWithNext` for that block).
- Limits: `kerning`, `fontFeatures` and the `'fr'` narrow no-break space need an embedded font (`embedFonts: true`; on base-14 Helvetica `'fr'` degrades to `'fr-CA'`); `metrics: 'exact'` acts on base-14 text only; `tnum` / `lnum` change nothing on the bundled Noto Sans (diagnostic `TYPOGRAPHY_FEATURE_INEFFECTIVE`); **no hyphenation dictionary is installed**, so `hyphenationLanguage` has no effect on this server — soft hyphens (U+00AD) in the text are honoured. See [`docs/guides/TYPOGRAPHY.md`](docs/guides/TYPOGRAPHY.md) and the `typography` prompt.

**CMYK colours (v1.7.0).** Every colour input keeps the form it has always accepted (hex on charts, templates, `link` and `svg` blocks; a 0–1 RGB triple on watermarks and `annotate_pdf`; a free string on outline entries and table cell borders) and gains DeviceCMYK beside it: an operand string `'c m y k'` with components 0–1 (`"1 0.6 0 0.1"`) and a percent tuple `[c, m, y, k]` with components 0–100 (`[100, 60, 0, 10]`). Under a PDF/A claim against the default sRGB intent a CMYK colour reports `PDFA_DEVICE_CMYK_CONTENT` — keep colours RGB there, or supply a CMYK `outputIntent`.

**PDF/X-4 (v1.7.0).** `pdfx: 'pdfx4'` on `generate_basic_pdf`, `add_table`, `add_chart`, `add_barcode`, `embed_image` and `add_international_text` writes a PDF/X-4 (ISO 15930-7) file: `%PDF-1.6` header, the PDF/X-4 XMP identification, a `/GTS_PDFX` output intent, a TrimBox on every page and `/Trapped`.

```jsonc
{
  "title": "Spring catalogue",
  "pdfx": "pdfx4",
  "embedFonts": true,
  "outputIntent": { "iccProfileBase64": "<the printer's CMYK ICC profile, base64>", "outputConditionIdentifier": "FOGRA39" },
  "metadata": { "trapped": "False" },
  "print": { "bleed": 14.17, "marks": { "colourBars": true } },
  "blocks": [{ "type": "paragraph", "text": "Four-colour job exchanged as PDF/X-4." }]
}
```

- It **requires** `outputIntent` with the ICC profile of the printing condition (device class `prtr`, CMYK or Gray — **no press profile is bundled**; ask your printer); it needs `embedFonts: true` for a conformant file (`PDFX_NO_FONT_ENTRIES` otherwise; `strict: true` refuses); it is exclusive with `pdfA` and `encrypt`; `metadata.trapped` must be `'True'` or `'False'`; a page carries a TrimBox or an ArtBox, not both. Incoherent requests are refused with `VALIDATION_ERROR` before any work is done. Links and form fields are reported (`PDFX_ANNOTATIONS`); with `strict: true` a `PDFX_*` diagnostic fails the call with `PDF_X_COMPLIANCE_VIOLATION`.
- `outputIntent` accepts RGB, CMYK and Gray profiles (≤ 8 MiB, under `pdfA` or `pdfx`). The profile must be a real ICC file (`acsp` signature, consistent size field) — a hand-made stub is rejected.
- `print.marks` accepts `true` or an object; `marks.colourBars` (`true` or `{ tints, size }`, `size` 4–72 pt, default 12) adds the C M Y K solids and their 50 % tints in the bleed. Off by default; it needs a bleed of about 5 mm (14.17 pt) and is skipped when the strip would not fit.
- Check the result with `validate_pdf { standard: 'pdf-x-4' }` — a structural check, **not a certified preflight**. See [`docs/guides/PRINT.md`](docs/guides/PRINT.md) and the `print_ready` prompt.

### `add_barcode`

```jsonc
{
  "format": "qr",
  "data": "https://pdfnative.dev",
  "caption": "Scan to learn more",
  "ecLevel": "H",
  "outputMode": "file",
  "outputPath": "tickets/event-42.pdf"
}
```

Supported formats: `qr`, `code128`, `ean13`, `datamatrix`, `pdf417`.

### `add_international_text`

```jsonc
{
  "title": "مرحبا بالعالم",
  "lang": "ar",
  "paragraphs": [
    "هذا اختبار للنص العربي مع تشكيل OpenType ومحارف ثنائية الاتجاه.",
    "Mixed content: العربية + English ✓"
  ]
}
```

Supported `lang` codes: the 27 Unicode scripts — `ar`, `he`, `th`, `ja`, `zh`, `ko`, `el`, `hi`, `bn`, `ta`, `ru`, `ka`, `hy`, `tr`, `pl`, `vi`, `te`, `si`, `bo`, `km`, `my`, `am`, and since v1.7.0 `lo` (Lao), `nod` (Tai Tham), `khb` (New Tai Lue), `tdd` (Tai Le), `cjm` (Cham) — plus the utility faces `latin`, `emoji` and `math`. Since v1.7.0 `ha` (Hausa), `yo` (Yoruba), `ig` (Igbo) and `sw` (Swahili) are aliases of `latin`: the bundled Noto Sans anchors their tone marks, no extra font is embedded. Fonts are always embedded (no `embedFonts` input); pin `creationDate` for byte-identical output. The tool also accepts `typography` and `pdfx` (see [`generate_basic_pdf`](#generate_basic_pdf)).

> **Tai Tham under PDF/A:** use `pdfA: 'pdfa2b'` with `lang: 'nod'`, not `pdfa2u` — one glyph lacks a `ToUnicode` entry in the engine, which veraPDF rejects under PDF/A-2u (tracked upstream).

Multi-script documents — pass an array or comma-separated list:

```jsonc
{
  "title": "Mixed Script",
  "lang": ["ar", "emoji"],
  "paragraphs": ["العربية مع رموز 🎉🚀"],
  "pdfA": "pdfa2u"
}
```

### `sign_pdf`

As of v1.0.0, `sign_pdf` auto-injects a `/Sig` placeholder when missing — you can sign **any** PDF in one call:

```jsonc
{
  "pdfBase64": "<any base64 PDF>",
  "algorithm": "rsa-sha256",
  "certDerBase64": "<base64 X.509 cert in DER>",
  "rsaKeyPkcs1DerBase64": "<base64 PKCS#1 RSAPrivateKey DER>",
  "signerName": "Alice",
  "reason": "Approval",
  "location": "Paris, FR",
  "signingTime": "2026-01-15T10:30:00Z"
}
```

For ECDSA P-256: use `algorithm: "ecdsa-sha256"` and supply either `ecPrivateKeyDerBase64` (SEC1 or PKCS#8 DER) or `ecPrivateScalarHex` (64 hex chars).

PEM → DER conversion:

```bash
openssl x509 -in cert.pem -outform DER | base64 -w0                 # cert
openssl rsa  -in key.pem  -outform DER -traditional | base64 -w0    # RSA PKCS#1
openssl pkey -in key.pem  -outform DER | base64 -w0                 # ECDSA
```

> Use `prepare_signature_placeholder` only when you need to customize the placeholder (e.g. larger `placeholderBytes` for >4096-bit RSA keys, `subFilter: 'ETSI.CAdES.detached'`, `reserveTimestamp: true`). Otherwise call `sign_pdf` directly.

**PAdES ladder (v1.6.0).** `sign_pdf` with `profile: "pades"` produces a B-B signature; add `timestamp: true` for B-T (needs `PDFNATIVE_MCP_TSA_URL`), then `add_ltv` (B-LT) and `timestamp_pdf` (B-LTA):

```jsonc
// 1. sign_pdf  { ..., "profile": "pades", "timestamp": true, "certChainDerBase64": ["<intermediate DER>"] }
// 2. add_ltv   { "pdfBase64": "<signed>", "mode": "online" }            // or "offline" + certificatesDerBase64 / ocspResponsesDerBase64 / crlsDerBase64
// 3. timestamp_pdf { "pdfBase64": "<ltv>" }                              // re-run before the TSA certificate expires
// 4. verify_pdf { "pdfBase64": "<final>", "ltv": true }                  // -> ltvLevel: "B-LTA"
```

Signer metadata (`signerName`, `reason`, `location`, `contactInfo`) is baked into the placeholder; `fieldName` selects one of several unsigned placeholders (`PLACEHOLDER_AMBIGUOUS` otherwise) and `allowMultiple: true` adds a further signature. See [`docs/guides/LTV.md`](docs/guides/LTV.md).

---

### `add_table`

```jsonc
{
  "title": "Monthly Sales",
  "headers": ["Region", "Units", "Revenue"],
  "rows": [
    ["APAC", "1200", "$240,000"],
    ["EMEA", "800", "$160,000"]
  ],
  "infoItems": [{ "label": "Period", "value": "January 2025" }],
  "footerText": "Internal use only",
  "outputMode": "base64"
}
```

### `add_form`

```jsonc
{
  "title": "Employee Onboarding",
  "fields": [
    { "fieldType": "text", "name": "fullName", "label": "Full Name", "required": true },
    { "fieldType": "dropdown", "name": "dept", "label": "Department", "options": ["Engineering", "Sales", "HR"] },
    { "fieldType": "checkbox", "name": "agree", "label": "I agree to the terms", "checked": false },
    { "fieldType": "listbox", "name": "skills", "label": "Skills", "options": ["TypeScript", "PDF", "MCP"] },
    { "fieldType": "textarea", "name": "notes", "label": "Notes", "placeholder": "Anything we should know?" }
  ],
  "outputMode": "base64"
}
```

Field types: `text`, `textarea` (multi-line, `/Ff 4096`), `checkbox`, `radio`, `dropdown`, `listbox`; `placeholder` shows hint text while a field is empty. Add `encrypt` to produce a password-protected form that keeps its AcroForm. Under a PDF/A claim pass `embedFonts: true` so the field font is embedded too (since v1.7.0 such a form validates under veraPDF); without it the call reports `PDFA_UNEMBEDDED_FORM_FONT` (`strict: true` then fails).

### `embed_image`

```jsonc
{
  "title": "Product Photo",
  "imageBase64": "<base64-encoded JPEG bytes>",
  "mimeType": "image/jpeg",
  "caption": "Front view of Model X",
  "width": 400,
  "align": "center",
  "alt": "Front view of the Model X chassis",
  "outputMode": "base64"
}
```

> **Note:** the engine's PNG decoder accepts 8-bit, non-interlaced greyscale / RGB images only. Alpha-channel (colour type 4 / 6), palette (type 3), 16-bit and interlaced PNGs are rejected at the boundary with `VALIDATION_ERROR` and a remedy (flatten or re-export) — the same rule applies to `image` blocks and image watermarks. `embed_image.imageBase64` keeps its 1.5.0 contract with no length bound; the 12 M-character cap applies to inline `image` blocks and watermark images only.

### `prepare_signature_placeholder`

```jsonc
{
  "title": "Service Agreement",
  "signerName": "Alice Dupont",
  "reason": "Approved",
  "location": "Paris, FR",
  "blocks": [
    { "type": "paragraph", "text": "By signing below, I accept the terms and conditions." }
  ],
  "outputMode": "base64"
}
```

Pass the returned PDF bytes to `sign_pdf` to complete the signing workflow.

### `inspect_pdf`

Read-only structural and security inspection — useful for downstream verification, CI assertions, and AI agents that need to reason about a PDF before acting on it.

```jsonc
{
  "pdfBase64": "<base64 PDF>",
  "pages": true,
  "check": ["pdfa", "signed", "attachments"]
}
```

Returns:

```jsonc
{
  "version": "1.7",
  "pageCount": 3,
  "encryption": "none",          // 'none' | 'aes-128' | 'aes-256' | 'rc4' | 'unknown'
  "pdfA": "3B",                  // null when no PDF/A claim is present
  "signatureCount": 1,
  "hasSignaturePlaceholder": false,
  "attachments": [{ "filename": "factur-x.xml", "mimeType": "application/xml", "sizeBytes": 1234, "relationship": "Source" }],
  "info": { "Producer": "pdfnative", "Title": "Invoice INV-2025-001" },
  "perPage": [{ "index": 0, "width": 595, "height": 842 }],
  "checks": { "pdfa": true, "signed": true, "attachments": true },
  "checksPassed": true
}
```

`check[]` accepts any of `'pdfa'`, `'signed'`, `'encrypted'`, `'placeholder'`, `'attachments'`, `'dss'`, `'docTimestamp'`, `'trapped'`, `'annotations'` (the last four since v1.6.0) and `'pdfx'` (since v1.7.0: the XMP claims PDF/X — the claim, not its validity; that is `validate_pdf standard: 'pdf-x-4'`). `pdfX` appears in the result only when the XMP claims PDF/X (kept by `verbosity: 'summary'`). `checksPassed` is the AND of all requested checks. `signatures: true` adds a per-field inventory (`subFilter`, `isDocTimestamp`, `isPlaceholder`, `byteRange`, `vriKey`); `annotations: true` adds `annotations[]` (every `/Annots` entry: 0-based `page`, `subtype`, `rect`, and when present `contents` truncated to 200 chars, `title`, `color`, `quadPoints`, link `url`) plus `annotationCount`; `dss`, `docTimestampCount` and `trapped` appear only when present; with `pages: true` each `perPage` entry also carries `trimBox` / `bleedBox` / `artBox` / `cropBox` / `userUnit` when set.

### `inspect_layout`

Read-only pagination dry run — the same `blocks` as `generate_basic_pdf` plus every input that moves a block (`title`, `footerText`, `pdfA`, `normalize`, `embedFonts`, `pageSize`, `margins`, `headerTemplate`, `footerTemplate`, and since v1.7.0 `typography`). No PDF is produced; pass exactly what you will give `generate_basic_pdf` and `totalPages` matches.

```jsonc
{ "title": "Memo", "blocks": [{ "type": "paragraph", "text": "Short note." }], "pageSize": "Letter", "verbosity": "summary", "fields": ["totalPages"] }
```

The full result carries `pageWidth`, `pageHeight`, `margins`, `totalPages` and `pages[].blocks[]` (`type`, `page`, `x`, `top`, `width`, `height` in points, rounded to two decimals). Since v1.7.0 the dry run and the build share one pagination planner, so every block kind — `toc` included — is measured exactly as it is laid out (in 1.6.0 a `toc` block was measured as 0 pt).

### `validate_pdf`

Read-only structural conformance check. `standard` picks the rule set: `'pdf-ua-1'` (default — **PDF/UA, ISO 14289-1**, for a Tagged PDF) or, since v1.7.0, `'pdf-x-4'` (**PDF/X-4, ISO 15930-7**). Generate an accessible document with any tool using `pdfA` (e.g. `pdfA: 'pdfa2u'`), then validate the result:

```jsonc
{ "pdfBase64": "<tagged-pdf-base64>" }
```

Returns:

```jsonc
{
  "standard": "pdf-ua-1",
  "valid": true,
  "errors": [],          // blocking structural violations (empty when valid)
  "warnings": [],        // non-blocking best-practice recommendations
  "summary": "PDF/UA structural prerequisites hold."
}
```

It verifies catalog `/MarkInfo /Marked true`, `/StructTreeRoot` (+ `/ParentTree`), `/Metadata` (XMP), `/Lang`, and per-page MCID uniqueness. This is a fast developer-time gate — **not** a substitute for a full reference validator (veraPDF), which additionally checks fonts, colour, and rendering.

**PDF/X-4 (v1.7.0).** `{ "pdfBase64": "<pdf>", "standard": "pdf-x-4" }` checks the structural prerequisites of ISO 15930-7: PDF 1.6 header, no encryption, trailer `/ID`, the PDF/X-4 XMP identification, a `/GTS_PDFX` output intent with an embedded `prtr` ICC profile, a TrimBox or ArtBox per page nested in the BleedBox and MediaBox, every font embedded, no annotation on the printed area, no JavaScript, no embedded file, device colour consistent with the output intent. The result has the same shape plus `caveats[]`, which states what a `valid: true` verdict does **not** establish: this is **not a certified preflight**, and veraPDF does not cover PDF/X — confirm a press job with callas pdfToolbox or Acrobat Preflight. The default (`pdf-ua-1`) response is unchanged and carries no `caveats`.

### `annotate_pdf`

Overlay markup annotations on an existing PDF via incremental update. This is a **visual review layer, not a redaction** — the underlying content is untouched.

```jsonc
{
  "pdfBase64": "<base64 PDF>",
  "annotations": [
    { "type": "highlight", "page": 0, "rect": [72, 700, 520, 715], "color": [1, 1, 0], "contents": "Check this figure" },
    { "type": "text", "page": 0, "rect": [540, 700, 560, 720], "contents": "Reviewer note" }
  ]
}
```

Types: `text`, `highlight`, `underline`, `strikeout`, `squiggly`, `square`, `circle`, `line`, `freetext`. Page indices are 0-based. `color` / `interiorColor` take a hex or operand string (including a CMYK operand string), a 0–1 RGB triple (`[1, 1, 0]`) or, since v1.7.0, a CMYK percent tuple (`[0, 0, 100, 0]`); v1.7.0 also fixes the 0–1 triple, which used to render almost black. Encrypted sources are rejected (`ENCRYPTED_SOURCE`) — run `decrypt_pdf` first (drops signatures / AcroForm), annotate, then `encrypt_pdf` again.

### `draft_governance_issue`

Draft a governance-compliant GitHub issue **locally** for a human to review and submit. The server never contacts GitHub (its only possible egress is the operator-configured TSA / OCSP / CRL endpoints — see [Network & egress](#network--egress)); it returns the draft Markdown plus a machine-readable compliance report.

```jsonc
{
  "title": "add_table drops the caption on the second page",
  "issueType": "bug",
  "summary": "The table caption is only rendered on page 1 when repeatHeader is true.",
  "reproduction": { "command": "add_table with caption + repeatHeader over 2 pages (examples/bordered-table.json, then inspect_pdf)", "result": "Page 2 has no caption row." },
  "expectedBehavior": "The caption repeats with the header on every page.",
  "duplicateSearchPerformed": true
}
```

A draft that proposes a runtime dependency, omits a reproduction, or sets `duplicateSearchPerformed: false` is rejected with `GOVERNANCE_VIOLATION`. See [`docs/guides/AI_GOVERNANCE.md`](docs/guides/AI_GOVERNANCE.md) for the full human-in-the-loop contract.

### `verify_pdf`, `add_attachment`, `extract_text`

See the dedicated sections in [`docs/AI_GUIDE.md`](docs/AI_GUIDE.md) and the reference in [`docs/KNOWLEDGE_BASE.md`](docs/KNOWLEDGE_BASE.md). Ready-to-run examples live under [`examples/`](examples/).

---

## 🔐 Security model

`pdfnative-mcp` runs **inside the host process** and exposes a stdio MCP server (or a loopback-only HTTP endpoint). It does **not** perform any I/O outside the configured sandbox.

- **File writes** are gated by `PDFNATIVE_MCP_OUTPUT_DIR`. When unset, the `file` output mode is rejected with a `SecurityError`.
- **Path resolution** rejects absolute paths, traversal sequences (`..`), NUL bytes, and any extension other than `.pdf`.
- **Output size** is capped at 50 MB per call.
- **Inputs** are validated against strict JSON Schemas + Zod runtime checks at the boundary of every tool — unknown or misspelt keys (top-level or nested) are rejected with `VALIDATION_ERROR`, and base64 / DER payloads are sanity-checked (`data:` prefix tolerated, PEM or double-encoded input rejected with the remedy) before any parser runs.
- **HTTP transport** (`PDFNATIVE_MCP_PORT`) binds loopback only; it has **no authentication** unless `PDFNATIVE_MCP_HTTP_TOKEN` is set (then `401` without a valid bearer token).

### Network & egress

The server makes **no outbound network call by default**. The only egress it can ever perform goes to the RFC 3161 / OCSP / CRL endpoints the **operator** configured in the environment for PAdES long-term validation (`PDFNATIVE_MCP_TSA_URL`, `PDFNATIVE_MCP_REVOCATION`, `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS`) — never to a URL supplied by a tool argument, never to GitHub, never for telemetry. Without that configuration `sign_pdf timestamp: true`, `timestamp_pdf` and `add_ltv mode: 'online'` fail fast with `TSA_NOT_CONFIGURED` / `REVOCATION_NOT_CONFIGURED` before touching the document; `add_ltv mode: 'offline'` embeds caller-supplied material with zero network access.

OCSP / CRL URLs come from the AIA / CRL-distribution-point extensions of untrusted certificates inside the PDF, so every fetch passes an SSRF guard:

- host must match the operator allow-list (`host`, `host:port` or `*.suffix`; bare wildcards are rejected). Entries are **hostnames**, not URLs: a `host:port` entry only matches URLs carrying an *explicit* port (the URL parser drops default `:80` / `:443` — list the bare host for those); wildcard entries cannot carry a port; IDN hostnames must be listed in punycode (`xn--…`); IPv6 literals in brackets (`[2001:db8::1]`);
- `http:` / `https:` only, no embedded credentials, redirects are never followed;
- loopback, link-local, private, unique-local, CGNAT, unspecified and multicast address literals (including decimal / octal / hex spellings and IPv4-mapped IPv6) are rejected unless that literal is allow-listed verbatim. The guard checks **literals only** — a listed hostname that resolves to an internal address (DNS rebinding) is not detected, since there is no resolver without adding a dependency; allow-list only hosts you control;
- per-request timeout (`PDFNATIVE_MCP_NETWORK_TIMEOUT_MS`) and response caps (256 KiB TSA, 1 MiB OCSP, 16 MiB CRL) enforced **while streaming**, so an oversized response is cut off rather than buffered;
- OCSP responses and CRLs returned by responders are parse-validated before `add_ltv` embeds them;
- the TSA URL is operator-trusted (scheme + credential checks only); the `PDFNATIVE_MCP_TSA_AUTH` secret is never logged or echoed in error messages.

Providers are built per call and passed through pdfnative's per-call options — the process-wide provider setters are never used, so concurrent requests share nothing. The `server/discover` instructions report the current egress policy (endpoint kinds only, never secrets).

See [SECURITY.md](SECURITY.md) for the responsible disclosure process and [`docs/guides/LTV.md`](docs/guides/LTV.md) for the operator setup.

---

## 🧪 Local development

```bash
git clone https://github.com/Nizoka/pdfnative-mcp.git
cd pdfnative-mcp
npm ci                    # .npmrc sets ignore-scripts=true: nothing builds on install
npm run gate:fast         # before every commit: typecheck:all, lint, test, server-json, verify:docs
npm run gate              # the CI profile: build, dist checks, stdio smoke test, tool shape, samples, coverage, docs, corpus, validate:pdfx
npx tsx scripts/gate.ts --publish --require-all   # release branches: everything incl. validate:pdfa (veraPDF); a skipped step fails
```

`npm run gate` ([`scripts/gate.ts`](scripts/gate.ts)) is the single definition of green — 1624 tests, the coverage thresholds of `vitest.config.ts`, and the **built** server driven over stdio, where stdout must carry JSON-RPC frames only. It prints one line per step and writes the logs to `test-output/.gate/<step>.log`; `--only <step>` runs one step and `--json` gives machine output (call the script directly to pass flags: `npx tsx scripts/gate.ts --fast`). The individual steps are ordinary npm scripts:

```bash
npm run build && npm run test:generate   # drive the built server under TZ=UTC, operator variables scrubbed -> test-output/samples/
npm run verify:samples    # hold the 96 samples to tests/_fixtures/samples.sha256.json (94 by bytes, 2 by a semantic projection)
npm run corpus:pdfa       # write the 41-file conformance corpus (33 claim PDF/A, 6 claim PDF/X-4, 2 page-tree outputs claim nothing)
npm run validate:pdfx     # in-process structural PDF/X-4 check of the corpus; never skips
npm run validate:pdfa     # veraPDF over the PDF/A files (VERAPDF_HOME, JAVACMD); exit 0 ok / 1 conformance / 2 infrastructure
npm run verify:docs       # every count, version, tool, error code, operator variable, link and anchor in the docs vs docs/assets/ecosystem.json and src/
npx tsx scripts/tool-shape.ts --write   # only after a deliberate tools/list schema change (npm run verify:tool-shape checks the fixture)
```

An intended output change is rebaselined with `npx tsx scripts/verify-samples.ts --update` and declared in the release note — never to silence a surprise. With veraPDF 1.30.2 the corpus gives 27 PASS and 6 expected failures (negative canaries that must stay rejected). Every script, its flags and its exit codes are listed in [`scripts/README.md`](scripts/README.md).

Smoke-test the server over stdio:

```bash
node dist/cli.js
# In another terminal, send a JSON-RPC initialize request via stdin (e.g. with mcp-inspector).
```

> **Contributors:** start at [`AGENTS.md`](AGENTS.md) (the repository rules shared by every coding agent and contributor) and see [docs/guides/LOCAL_TESTING.md](docs/guides/LOCAL_TESTING.md) for the full local-verification workflow — the quality gate, examples-as-tests, validating that generated PDFs are structurally correct (`assertValidPdf`, `inspect_pdf`, `validate_pdf`, `verify_pdf`), opening output in a viewer, external PDF/A checking with veraPDF, and the MCP Inspector.

## 📣 Release process

`pdfnative-mcp` follows the same release formalism as `pdfnative`:

- One release note file per tag in `release-notes/vX.Y.Z.md`
- `CHANGELOG.md` mirrors each release bullet list
- GitHub Release body is copied from `release-notes/vX.Y.Z.md`
- `npx tsx scripts/release-prepare.ts --version X.Y.Z` applies the mechanical part of a version bump (it never commits, tags or publishes); the version moves in lock-step across `package.json`, `src/version.ts`, `server.json` and [`docs/assets/ecosystem.json`](docs/assets/ecosystem.json)
- A release branch must pass `npx tsx scripts/gate.ts --publish --require-all` — every step, veraPDF included, with no skip
- npm publication is handled by GitHub Actions Trusted Publishing (OIDC), without `NPM_TOKEN`, from a protected environment: the workflow checks that the tag equals the package version, runs the publish gate and publishes with `--provenance`; a second job attests the tarball (build provenance) together with a CycloneDX SBOM and attaches both to the GitHub Release
- Every workflow job starts with `step-security/harden-runner`, checks out with `persist-credentials: false`, installs with `npm ci --ignore-scripts` and runs under least-privilege `permissions`; actions are pinned by commit SHA; the veraPDF job is **blocking**
- Human-in-the-loop: coding agents prepare and verify; the maintainer pushes, opens the pull request, tags and publishes ([`.github/AGENT_RULES.md`](.github/AGENT_RULES.md))

See `release-notes/TEMPLATE.md` for the canonical structure and publication checklist, and [CONTRIBUTING.md](CONTRIBUTING.md#release) for the release procedure.

---

## 📚 Project structure

```
src/
├── cli.ts                      # entrypoint: stdio (default) or Streamable HTTP (PDFNATIVE_MCP_PORT)
├── http.ts                     # Node http <-> Web Request/Response bridge + Host/Origin loopback guard
├── auth.ts                     # opt-in HTTP bearer token (PDFNATIVE_MCP_HTTP_TOKEN)
├── base64.ts                   # base64 / DER boundary decoding with agent-facing diagnostics
├── index.ts                    # public library exports
├── server.ts                   # Server factory, tool registry, cache hints, SERVER_INSTRUCTIONS
├── network.ts                  # operator-configured TSA / OCSP / CRL egress + SSRF guard
├── print.ts                    # print-production schema (boxes, bleed, marks + colour bars, userUnit, RGB / CMYK / Gray outputIntent, metadata, creationDate)
├── pdfx.ts                     # pdfx: 'pdfx4' conformance target + the static conflicts refused before the build
├── color.ts                    # shared colour fragment: CMYK operand string / percent tuple beside each historical form, toEngineColor()
├── typography.ts               # the typography fragment (12 opt-in keys) + TypographyOptions mapper
├── reproducible.ts             # operator-pinned creation instant (PDFNATIVE_MCP_CREATION_DATE, SOURCE_DATE_EPOCH)
├── diagnostics.ts              # engine diagnostics sink (PDFA_* / PDFX_* / TYPOGRAPHY_*), strict escalation by code, includeDiagnostics, embedFonts
├── chart.ts                    # charts v2 schema + ChartBlock mapper
├── blocks.ts                   # the 7 extended document blocks (table, image, link, toc, barcode, svg, formField)
├── layout.ts                   # pageSize / margins / header & footer templates / compress / debug / encrypt / typography (PdfLayoutOptions)
├── table.ts, barcode.ts, form.ts, image.ts   # bodies shared by a dedicated tool and its inline block
├── watermark.ts                # text and/or image watermark + position, PDF/A-1b transparency guard
├── encryption.ts               # password + encrypt schema (Standard Security Handler), decrypt error mapping
├── inflate-cap.ts              # PDFNATIVE_MCP_MAX_INFLATE_BYTES (engine decompression cap) + PDF_PARSE_FAILED mapping
├── output.ts                   # sandboxed file writer / base64 emitter (single + multi)
├── text.ts                     # newline sanitizer (Safe PDF/A)
├── doc-features.ts             # nested lists, outline, page labels, viewer prefs (+ print-dialog defaults)
├── pagetree.ts                 # page-tree error mapping (merge/split/extract)
├── crypto-provider.ts          # node:crypto signing provider for DER keys (SHA-256/384/512); verification stays pure JS
├── projection.ts               # verbosity / fields projection for the seven read tools
├── errors.ts                   # ToolError, SecurityError, GovernanceError
└── tools/
    ├── generate-basic-pdf.ts
    ├── inspect-layout.ts
    ├── add-barcode.ts
    ├── sign-pdf.ts
    ├── add-ltv.ts
    ├── timestamp-pdf.ts
    ├── update-metadata.ts
    ├── add-international-text.ts
    ├── add-table.ts
    ├── add-form.ts
    ├── read-form-fields.ts
    ├── fill-form.ts
    ├── add-chart.ts
    ├── embed-image.ts
    ├── inspect-pdf.ts
    ├── verify-pdf.ts
    ├── validate-pdf.ts
    ├── add-attachment.ts
    ├── extract-attachments.ts
    ├── extract-text.ts
    ├── merge-pdfs.ts
    ├── split-pdf.ts
    ├── extract-pages.ts
    ├── annotate-pdf.ts
    ├── encrypt-pdf.ts
    ├── decrypt-pdf.ts
    ├── draft-governance-issue.ts
    └── prepare-signature-placeholder.ts
scripts/                        # TypeScript run by tsx — the full table is in scripts/README.md
├── gate.ts                     # THE quality gate (npm run gate / gate:fast; --publish --require-all on release branches)
├── generate-samples.ts         # npm run test:generate — the built server under TZ=UTC -> test-output/samples/
├── verify-samples.ts           # npm run verify:samples — the byte baseline (tests/_fixtures/samples.sha256.json)
├── generate-pdfa-corpus.ts     # npm run corpus:pdfa — the 41-file PDF/A + PDF/X-4 conformance corpus
├── validate-pdfa.ts            # npm run validate:pdfa — veraPDF (PASS/FAIL/XFAIL/XPASS; exit 0 / 1 / 2)
├── validate-pdfx.ts            # npm run validate:pdfx — in-process structural PDF/X-4 check, never skips
├── tool-shape.ts               # structural tools/list fingerprint (--write refreshes tests/_fixtures/tool-shape.json)
├── verify-docs.ts              # npm run verify:docs — the docs held to docs/assets/ecosystem.json and the source tree
├── release-prepare.ts          # mechanical version bump (never commits, tags or publishes)
├── build-claude-rules.ts       # npm run agents:rules — .github/instructions/ -> .claude/rules/
└── verify-issue.mjs            # governance draft checker (npm run verify:issue)
docs/
├── AGENT_CONTRACT.md           # the consumer contract for agents that USE the server (catalogue, decision tree, recipes, error codes)
├── AI_GUIDE.md, KNOWLEDGE_BASE.md, API_STABILITY.md
├── guides/                     # PDFA, PRINT, TYPOGRAPHY, REPRODUCIBLE, CHARTS, FORMS, ENCRYPTION, LTV, AI_GOVERNANCE, LOCAL_TESTING
└── assets/ecosystem.json       # the single source of every count and version quoted in the docs
examples/                       # 43 executable tools/call sequences (npm run examples:check)
AGENTS.md, CLAUDE.md            # repository rules for coding agents; .github/instructions/ holds the per-area rules
.claude/                        # shared agent settings, the fail-closed guard hook, generated rules, the release-audit skill
.github/workflows/              # ci (Node 22 / 24 run the gate + a Windows job), publish, sample-regression, verapdf (blocking),
                                #   docs, codeql, scorecard, dependency-review, audit
.github/rulesets/               # branch and tag rulesets to import
tests/                          # vitest suites (one per tool / module), _fixtures/ (tool shape, sample baseline, engine-surface matrix,
                                #   the frozen 1.5.0 catalogue), tools/ (repository tooling)
```

---

## 🗺 Roadmap

v1.7.0 is shipped (fine typography, CMYK colours, PDF/X-4, 27 Unicode scripts, reproducible output on every host, pdfnative 1.8), on top of v1.6.0 (full engine coverage — 13 block kinds, layout options, `inspect_layout` — PAdES LTV ladder, print production, charts v2, `update_metadata`, MCP 2026-07-28). The full plan — released milestones, in-progress work, and long-term direction — lives in [ROADMAP.md](ROADMAP.md).

**Still deferred:**

- `redact_pdf` — pdfnative has no content-removal API; an overlay-only "redaction" would create false security. <!-- verify-docs:allow tool-parity -->
- Custom fonts (an operator-side font directory) and a `link` annotation in `annotate_pdf` — on the roadmap, not in v1.7.0.
- Native ECDSA verification — pdfnative does not export `ecdsaVerifyHash`; `verify_pdf` keeps its pure-JS path for P-256.
- HTTP page streaming — MCP 2026-07-28 still has no partial `structuredContent`, so large results stay single-shot.

Have a feature idea? Open an issue or PR.

---

## ⭐ Star the project

If `pdfnative-mcp` is useful to you, please ⭐ this repository — and consider also starring the underlying engine [Nizoka/pdfnative](https://github.com/Nizoka/pdfnative). Stars help others discover the project and motivate continued development.

---

## 🤝 Contributing

Contributions are very welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), check the [open issues](https://github.com/Nizoka/pdfnative-mcp/issues), and follow the [code of conduct](CODE_OF_CONDUCT.md).

---

## 📄 License

[MIT](LICENSE) © 2026 Nizoka. Third-party material: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

`pdfnative-mcp` is built on top of [`pdfnative`](https://github.com/Nizoka/pdfnative) and the [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).


