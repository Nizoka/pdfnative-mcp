# pdfnative-mcp

> **MCP server for PDF generation, PDF/A archival, PAdES signing with long-term validation, AcroForms, merge/split, encryption and layout preview** — 28 tools on the [pdfnative](https://github.com/Nizoka/pdfnative) engine (zero-dependency, ISO 32000-1 compliant), for Claude Desktop, Cursor, ChatGPT and any Model Context Protocol client.

[![npm version](https://img.shields.io/npm/v/pdfnative-mcp.svg?logo=npm&color=cb3837)](https://www.npmjs.com/package/pdfnative-mcp)
[![npm downloads](https://img.shields.io/npm/dm/pdfnative-mcp.svg?logo=npm)](https://www.npmjs.com/package/pdfnative-mcp)
[![Node version](https://img.shields.io/node/v/pdfnative-mcp.svg?logo=node.js)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Nizoka/pdfnative-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Nizoka/pdfnative-mcp/actions/workflows/ci.yml)
[![MCP](https://img.shields.io/badge/MCP-2026--07--28-6f42c1.svg)](https://modelcontextprotocol.io)
[![pdfnative](https://img.shields.io/badge/pdfnative-1.7-0a7e8c.svg)](https://github.com/Nizoka/pdfnative)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Nizoka/pdfnative-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/Nizoka/pdfnative-mcp)
[![CodeQL](https://github.com/Nizoka/pdfnative-mcp/actions/workflows/codeql.yml/badge.svg)](https://github.com/Nizoka/pdfnative-mcp/actions/workflows/codeql.yml)

---

## ✨ Features

`pdfnative-mcp` exposes **28 production-grade tools** to any MCP host:

| Tool                               | Purpose                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `generate_basic_pdf`               | Multi-page documents from **13 block kinds** — `heading`, `paragraph`, `list`, `table`, `image` (JPEG/PNG), `link`, `toc` (printed table of contents), `barcode`, `svg`, `formField`, `chart`, `pageBreak`, `spacer` — every `DocumentBlock` the engine offers. Embedded newlines auto-split into paragraphs. Optional `pdfA`, `print`, `metadata`, `embedFonts`, `watermark`, `outline`, layout options (`pageSize`, `margins`, `headerTemplate` / `footerTemplate`, `compress`, `debug`, `encrypt`). |
| `inspect_layout` *(new in v1.6.0)* | Read-only **pagination dry run** of the same `blocks` (+ `title`, `footerText`, `pdfA`, `normalize`, `embedFonts`, `pageSize`, `margins`, `headerTemplate`, `footerTemplate`): page count and where every block lands, no PDF produced. |
| `add_barcode`                      | QR Code, Code 128, EAN-13, Data Matrix, PDF417 — embedded in a single-page PDF.                 |
| `add_international_text`           | 24 scripts (incl. **Latin** & COLRv1 **colour emoji** with flag / ZWJ sequences) with BiDi & OpenType shaping; multi-lang per document. |
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
| `validate_pdf`                     | Validate a Tagged PDF for PDF/UA (ISO 14289-1) structural conformance (read-only).              |
| `add_attachment`                   | Generate a PDF/A-3 document with embedded files (Factur-X / ZUGFeRD invoices).                  |
| `extract_attachments`              | Read-only extraction of embedded files (Factur-X / ZUGFeRD XML round-trip) with byte-for-byte payloads. |
| `extract_text`                     | Unicode text extraction (resolves `/ToUnicode`) with optional positioned runs; opens encrypted PDFs via `password`. |
| `inspect_pdf`                      | Read-only inspection: PDF version, page count, encryption (+ precise `encryptionInfo`), PDF/A claim, signatures (+ inventory, `/DSS`, document timestamps), page boxes, `/Trapped`, attachments, placeholder state, `annotations: true` inventory of existing page annotations. |
| `update_metadata` *(new in v1.6.0)* | Rewrite `/Info` title / author / subject / keywords (+ XMP, dates included) of an **existing** PDF as an incremental update; pin `modDate` for bytes that are identical on the same host time zone. |
| `encrypt_pdf`                      | Re-secure a PDF with AES-128 / AES-256 (owner/user passwords, permissions, password rotation).  |
| `decrypt_pdf`                      | Emit an unencrypted copy of an RC4 / AES-128 / AES-256 document.                                |
| `merge_pdfs`                       | Concatenate 2–50 PDFs into one via pdfnative's page-tree API (page boxes preserved).            |
| `split_pdf`                        | Split one PDF into one document per page range (multi-output).                                  |
| `extract_pages`                    | Pull an arbitrary page subset into a single PDF.                                               |
| `annotate_pdf`                     | Add markup annotations (highlight, note, square/circle, line, freetext) as a visual overlay — **not** a redaction. |
| `draft_governance_issue`           | Draft a governance-compliant GitHub issue locally for **human** review; never submits, no network. |

**New in v1.6.0:**

- 🧱 **Full engine coverage — 13 block kinds** — `generate_basic_pdf` accepts every `DocumentBlock` pdfnative offers: the new `table`, `image`, `link`, `toc`, `barcode`, `svg` and `formField` blocks share their body with the dedicated tools (`add_table`, `embed_image`, `add_barcode`, `add_form`) so a standalone artefact and an inline block validate and render identically. Rules: `link` accepts `http:` / `https:` / `mailto:` only (control characters rejected); `image` blocks are bounded (12 M base64 characters each, 24 MiB decoded per call; PNG must be 8-bit, non-interlaced, without alpha or palette — rejected with a remedy); `svg` covers paths, basic shapes and `<text>` (no `transform`, `<g>`, gradients or CSS — silently ignored; nothing is ever fetched); `toc` pairs with `outline: 'auto'`; `formField` under a PDF/A claim reports `PDFA_UNEMBEDDED_FORM_FONT`; `barcode` has no `alt` (engine limitation).
- 📐 **Layout options on the nine document tools** — `pageSize` (`A4` default, `Letter`, `Legal`, `A3`, `Tabloid`), `margins` (all four, 0–200 pt), `headerTemplate` / `footerTemplate` with `{page}` `{pages}` `{title}` `{date}` (a `footerTemplate` replaces the default footer, so `footerText` is then ignored; `{date}` is the build-day wall clock, not `creationDate`), `compress` (FlateDecode streams — smaller file, different bytes; XMP stays plain under PDF/A) and `debug` (guide rectangles, unmarked content — not for PDF/UA). Absent by default, so default output stays byte-identical.
- 🔐 **Encryption at build time** — `encrypt` on seven document tools (`generate_basic_pdf`, `add_table`, `add_form`, `add_international_text`, `embed_image`, `add_barcode`, `add_chart`): Standard Security Handler, AES-128 default / AES-256, **keeps the AcroForm** (unlike `encrypt_pdf`, which rebuilds the page tree). Exclusive with `pdfA` (`VALIDATION_ERROR`), never cached; not offered on `prepare_signature_placeholder` (must stay signable) or `add_attachment` (PDF/A-3).
- 📏 **`inspect_layout`** — the 28th tool: a read-only pagination dry run over the same `blocks` and layout inputs, reporting `totalPages` and each block's page / x / top / width / height without rendering a PDF. Known engine gap: a `toc` block is measured as 0 pt, so documents with a printed contents may paginate one page later than previewed.
- 🔎 **`inspect_pdf annotations: true`** — lists every page annotation (subtype, 0-based page, rect, contents truncated to 200 chars, title, colour, quadPoints, link URL) plus `annotationCount`; new `check: 'annotations'`.
- 🖼️ **Image watermarks** — `watermark.image` (JPEG/PNG, default opacity 0.10, own 8 MiB cap) on `generate_basic_pdf` and `add_table`, alone or combined with `text` (default opacity 0.15); `position: 'background' | 'foreground'` for both. Either opacity below 1.0 is rejected under `pdfa1b`.
- 🧯 **`PDFNATIVE_MCP_MAX_INFLATE_BYTES`** — operator override of the engine's 100 MiB per-stream decompression cap (integer ≥ 1024; an invalid value refuses to start). A capped attachment stream fails `extract_attachments includeData: true` with `PDF_PARSE_FAILED`; `extract_text` degrades to empty page text (the engine swallows per-page decode failures).
- 📝 **Forms** — `add_form` and `formField` blocks gain `listbox` and `placeholder`; `fieldType: 'textarea'` now reaches the engine as `multilineText` (it was passed through unmapped before and rendered as a single-line field — a bug fix that changes bytes for that input). `embed_image` gains `align` and `alt`.
- 🔏 **PAdES long-term validation ladder** — `sign_pdf` gains `profile: 'pades'` (ETSI EN 319 142-1 baseline, ESS signing-certificate-v2, `ETSI.CAdES.detached`), `timestamp: true` (B-T, RFC 3161), RSA-SHA384/512, `certChainDerBase64`, `fieldName` / `allowMultiple` for several signatures; new `add_ltv` embeds a `/DSS` (B-LT, `mode: 'online'` through the operator provider or `mode: 'offline'` with caller-supplied DER material); new `timestamp_pdf` appends a `/DocTimeStamp` (B-LTA). `verify_pdf ltv: true` reports profile, timestamp, revocation status and `ltvLevel`. See [`docs/guides/LTV.md`](docs/guides/LTV.md).
- 🌐 **Network charter** — no outbound request by default. The only egress the server can ever perform goes to the RFC 3161 / OCSP / CRL endpoints the operator configured (`PDFNATIVE_MCP_TSA_URL`, `PDFNATIVE_MCP_REVOCATION`, `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS`), behind an SSRF guard; tool arguments can never supply a URL.
- 🖨️ **Print production** — every document tool accepts `print` (TrimBox / BleedBox / ArtBox / CropBox or the `bleed` shorthand, crop + registration `marks`, `/UserUnit`), `metadata` (`/Author`, `/Subject`, `/Keywords`, `/Trapped`) and `outputIntent` (custom RGB ICC for PDF/A); `viewerPreferences` gains `duplex`, `pickTrayByPDFSize`, `printPageRange`, `numCopies`. `inspect_pdf pages: true` reports the boxes; merge / split / extract preserve them. See [`docs/guides/PRINT.md`](docs/guides/PRINT.md).
- ✍️ **`update_metadata`** — rewrite `/Info` + XMP of an existing PDF as an incremental update (earlier revisions and signatures preserved verbatim).
- 📊 **Charts v2** — `stackedBar` / `stackedBarH` / `area` / `scatter`, secondary right axis (`axis2`), `axis.scale: 'log'`, `xAxis.type: 'linear' | 'time'`, `dataLabels`, `labelStride` / `labelRotation`; overlapping category labels are thinned automatically.
- 📜 **Honest PDF/A** — `embedFonts: true` embeds Noto Sans Latin (base-14 Helvetica is not embedded, so a PDF/A claim on plain Latin text is rejected by veraPDF), `strict: true` fails instead of producing a non-conformant file, `includeDiagnostics: true` echoes engine diagnostics. Local veraPDF script (`npm run validate:pdfa`) over a 26-file corpus (24 validated, 3 of them negative canaries; 2 page-tree outputs skipped) and a fail-closed `VERAPDF_REQUIRED=1` mode; the CI workflow pins the installer by SHA-256 and stays non-blocking in 1.6.0. Known engine gaps: `add_form` output fails PDF/A-2b even with `embedFonts` (unembedded `/DR /Helv`), and a `prepare_signature_placeholder` output is conformant only once signed.
- 🧰 **`inspect_pdf`** — `signatures: true` inventory, `dss` / `docTimestampCount` / `trapped` (presence-gated), new `check` values `dss`, `docTimestamp`, `trapped`; `checks` lists only the keys you requested, and `signed` is structural (a signed field exists — validity is `verify_pdf`'s job).
- 🔁 **Reproducible output** — opt-in `creationDate` on all nine document tools pins `/CreationDate`, the XMP dates and the trailer `/ID`; `signingTime` on `prepare_signature_placeholder` (and on `sign_pdf`, now with time-zone offsets) pins `/Sig /M`. Identical bytes on the same host time zone. Backed by the `reproducible_output` prompt.
- 🛡️ **Hardened boundary** — strict input schemas (unknown or misspelt keys → `VALIDATION_ERROR` instead of being silently ignored); `data:…;base64,` prefixes tolerated, PEM-where-DER and double-encoded payloads rejected with the exact remedy; page-index mistakes on the page-tree tools are `VALIDATION_ERROR` with a 0-based hint; an unknown tool name is a JSON-RPC protocol error (`-32602`, `[UNKNOWN_TOOL]`).
- 🔑 **HTTP bearer token** — opt-in `PDFNATIVE_MCP_HTTP_TOKEN` gates the Streamable HTTP endpoint (`401` + `WWW-Authenticate` otherwise). Without it the loopback endpoint has no authentication — see [`SECURITY.md`](SECURITY.md).
- 🧾 **Catalogue** — `tools/list` is ≈ 245 kB (1.5.0: ≈ 108 kB) because every block kind, layout option and `encrypt` fragment is now advertised inline — no `$ref` / `$defs` by policy, so hosts that forward `inputSchema` to function-calling APIs never meet a reference; the server instructions are ≈ 6.7 kB (from 12.9 kB). Structure is guarded by `scripts/tool-shape.mjs` + `tests/catalogue-parity.test.ts`, and `tests/catalogue-superset.test.ts` proves the live catalogue is a superset of the published 1.5.0 one; at most two executable `_meta.examples` per tool, the rest under [`examples/`](examples/). Four new recipe prompts: `pades_ladder`, `print_ready`, `reproducible_output`, `pdfa_valid`.
- 🐛 **Fixes** — signer metadata (`signerName` / `reason` / `location` / `contactInfo`) never reached the `/Sig` dictionary on pdfnative < 1.7; it is now baked at placeholder time. `verify_pdf` no longer reports `allValid: false` on B-LTA documents (a `/DocTimeStamp` was parsed as a CMS signature).
- 🔌 **MCP 2026-07-28** on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`) with automatic fallback to the 2025-era `initialize` handshake — existing hosts keep working unchanged. See [MCP protocol compliance](#-mcp-protocol-compliance).
- ⬆ **Engine upgrade** — [pdfnative **v1.7.0**](https://github.com/Nizoka/pdfnative) (LTV, print production, charts v2, digest agility, flag / ZWJ emoji sequences, UAX #9 fixes).

**New in v1.5.0:**

- 📊 **Native vector charts** — `add_chart` renders bar / horizontal-bar / line / pie / donut charts as pure PDF path operators (zero rasterisation, PDF/A-safe with auto alt text). `generate_basic_pdf` also accepts a `chart` block for composition with text and tables.
- 📝 **Fill & flatten forms** — `read_form_fields` lists an existing AcroForm's fields; `fill_form` fills and/or flattens it via a non-destructive incremental update (the counterpart to `add_form`).
- 🔐 **Encryption round-trip** — `encrypt_pdf` re-secures with AES-128 / AES-256 (RC4 never emitted), `decrypt_pdf` recovers an unencrypted copy, a `password` input opens encrypted sources on the read-only tools, and `merge_pdfs` / `split_pdf` / `extract_pages` gain `password` + `encrypt`.
- 🔤 **Real text extraction** — `extract_text` now resolves each font's `/ToUnicode` CMap (no more glyph-index output) and can return positioned `runs`.
- 🔗 **Native MCP resources** — sandboxed generated PDFs become `pdfnative://output/…` resources (`resources/list` + `resources/read`), with a `resource_link` in file-mode results for cross-call re-reference.
- 🏷️ **Tool annotations** — every tool advertises `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`.
- ⬆ **Engine upgrade** — [pdfnative **v1.6.0**](https://github.com/Nizoka/pdfnative) (decrypt/re-encrypt, `extractText`, fill/flatten, charts; colour-emoji subset 221 → 1167 glyphs).

**New in v1.4.0:**

- 🤝 **AI governance + human-in-the-loop** — `draft_governance_issue` lets an agent draft a fully compliant GitHub issue **locally** (draft `.md` + machine-readable compliance report). The agent is a *draftsman, never an autonomous submitter*: a human is the only gate, and the server makes **zero** GitHub writes (and, since v1.6.0, no outbound call other than to operator-configured TSA / OCSP / CRL endpoints). Backed by the `governance_contract` and `draft_issue_workflow` MCP prompts.
- ✏️ **Markup annotations** — `annotate_pdf` overlays highlight, sticky-note, underline, strikeout, squiggly, square, circle, line, and freetext annotations on an existing PDF via incremental update. It is a *visual review layer, not a redaction* — underlying bytes remain.
- 🔢 **Page labels in `inspect_pdf`** — read-only surfacing of `/PageLabels` ranges (roman, decimal, prefixed).
- ∑ **Math / scientific script** — `add_international_text` accepts `lang: 'math'` (explicit, like `emoji`) to embed the Noto Sans Math face on demand.
- 🧩 **MCP prompts** — the server now advertises the `prompts` capability with `governance_contract` and `draft_issue_workflow`.
- ⬆ **Engine upgrade** — pdfnative **v1.5.0**.

**New in v1.3.0:**

- 🆕 **Three page-tree tools** — `merge_pdfs`, `split_pdf`, `extract_pages` (built on [pdfnative v1.4.0](https://github.com/Nizoka/pdfnative)'s page-tree API; encrypted sources were rejected until v1.5.0 added `password`).
- 🔖 **Bookmarks, page labels & nested lists** — `generate_basic_pdf` gains `outline` (`'auto'` or explicit tree), `pageLabels`, multi-level `list` items, and `viewerPreferences`.
- 📐 **Table cell borders & alignment** — `add_table` gains `cellBorders`, `cellVAlign`, and `viewerPreferences`; `add_international_text` gains `viewerPreferences`.
- 🔐 **Constant-time signing** — `sign_pdf` signs RSA and EC-DER keys through a `node:crypto` provider with a transparent pure-JS fallback (raw P-256 scalars stay pure JS, and verification is pure JS); signatures stay interoperable.
- ⬆ **Engine upgrade** — pdfnative **v1.4.0**.

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
- 🛠 **Engine upgrade** — [pdfnative v1.3.0](https://github.com/Nizoka/pdfnative): the Euro sign / CP-1252 symbols now extract correctly, and wrapped table cells get unique per-line MCIDs (PDF/UA-safe).

**New in v1.0.0:**

- 🆕 **Three new tools:** `verify_pdf`, `add_attachment` (Factur-X / ZUGFeRD), `extract_text`.
- 🆕 **Smart-table fields:** `wrap`, `repeatHeader`, `zebra`, `caption`, `minRowHeight`, `cellPadding`.
- 🆕 **`inspect_pdf`** now reports `hasSignaturePlaceholder` and per-attachment summary; new `check` values `'placeholder'` and `'attachments'`.
- 🆕 **Signing ergonomics:** `sign_pdf` accepts ECDSA SEC1 / PKCS#8 DER keys and auto-injects a `/Sig` placeholder when missing (one-call signing of any PDF).
- 🆕 **Opt-in cache** (`PDFNATIVE_MCP_CACHE_DIR`): SHA-256 keyed, 1 h TTL, 256 MiB LRU.
- 🆕 **`_meta.apiVersion`** and per-tool **`_meta.examples`** for AI-agent discovery — see [`docs/API_STABILITY.md`](docs/API_STABILITY.md).
- 🆕 **AI agent guide:** [`docs/AI_GUIDE.md`](docs/AI_GUIDE.md) — decision tree + common pitfalls. See also the root [`AGENTS.md`](AGENTS.md) operations manual.
- 🆕 **PDF/A authoring guide:** [`docs/guides/PDFA.md`](docs/guides/PDFA.md).
- 🛠 **Env-var rename:** `PDFNATIVE_MCP_OUTPUT_DIR` (was `PDFNATIVE_MPC_OUTPUT_DIR`; old name still works with a one-shot deprecation warning).
- ✅ **Now shipped:** `merge_pdfs`, `split_pdf`, `extract_pages` (v1.3.0), `annotate_pdf` (v1.4.0), the `add_chart` / `read_form_fields` / `fill_form` / `encrypt_pdf` / `decrypt_pdf` tools plus the encrypted round-trip and native MCP resources (v1.5.0), and `add_ltv` / `timestamp_pdf` / `update_metadata` plus print production and charts v2 (v1.6.0). `redact_pdf` stays **deferred** — pdfnative can overlay/flatten but not *remove* page content, and an overlay-only "redaction" would create false security, so it is intentionally not shipped (tracked as an upstream content-removal request).

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
- **24 scripts** (25 `lang` codes incl. `emoji` and `math`) with built-in BiDi reordering, Arabic positional shaping, Thai/Devanagari/Bengali/Tamil OpenType shaping.
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
| `PDFNATIVE_MCP_CACHE_DIR`     | Absolute path to enable the persistent SHA-256-keyed result cache (1 h TTL, 256 MiB LRU; key namespaced by tool API + package version). When unset, the cache is disabled. Never caches `encrypt_pdf` / `decrypt_pdf` / `sign_pdf` / `add_ltv` / `timestamp_pdf` / `update_metadata` or file-mode calls; a hit carries `_meta.cached: true` and returns the earlier call's bytes. |
| `PDFNATIVE_MCP_PORT`          | When set to a valid port (1–65535), starts an HTTP server on `http://127.0.0.1:<port>/mcp` instead of stdio. Binds loopback only and enables DNS-rebinding protection (foreign `Host`/`Origin` → **403**). **No authentication unless `PDFNATIVE_MCP_HTTP_TOKEN` is set** — other local processes can reach the endpoint. |
| `PDFNATIVE_MCP_HTTP_TOKEN`    | *(v1.6.0, secret)* Opt-in bearer token for the HTTP transport (≥ 16 characters, no whitespace — a weaker value aborts startup). When set, every `/mcp` request must carry `Authorization: Bearer <token>`; otherwise **401** + `WWW-Authenticate: Bearer realm="pdfnative-mcp"` (with `error="invalid_token"` only when credentials were sent — RFC 6750 §3.1). Compared constant-time, never logged. |
| `PDFNATIVE_MCP_MAX_INFLATE_BYTES` | *(v1.6.0)* Overrides the engine's 100 MiB per-stream decompression cap (zip-bomb guard): a positive integer number of bytes ≥ 1024, read once at startup — an invalid value refuses to start. Lower it on a shared host, raise it for trusted archives of large scans. A capped attachment stream fails `extract_attachments includeData: true` with `PDF_PARSE_FAILED`; `extract_text` degrades to empty page text for a capped content stream (engine behaviour, no error surfaced). |
| `PDFNATIVE_MCP_TSA_URL`       | *(v1.6.0)* Absolute `http(s)` URL of the RFC 3161 timestamp authority used by `sign_pdf timestamp: true` and `timestamp_pdf`. Unset: `TSA_NOT_CONFIGURED`, no request is made. |
| `PDFNATIVE_MCP_TSA_AUTH`      | *(v1.6.0, secret)* Optional `Authorization` header value sent to the TSA. Never logged or echoed. |
| `PDFNATIVE_MCP_REVOCATION`    | *(v1.6.0)* `ocsp`, `crl` or `ocsp,crl` — enables online revocation collection for `add_ltv mode: 'online'`. Unset: `REVOCATION_NOT_CONFIGURED`. |
| `PDFNATIVE_MCP_NETWORK_ALLOWED_HOSTS` | *(v1.6.0)* Comma-separated allow-list (`host`, `host:port`, `*.suffix`) for OCSP / CRL responders. **Mandatory** when `PDFNATIVE_MCP_REVOCATION` is set — responder URLs come from untrusted certificates. |
| `PDFNATIVE_MCP_NETWORK_TIMEOUT_MS` | *(v1.6.0)* Per-request timeout for TSA / OCSP / CRL calls, 1000–120000 ms (default 10000). |

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

Block rules: `table`, `barcode`, `formField` and `chart` take the same body as `add_table` / `add_barcode` / `add_form` / `add_chart`; `link` URLs must be `http:`, `https:` or `mailto:`; `image` blocks are capped at 12 M base64 characters each and 24 MiB decoded per call (PNG: 8-bit greyscale/RGB, non-interlaced, no alpha, no palette — otherwise `VALIDATION_ERROR` with a remedy); `svg` supports `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>`, `<text>`/`<tspan>` and silently ignores `transform`, `<g>`, `<use>`, `<image>`, gradients, opacity and CSS (no external reference is ever fetched); `toc` is built from the heading blocks and pairs with `outline: 'auto'`; `formField` under `pdfA` reports `PDFA_UNEMBEDDED_FORM_FONT` (`strict: true` fails); `barcode` has no `alt`. Use `inspect_layout` with the same inputs to preview the pagination before rendering.

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

Supported `lang` codes (25): `ar`, `he`, `th`, `ja`, `zh`, `ko`, `el`, `hi`, `bn`, `ta`, `ru`, `ka`, `hy`, `tr`, `pl`, `vi`, `latin`, `te`, `si`, `bo`, `km`, `my`, `am`, `emoji`, `math`. Fonts are always embedded (no `embedFonts` input); pin `creationDate` for byte-identical output.

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

Field types: `text`, `textarea` (multi-line, `/Ff 4096`), `checkbox`, `radio`, `dropdown`, `listbox`; `placeholder` shows hint text while a field is empty. Add `encrypt` to produce a password-protected form that keeps its AcroForm. Under a PDF/A claim the widget appearance font is not embedded (`PDFA_UNEMBEDDED_FORM_FONT`).

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

`check[]` accepts any of `'pdfa'`, `'signed'`, `'encrypted'`, `'placeholder'`, `'attachments'`, `'dss'`, `'docTimestamp'`, `'trapped'`, `'annotations'` (the last four since v1.6.0). `checksPassed` is the AND of all requested checks. `signatures: true` adds a per-field inventory (`subFilter`, `isDocTimestamp`, `isPlaceholder`, `byteRange`, `vriKey`); `annotations: true` adds `annotations[]` (every `/Annots` entry: 0-based `page`, `subtype`, `rect`, and when present `contents` truncated to 200 chars, `title`, `color`, `quadPoints`, link `url`) plus `annotationCount`; `dss`, `docTimestampCount` and `trapped` appear only when present; with `pages: true` each `perPage` entry also carries `trimBox` / `bleedBox` / `artBox` / `cropBox` / `userUnit` when set.

### `inspect_layout`

Read-only pagination dry run — the same `blocks` as `generate_basic_pdf` plus every input that moves a block (`title`, `footerText`, `pdfA`, `normalize`, `embedFonts`, `pageSize`, `margins`, `headerTemplate`, `footerTemplate`). No PDF is produced; pass exactly what you will give `generate_basic_pdf` and `totalPages` matches.

```jsonc
{ "title": "Memo", "blocks": [{ "type": "paragraph", "text": "Short note." }], "pageSize": "Letter", "verbosity": "summary", "fields": ["totalPages"] }
```

The full result carries `pageWidth`, `pageHeight`, `margins`, `totalPages` and `pages[].blocks[]` (`type`, `page`, `x`, `top`, `width`, `height` in points, rounded to two decimals). Known engine gap: a `toc` block is measured as 0 pt here, so a document with a printed contents may paginate one page later than previewed.

### `validate_pdf`

Read-only **PDF/UA (ISO 14289-1)** structural conformance check for a Tagged PDF. Generate an accessible document with any tool using `pdfA` (e.g. `pdfA: 'pdfa2u'`), then validate the result:

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

Types: `text`, `highlight`, `underline`, `strikeout`, `squiggly`, `square`, `circle`, `line`, `freetext`. Page indices are 0-based. Encrypted sources are rejected (`ENCRYPTED_SOURCE`) — run `decrypt_pdf` first (drops signatures / AcroForm), annotate, then `encrypt_pdf` again.

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
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run validate:pdfa     # advisory: veraPDF over the 26-file PDF/A corpus (24 validated; skips when veraPDF is absent; VERAPDF_REQUIRED=1 fails closed)
node scripts/tool-shape.mjs --write   # only after a deliberate tools/list schema change (catalogue parity fixture)
```

Smoke-test the server over stdio:

```bash
node dist/cli.js
# In another terminal, send a JSON-RPC initialize request via stdin (e.g. with mcp-inspector).
```

> **Contributors:** see [docs/guides/LOCAL_TESTING.md](docs/guides/LOCAL_TESTING.md) for the full local-verification workflow — the quality gate, examples-as-tests, validating that generated PDFs are structurally correct (`assertValidPdf`, `inspect_pdf`, `validate_pdf`, `verify_pdf`), opening output in a viewer, external PDF/A checking with veraPDF, and the MCP Inspector.

## 📣 Release process

`pdfnative-mcp` follows the same release formalism as `pdfnative`:

- One release note file per tag in `release-notes/vX.Y.Z.md`
- `CHANGELOG.md` mirrors each release bullet list
- GitHub Release body is copied from `release-notes/vX.Y.Z.md`
- npm publication is handled by GitHub Actions Trusted Publishing (OIDC), without `NPM_TOKEN`

See `release-notes/TEMPLATE.md` for the canonical structure and publication checklist.

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
├── print.ts                    # print-production schema (boxes, bleed, marks, userUnit, outputIntent, metadata, creationDate)
├── diagnostics.ts              # PDF/A diagnostics sink, strict / includeDiagnostics / embedFonts
├── chart.ts                    # charts v2 schema + ChartBlock mapper
├── blocks.ts                   # the 7 extended document blocks (table, image, link, toc, barcode, svg, formField)
├── layout.ts                   # pageSize / margins / header & footer templates / compress / debug / encrypt (PdfLayoutOptions)
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
scripts/
├── verify-issue.mjs            # governance draft checker (npm run verify:issue)
├── validate-pdfa.mjs           # veraPDF run (npm run validate:pdfa; PASS/FAIL/XFAIL/XPASS/INFRA/SKIP)
├── generate-pdfa-corpus.mjs    # builds the 26-file PDF/A corpus (24 validated incl. 3 negative canaries, 2 page-tree outputs)
└── tool-shape.mjs              # structural tools/list fingerprint (--write refreshes tests/_fixtures/tool-shape.json)
.github/workflows/ci.yml        # Linux (Node 22 / 24) + Windows quality gate
.github/workflows/verapdf.yml   # non-blocking veraPDF CI job (SHA-256-pinned installer, VERAPDF_REQUIRED=1)
tests/                          # vitest suites (one per tool / module; document-blocks, layout-options, inspect-layout,
                                #   watermark, inflate-cap, catalogue-parity + catalogue-superset vs the 1.5.0 fixture)
```

---

## 🗺 Roadmap

v1.6.0 is shipped (full engine coverage — 13 block kinds, layout options, `inspect_layout` — PAdES LTV ladder, print production, charts v2, `update_metadata`, MCP 2026-07-28). The full plan — released milestones, in-progress work, and long-term direction — lives in [ROADMAP.md](ROADMAP.md).

**Still deferred:**

- `redact_pdf` — pdfnative has no content-removal API; an overlay-only "redaction" would create false security.
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

[MIT](LICENSE) © 2026 Nizoka

`pdfnative-mcp` is built on top of [`pdfnative`](https://github.com/Nizoka/pdfnative) and the [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).


